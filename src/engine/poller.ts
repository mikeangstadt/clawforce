import { getActiveTasks, updateTask, getTask } from '../models/task.js';
import { getCampaign, updateCampaign, incrementCompleted, incrementFailed } from '../models/campaign.js';
import { createResult } from '../models/result.js';
import { getProvider } from '../providers/registry.js';
import { checkMilestones } from './aggregator.js';
import { config } from '../config.js';
import { logger } from '../util/logger.js';
import type { CampaignTemplate } from '../providers/interface.js';
import type { Task } from '../db/schema.js';

const MAX_RETRIES = 2; // Up to 2 retries (3 total attempts)
let pollInterval: ReturnType<typeof setInterval> | null = null;

// Track retry counts in memory (keyed by original task ID)
const retryCounts = new Map<string, number>();

export function startPoller(): void {
  if (pollInterval) return;

  logger.info({ intervalMs: config.pollIntervalMs }, 'Starting task poller');

  pollInterval = setInterval(async () => {
    try {
      await pollActiveTasks();
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Poller error');
    }
  }, config.pollIntervalMs);

  // Run once immediately
  pollActiveTasks().catch(err => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Initial poll error');
  });
}

export function stopPoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('Task poller stopped');
  }
}

async function pollActiveTasks(): Promise<void> {
  const activeTasks = getActiveTasks();

  if (activeTasks.length === 0) return;

  logger.debug({ count: activeTasks.length }, 'Polling active tasks');

  // Group by campaign for milestone checking
  const campaignIds = new Set<string>();

  for (const task of activeTasks) {
    if (!task.providerId || !task.provider) continue;

    try {
      const provider = getProvider(task.provider);
      const status = await provider.getStatus(task.providerId);

      if (status.providerStatus === task.providerStatus) continue; // No change

      logger.debug({
        taskId: task.id,
        oldStatus: task.providerStatus,
        newStatus: status.providerStatus,
        normalized: status.status,
      }, 'Task status changed');

      updateTask(task.id, {
        status: status.status,
        providerStatus: status.providerStatus,
        providerData: JSON.stringify(status.providerData),
        completedAt: ['completed', 'failed', 'cancelled'].includes(status.status)
          ? new Date().toISOString()
          : undefined,
      });

      // Handle terminal states
      if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') {
        const result = provider.extractResult(status.providerData);

        // Check if we should auto-retry
        const shouldRetry = await evaluateRetry(task, status.providerData, result.success);

        if (shouldRetry) {
          // Don't record as final result — retry instead
          campaignIds.add(task.campaignId);
          continue;
        }

        // Record final result
        createResult({
          taskId: task.id,
          campaignId: task.campaignId,
          success: result.success ? 1 : 0,
          mediaUrls: JSON.stringify(result.mediaUrls),
          verificationData: result.verificationData ? JSON.stringify(result.verificationData) : null,
          feeCents: result.feeCents || null,
          trackingUrl: result.trackingUrl || null,
          rawResponse: JSON.stringify(result.rawResponse),
        });

        if (result.success) {
          incrementCompleted(task.campaignId);
          logger.info({
            taskId: task.id,
            photoCount: result.mediaUrls.length,
          }, 'Task completed with proof');
        } else {
          incrementFailed(task.campaignId);
          logger.warn({
            taskId: task.id,
            reason: result.verificationData?.cancellation_reason || result.verificationData?.issue || 'unknown',
          }, 'Task failed permanently');
        }

        campaignIds.add(task.campaignId);
      }
    } catch (err) {
      logger.error({
        taskId: task.id,
        error: err instanceof Error ? err.message : String(err),
      }, 'Error polling task status');
    }
  }

  // Check milestones and completion for affected campaigns
  for (const campaignId of campaignIds) {
    const campaign = getCampaign(campaignId);
    if (!campaign) continue;

    await checkMilestones(campaign);

    // Check if all tasks are terminal
    const totalResolved = campaign.completedTasks + campaign.failedTasks;
    if (totalResolved >= campaign.totalTasks && campaign.status === 'active') {
      updateCampaign(campaignId, { status: 'completed' });
      logger.info({ campaignId, completed: campaign.completedTasks, failed: campaign.failedTasks }, 'Campaign completed');
    }
  }
}

/**
 * Evaluate whether a failed/completed-without-proof task should be auto-retried.
 * Returns true if a retry was initiated.
 */
async function evaluateRetry(task: Task, providerData: unknown, wasSuccessful: boolean): Promise<boolean> {
  const retryCount = retryCounts.get(task.id) || 0;

  if (retryCount >= MAX_RETRIES) {
    logger.info({ taskId: task.id, retryCount }, 'Max retries reached, marking as final');
    return false;
  }

  const provider = getProvider(task.provider!);

  // Use provider-specific retry logic if available
  if ('shouldRetry' in provider && typeof (provider as any).shouldRetry === 'function') {
    const { retry, reason } = (provider as any).shouldRetry(providerData);
    if (!retry) return false;

    logger.info({
      taskId: task.id,
      reason,
      attempt: retryCount + 2,
      maxAttempts: MAX_RETRIES + 1,
    }, 'Auto-retrying task');

    return await retryTask(task, reason, retryCount + 1);
  }

  // Generic retry: retry any failure that isn't a success
  if (!wasSuccessful) {
    return await retryTask(task, 'generic_failure', retryCount + 1);
  }

  return false;
}

/**
 * Retry a task by dispatching a new delivery with refined instructions.
 */
async function retryTask(task: Task, reason: string, attempt: number): Promise<boolean> {
  try {
    const campaign = getCampaign(task.campaignId);
    if (!campaign) return false;

    const provider = getProvider(task.provider!);
    const template: CampaignTemplate = JSON.parse(campaign.template);
    const target = JSON.parse(task.target);

    // Refine instructions based on failure reason
    const refinedTemplate = refineInstructionsForRetry(template, reason, attempt);
    refinedTemplate._retryAttempt = attempt;

    // Dispatch the retry
    const result = await provider.dispatch(task, refinedTemplate);

    // Update the task with new provider info
    updateTask(task.id, {
      status: 'dispatched',
      providerId: result.providerId,
      providerStatus: result.providerStatus,
      providerData: JSON.stringify(result.providerData),
      dispatchedAt: new Date().toISOString(),
      completedAt: undefined,
      error: `Retry #${attempt}: ${reason}`,
    });

    retryCounts.set(task.id, attempt);

    logger.info({
      taskId: task.id,
      newProviderId: result.providerId,
      reason,
      attempt,
    }, 'Task retry dispatched');

    return true;
  } catch (err) {
    logger.error({
      taskId: task.id,
      error: err instanceof Error ? err.message : String(err),
    }, 'Failed to retry task');
    return false;
  }
}

/**
 * Refine the instructions for a retry attempt based on why the previous attempt failed.
 * This is where we make the Dasher more likely to succeed on the next try.
 */
function refineInstructionsForRetry(template: CampaignTemplate, reason: string, attempt: number): CampaignTemplate {
  const refined = { ...template };
  const original = template.customInstructions || template.dropoffInstructions || '';

  switch (reason) {
    case 'delivered_no_photo':
      // They went to the right place but didn't take a photo
      refined.customInstructions = [
        'PHOTO IS REQUIRED. Previous delivery did not include a photo.',
        'You MUST take a clear photo at the location as proof of delivery.',
        original,
      ].join(' ').slice(0, 450);
      break;

    case 'failed_to_deliver':
    case 'dasher_cannot_fulfill_other':
      // Dasher couldn't complete — simplify instructions
      refined.customInstructions = [
        'Go to the address. Take a clear photo of the location.',
        'If you cannot access the building, photograph from the street.',
        original,
      ].join(' ').slice(0, 450);
      break;

    case 'wrong_delivery_address':
      // Address issue — add extra context
      refined.customInstructions = [
        'NOTE: A previous attempt had address issues. Please verify you are at the correct location.',
        original,
      ].join(' ').slice(0, 450);
      break;

    default:
      // Generic retry — add urgency but keep instructions the same
      refined.customInstructions = [
        `Attempt ${attempt + 1}. Please complete this delivery and take a photo.`,
        original,
      ].join(' ').slice(0, 450);
      break;
  }

  // Increase tip slightly on retries to attract better Dashers
  if (template.tip !== undefined) {
    refined.tip = Math.round((template.tip || 0) * (1 + attempt * 0.25));
  }

  return refined;
}
