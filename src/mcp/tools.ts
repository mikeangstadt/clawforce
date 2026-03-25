import { z } from 'zod';
import { initDb } from '../db/index.js';
import { createCampaign, getCampaign, listCampaigns as listCampaignsDb } from '../models/campaign.js';
import { getTask, getTasksByCampaign, updateTask } from '../models/task.js';
import { fanout, type FanoutConfig } from '../engine/fanout.js';
import { aggregateResults } from '../engine/aggregator.js';
import { listProviders as listProvidersRegistry, getProvider } from '../providers/registry.js';
import type { CampaignTemplate, TaskType } from '../providers/interface.js';
import type { Target } from '../util/csv.js';

// Ensure DB is initialized
initDb();

// --- Schemas ---

const TargetSchema = z.object({
  address: z.string(),
  name: z.string().optional(),
  phone: z.string().optional(),
  metadata: z.record(z.string()).optional(),
});

const TemplateSchema = z.object({
  pickupAddress: z.string().optional(),
  pickupBusinessName: z.string().optional(),
  pickupPhoneNumber: z.string().optional(),
  pickupInstructions: z.string().optional(),
  dropoffPhoneNumber: z.string().optional(),
  dropoffInstructions: z.string().optional(),
  orderValue: z.number().optional(),
  tip: z.number().optional(),
  customInstructions: z.string().optional(),
}).passthrough();

const ConfigSchema = z.object({
  concurrency: z.number().default(5),
  delayMs: z.number().default(200),
  dryRun: z.boolean().default(false),
  maxRetries: z.number().default(3),
}).optional();

// --- Tool Definitions ---

export const toolDefinitions = {
  list_providers: {
    description: 'List available task providers with their capabilities, supported task types, coverage areas, and cost ranges. Use this to discover which providers can handle your task type before creating a campaign.',
    inputSchema: {
      task_type: z.enum(['delivery', 'photo_capture', 'verification', 'errand', 'survey', 'custom']).optional()
        .describe('Filter providers by supported task type'),
    },
  },
  create_campaign: {
    description: 'Create and execute a task campaign. Fan out a task template across multiple targets, dispatching to human agents via the specified provider. Returns immediately with campaign ID; use get_campaign_status to track progress.',
    inputSchema: {
      name: z.string().describe('Human-readable campaign name'),
      type: z.enum(['delivery', 'photo_capture', 'verification', 'errand', 'survey', 'custom'])
        .describe('Task type'),
      provider: z.string().default('mock')
        .describe('Provider name (doordash, taskrabbit, uber-direct, field-nation, mock) or "auto" for automatic selection'),
      template: TemplateSchema.describe('Task template with pickup/dropoff details and instructions'),
      targets: z.array(TargetSchema).describe('Array of target locations/recipients'),
      config: ConfigSchema.describe('Fan-out configuration: concurrency, delay, dry run'),
      webhook_url: z.string().url().optional().describe('URL for milestone notifications (25%, 50%, 75%, 100%)'),
    },
  },
  get_campaign_status: {
    description: 'Get current status and progress metrics for a campaign, including completion counts, success rate, and provider breakdown.',
    inputSchema: {
      campaign_id: z.string().describe('Campaign ID'),
    },
  },
  get_results: {
    description: 'Get aggregated results for a campaign: media URLs, costs, per-task details, and provider breakdown.',
    inputSchema: {
      campaign_id: z.string().describe('Campaign ID'),
      include_details: z.boolean().default(false).describe('Include per-task detail rows'),
    },
  },
  cancel_campaign: {
    description: 'Cancel all pending and active tasks in a campaign.',
    inputSchema: {
      campaign_id: z.string().describe('Campaign ID'),
    },
  },
  list_campaigns: {
    description: 'List campaigns, optionally filtered by status.',
    inputSchema: {
      status: z.string().optional().describe('Filter by status (draft, dispatching, active, completed, failed, cancelled)'),
      limit: z.number().default(20).describe('Maximum number of campaigns to return'),
    },
  },
  estimate_campaign: {
    description: 'Estimate total cost for a campaign without dispatching any tasks. Uses provider quote APIs where available.',
    inputSchema: {
      type: z.enum(['delivery', 'photo_capture', 'verification', 'errand', 'survey', 'custom'])
        .describe('Task type'),
      provider: z.string().default('doordash').describe('Provider name'),
      template: TemplateSchema,
      targets: z.array(TargetSchema).describe('Array of target locations'),
    },
  },
};

// --- Tool Handlers ---

export async function handleListProviders(args: { task_type?: string }) {
  const providers = listProvidersRegistry(args.task_type as TaskType | undefined);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(providers, null, 2) }],
  };
}

export async function handleCreateCampaign(args: {
  name: string;
  type: string;
  provider: string;
  template: CampaignTemplate;
  targets: Target[];
  config?: FanoutConfig;
  webhook_url?: string;
}) {
  // Validate provider supports this task type (unless auto)
  if (args.provider !== 'auto') {
    const provider = getProvider(args.provider);
    const validation = provider.validateTemplate(args.template);
    if (!validation.valid) {
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Template validation failed', errors: validation.errors }) }],
        isError: true,
      };
    }
  }

  // Create campaign record
  const campaign = createCampaign({
    name: args.name,
    type: args.type,
    provider: args.provider,
    template: JSON.stringify(args.template),
    webhookUrl: args.webhook_url || null,
    config: args.config ? JSON.stringify(args.config) : null,
  });

  // Run fan-out (async, returns after all dispatches)
  const report = await fanout(campaign, args.targets, args.config);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        campaign_id: campaign.id,
        status: report.dryRun ? 'draft' : 'active',
        total_tasks: report.totalTasks,
        dispatched: report.dispatched,
        failed: report.failed,
        dry_run: report.dryRun,
        message: report.dryRun
          ? `Dry run: ${report.totalTasks} tasks created but not dispatched`
          : `Campaign started: ${report.dispatched} tasks dispatched, ${report.failed} failed`,
      }, null, 2),
    }],
  };
}

export async function handleGetCampaignStatus(args: { campaign_id: string }) {
  const campaign = getCampaign(args.campaign_id);
  if (!campaign) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Campaign not found' }) }],
      isError: true,
    };
  }

  const results = aggregateResults(campaign);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        campaign_id: campaign.id,
        name: campaign.name,
        type: campaign.type,
        provider: campaign.provider,
        status: campaign.status,
        total_tasks: results.totalTasks,
        completed_tasks: results.completedTasks,
        failed_tasks: results.failedTasks,
        pending_tasks: results.pendingTasks,
        in_progress_tasks: results.inProgressTasks,
        success_rate: results.successRate,
        total_cost_cents: results.totalFeeCents,
        provider_breakdown: results.providerBreakdown,
        created_at: campaign.createdAt,
      }, null, 2),
    }],
  };
}

export async function handleGetResults(args: { campaign_id: string; include_details: boolean }) {
  const campaign = getCampaign(args.campaign_id);
  if (!campaign) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Campaign not found' }) }],
      isError: true,
    };
  }

  const results = aggregateResults(campaign, args.include_details);

  return {
    content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
  };
}

export async function handleCancelCampaign(args: { campaign_id: string }) {
  const campaign = getCampaign(args.campaign_id);
  if (!campaign) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: 'Campaign not found' }) }],
      isError: true,
    };
  }

  const tasks = getTasksByCampaign(campaign.id);
  let cancelled = 0;
  let alreadyCompleted = 0;
  let alreadyFailed = 0;

  for (const task of tasks) {
    if (['completed'].includes(task.status)) {
      alreadyCompleted++;
      continue;
    }
    if (['failed', 'cancelled'].includes(task.status)) {
      alreadyFailed++;
      continue;
    }

    // Try to cancel via provider
    if (task.providerId && task.provider) {
      try {
        const provider = getProvider(task.provider);
        await provider.cancel(task.providerId);
      } catch {
        // Best effort
      }
    }

    updateTask(task.id, { status: 'cancelled' });
    cancelled++;
  }

  const { updateCampaign: updateCamp } = await import('../models/campaign.js');
  updateCamp(campaign.id, { status: 'cancelled' });

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        campaign_id: campaign.id,
        cancelled,
        already_completed: alreadyCompleted,
        already_failed: alreadyFailed,
      }, null, 2),
    }],
  };
}

export async function handleListCampaigns(args: { status?: string; limit: number }) {
  const campaigns = listCampaignsDb(args.status, args.limit);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(campaigns.map(c => ({
        campaign_id: c.id,
        name: c.name,
        type: c.type,
        provider: c.provider,
        status: c.status,
        total_tasks: c.totalTasks,
        completed_tasks: c.completedTasks,
        failed_tasks: c.failedTasks,
        created_at: c.createdAt,
      })), null, 2),
    }],
  };
}

export async function handleEstimateCampaign(args: {
  type: string;
  provider: string;
  template: CampaignTemplate;
  targets: Target[];
}) {
  const provider = getProvider(args.provider);

  if (!provider.estimateCost) {
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          provider: provider.name,
          estimated_per_task_cents: provider.capabilities.estimatedCostRange,
          total_tasks: args.targets.length,
          estimated_total_min_cents: provider.capabilities.estimatedCostRange.minCents * args.targets.length,
          estimated_total_max_cents: provider.capabilities.estimatedCostRange.maxCents * args.targets.length,
          note: 'Provider does not support real-time quotes. Estimates based on published cost ranges.',
        }, null, 2),
      }],
    };
  }

  // Sample up to 5 targets for quotes
  const sampleSize = Math.min(5, args.targets.length);
  const samples = args.targets.slice(0, sampleSize);
  const quotes = await Promise.all(
    samples.map(t => provider.estimateCost!(t, args.template))
  );

  const avgFeeCents = Math.round(quotes.reduce((sum, q) => sum + q.feeCents, 0) / quotes.length);

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        provider: provider.name,
        sample_size: sampleSize,
        average_fee_per_task_cents: avgFeeCents,
        total_tasks: args.targets.length,
        estimated_total_cents: avgFeeCents * args.targets.length,
        estimated_total_dollars: (avgFeeCents * args.targets.length / 100).toFixed(2),
        sample_quotes: quotes,
      }, null, 2),
    }],
  };
}
