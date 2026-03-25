import type { Campaign } from '../db/schema.js';
import { getResultsByCampaign } from '../models/result.js';
import { getTasksByCampaign } from '../models/task.js';
import { logger } from '../util/logger.js';

export interface AggregatedResults {
  campaignId: string;
  campaignName: string;
  status: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  successRate: number;
  totalFeeCents: number;
  mediaUrls: string[];
  providerBreakdown: Record<string, { dispatched: number; completed: number; failed: number }>;
  details?: TaskDetail[];
}

export interface TaskDetail {
  taskId: string;
  sequence: number;
  status: string;
  provider: string | null;
  targetAddress: string;
  success: boolean | null;
  mediaUrls: string[];
  feeCents: number | null;
  trackingUrl: string | null;
  error: string | null;
}

export function aggregateResults(campaign: Campaign, includeDetails = false): AggregatedResults {
  const tasks = getTasksByCampaign(campaign.id);
  const results = getResultsByCampaign(campaign.id);

  // Build result lookup
  const resultByTask = new Map(results.map(r => [r.taskId, r]));

  // Count statuses
  let pending = 0;
  let inProgress = 0;
  const providerBreakdown: Record<string, { dispatched: number; completed: number; failed: number }> = {};

  for (const task of tasks) {
    if (['pending', 'dispatching'].includes(task.status)) pending++;
    if (['dispatched', 'assigned', 'in_progress'].includes(task.status)) inProgress++;

    const prov = task.provider || 'unknown';
    if (!providerBreakdown[prov]) {
      providerBreakdown[prov] = { dispatched: 0, completed: 0, failed: 0 };
    }
    providerBreakdown[prov].dispatched++;
    if (task.status === 'completed') providerBreakdown[prov].completed++;
    if (task.status === 'failed') providerBreakdown[prov].failed++;
  }

  // Aggregate results
  let totalFeeCents = 0;
  const allMediaUrls: string[] = [];

  for (const result of results) {
    if (result.feeCents) totalFeeCents += result.feeCents;
    if (result.mediaUrls) {
      const urls = JSON.parse(result.mediaUrls) as string[];
      allMediaUrls.push(...urls);
    }
  }

  const completed = campaign.completedTasks;
  const failed = campaign.failedTasks;
  const successRate = completed + failed > 0
    ? (completed / (completed + failed)) * 100
    : 0;

  const aggregated: AggregatedResults = {
    campaignId: campaign.id,
    campaignName: campaign.name,
    status: campaign.status,
    totalTasks: campaign.totalTasks,
    completedTasks: completed,
    failedTasks: failed,
    pendingTasks: pending,
    inProgressTasks: inProgress,
    successRate: Math.round(successRate * 10) / 10,
    totalFeeCents,
    mediaUrls: allMediaUrls,
    providerBreakdown,
  };

  if (includeDetails) {
    aggregated.details = tasks.map(task => {
      const result = resultByTask.get(task.id);
      const target = JSON.parse(task.target) as { address: string };
      return {
        taskId: task.id,
        sequence: task.sequence,
        status: task.status,
        provider: task.provider,
        targetAddress: target.address,
        success: result ? result.success === 1 : null,
        mediaUrls: result?.mediaUrls ? JSON.parse(result.mediaUrls) : [],
        feeCents: result?.feeCents || null,
        trackingUrl: result?.trackingUrl || null,
        error: task.error,
      };
    });
  }

  return aggregated;
}

// Milestone tracking — persisted via simple in-memory set per campaign
const firedMilestones = new Map<string, Set<number>>();
const MILESTONES = [25, 50, 75, 100];

export async function checkMilestones(campaign: Campaign): Promise<void> {
  if (!campaign.webhookUrl) return;
  if (campaign.totalTasks === 0) return;

  const resolved = campaign.completedTasks + campaign.failedTasks;
  const progress = (resolved / campaign.totalTasks) * 100;

  if (!firedMilestones.has(campaign.id)) {
    firedMilestones.set(campaign.id, new Set());
  }
  const fired = firedMilestones.get(campaign.id)!;

  for (const milestone of MILESTONES) {
    if (progress >= milestone && !fired.has(milestone)) {
      fired.add(milestone);

      const payload = {
        event: 'campaign.milestone',
        campaign_id: campaign.id,
        campaign_name: campaign.name,
        milestone,
        status: campaign.status,
        total_tasks: campaign.totalTasks,
        completed_tasks: campaign.completedTasks,
        failed_tasks: campaign.failedTasks,
        success_rate: campaign.totalTasks > 0
          ? Math.round((campaign.completedTasks / campaign.totalTasks) * 1000) / 10
          : 0,
        timestamp: new Date().toISOString(),
      };

      try {
        await fetch(campaign.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        logger.info({ campaignId: campaign.id, milestone }, 'Milestone webhook fired');
      } catch (err) {
        logger.error({
          campaignId: campaign.id,
          milestone,
          error: err instanceof Error ? err.message : String(err),
        }, 'Failed to fire milestone webhook');
      }
    }
  }
}
