import PQueue from 'p-queue';
import type { Task, Campaign } from '../db/schema.js';
import type { CampaignTemplate, TaskProvider } from '../providers/interface.js';
import type { Target } from '../util/csv.js';
import { getProvider, resolveProvider } from '../providers/registry.js';
import { createTasks, updateTask } from '../models/task.js';
import { updateCampaign } from '../models/campaign.js';
import { config } from '../config.js';
import { logger } from '../util/logger.js';

export interface FanoutConfig {
  concurrency?: number;
  delayMs?: number;
  dryRun?: boolean;
  maxRetries?: number;
}

export interface FanoutReport {
  campaignId: string;
  totalTasks: number;
  dispatched: number;
  failed: number;
  dryRun: boolean;
}

export async function fanout(
  campaign: Campaign,
  targets: Target[],
  fanoutConfig?: FanoutConfig,
): Promise<FanoutReport> {
  const concurrency = fanoutConfig?.concurrency || config.defaultConcurrency;
  const delayMs = fanoutConfig?.delayMs || 200;
  const dryRun = fanoutConfig?.dryRun || false;
  const maxRetries = fanoutConfig?.maxRetries || 3;

  const template: CampaignTemplate = JSON.parse(campaign.template);

  // Create all task records
  const taskRecords = createTasks(campaign.id, targets);

  // Update campaign with total count
  updateCampaign(campaign.id, {
    totalTasks: taskRecords.length,
    status: dryRun ? 'draft' : 'dispatching',
  });

  if (dryRun) {
    logger.info({ campaignId: campaign.id, totalTasks: taskRecords.length }, 'Dry run — tasks created but not dispatched');
    return {
      campaignId: campaign.id,
      totalTasks: taskRecords.length,
      dispatched: 0,
      failed: 0,
      dryRun: true,
    };
  }

  // Set up concurrency-controlled queue
  const queue = new PQueue({
    concurrency,
    interval: delayMs,
    intervalCap: concurrency,
  });

  let dispatched = 0;
  let failed = 0;

  // Dispatch each task
  for (const task of taskRecords) {
    queue.add(async () => {
      try {
        await dispatchSingleTask(task, campaign, template, maxRetries);
        dispatched++;
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        updateTask(task.id, {
          status: 'failed',
          error: errorMsg,
        });
        logger.error({ taskId: task.id, error: errorMsg }, 'Task dispatch failed permanently');
      }
    });
  }

  // Wait for all dispatches to complete
  await queue.onIdle();

  // Update campaign status
  updateCampaign(campaign.id, {
    status: failed === taskRecords.length ? 'failed' : 'active',
    failedTasks: failed,
  });

  logger.info({ campaignId: campaign.id, dispatched, failed, total: taskRecords.length }, 'Fan-out complete');

  return {
    campaignId: campaign.id,
    totalTasks: taskRecords.length,
    dispatched,
    failed,
    dryRun: false,
  };
}

async function dispatchSingleTask(
  task: Task,
  campaign: Campaign,
  template: CampaignTemplate,
  maxRetries: number,
): Promise<void> {
  // Resolve provider — either fixed or auto
  const target: Target = JSON.parse(task.target);
  let provider: TaskProvider;

  if (campaign.provider === 'auto') {
    provider = resolveProvider(campaign.type as any, target, {
      errandCategory: template.errandCategory,
      preferCheapest: true,
    });
  } else {
    provider = getProvider(campaign.provider);
  }

  updateTask(task.id, { status: 'dispatching', provider: provider.name });

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await provider.dispatch(task, template);

      updateTask(task.id, {
        status: 'dispatched',
        provider: provider.name,
        providerId: result.providerId,
        providerStatus: result.providerStatus,
        providerData: JSON.stringify(result.providerData),
        dispatchedAt: new Date().toISOString(),
      });

      logger.info({
        taskId: task.id,
        providerId: result.providerId,
        provider: provider.name,
        attempt: attempt + 1,
      }, 'Task dispatched');

      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const backoffMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
      logger.warn({
        taskId: task.id,
        attempt: attempt + 1,
        backoffMs,
        error: lastError.message,
      }, 'Dispatch failed, retrying');
      await new Promise(resolve => setTimeout(resolve, backoffMs));
    }
  }

  throw lastError || new Error('Dispatch failed after retries');
}
