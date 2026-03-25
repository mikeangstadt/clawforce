import { getActiveTasks, updateTask } from '../models/task.js';
import { getCampaign, updateCampaign, incrementCompleted, incrementFailed } from '../models/campaign.js';
import { createResult } from '../models/result.js';
import { getProvider } from '../providers/registry.js';
import { checkMilestones } from './aggregator.js';
import { config } from '../config.js';
import { logger } from '../util/logger.js';

let pollInterval: ReturnType<typeof setInterval> | null = null;

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
      if (status.status === 'completed' || status.status === 'failed') {
        const result = provider.extractResult(status.providerData);

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
        } else {
          incrementFailed(task.campaignId);
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
      logger.info({ campaignId }, 'Campaign completed');
    }
  }
}
