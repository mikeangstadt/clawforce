import { Command } from 'commander';
import { readFileSync } from 'fs';
import { initDb } from '../db/index.js';
import { createCampaign, getCampaign, listCampaigns as listCampaignsDb } from '../models/campaign.js';
import { getTask } from '../models/task.js';
import { fanout } from '../engine/fanout.js';
import { aggregateResults } from '../engine/aggregator.js';
import { startPoller, stopPoller } from '../engine/poller.js';
import { listProviders, getProvider } from '../providers/registry.js';
import { parseTargets } from '../util/csv.js';
import type { CampaignTemplate, TaskType } from '../providers/interface.js';

initDb();

export function createCli(): Command {
  const program = new Command()
    .name('clawforce')
    .description('Crowdsourced physical task orchestration engine')
    .version('0.1.0');

  // --- providers ---
  program
    .command('providers')
    .description('List available task providers and their capabilities')
    .option('-t, --type <type>', 'Filter by task type')
    .action((opts) => {
      const providers = listProviders(opts.type as TaskType | undefined);
      console.log(JSON.stringify(providers, null, 2));
    });

  // --- campaign ---
  const campaign = program
    .command('campaign')
    .description('Manage task campaigns');

  campaign
    .command('create')
    .description('Create and execute a task campaign')
    .requiredOption('-n, --name <name>', 'Campaign name')
    .requiredOption('-T, --type <type>', 'Task type (delivery, photo_capture, verification, errand, survey, custom)')
    .option('-p, --provider <provider>', 'Provider name or "auto"', 'mock')
    .requiredOption('--targets <file>', 'CSV or JSON file with target addresses')
    .option('--template <file>', 'JSON file with task template')
    .option('--pickup-address <address>', 'Pickup address (for deliveries)')
    .option('--pickup-phone <phone>', 'Pickup phone number')
    .option('--instructions <text>', 'Custom instructions for agents')
    .option('--concurrency <n>', 'Max concurrent dispatches', '5')
    .option('--delay <ms>', 'Delay between dispatches in ms', '200')
    .option('--dry-run', 'Create tasks without dispatching')
    .option('--webhook <url>', 'Webhook URL for milestone notifications')
    .action(async (opts) => {
      // Build template
      let template: CampaignTemplate = {};
      if (opts.template) {
        template = JSON.parse(readFileSync(opts.template, 'utf-8'));
      }
      if (opts.pickupAddress) template.pickupAddress = opts.pickupAddress;
      if (opts.pickupPhone) template.pickupPhoneNumber = opts.pickupPhone;
      if (opts.instructions) template.customInstructions = opts.instructions;

      // Parse targets
      const targets = parseTargets(opts.targets);
      console.log(`Parsed ${targets.length} targets from ${opts.targets}`);

      // Validate
      if (opts.provider !== 'auto' && opts.provider !== 'mock') {
        const provider = getProvider(opts.provider);
        const validation = provider.validateTemplate(template);
        if (!validation.valid) {
          console.error('Template validation failed:');
          validation.errors.forEach(e => console.error(`  - ${e}`));
          process.exit(1);
        }
      }

      // Create campaign
      const camp = createCampaign({
        name: opts.name,
        type: opts.type,
        provider: opts.provider,
        template: JSON.stringify(template),
        webhookUrl: opts.webhook || null,
        config: JSON.stringify({
          concurrency: parseInt(opts.concurrency),
          delayMs: parseInt(opts.delay),
        }),
      });

      console.log(`Campaign created: ${camp.id}`);

      // Fan out
      const report = await fanout(camp, targets, {
        concurrency: parseInt(opts.concurrency),
        delayMs: parseInt(opts.delay),
        dryRun: opts.dryRun || false,
      });

      console.log(`\nFan-out complete:`);
      console.log(`  Total tasks:  ${report.totalTasks}`);
      console.log(`  Dispatched:   ${report.dispatched}`);
      console.log(`  Failed:       ${report.failed}`);
      console.log(`  Dry run:      ${report.dryRun}`);
      console.log(`\nCampaign ID: ${camp.id}`);

      if (!opts.dryRun) {
        console.log(`\nRun 'clawforce campaign status ${camp.id}' to check progress`);
      }
    });

  campaign
    .command('status <campaignId>')
    .description('Get campaign status and progress')
    .action((campaignId) => {
      const camp = getCampaign(campaignId);
      if (!camp) {
        console.error('Campaign not found');
        process.exit(1);
      }

      const results = aggregateResults(camp);
      console.log(JSON.stringify({
        campaign_id: results.campaignId,
        name: results.campaignName,
        status: results.status,
        total_tasks: results.totalTasks,
        completed: results.completedTasks,
        failed: results.failedTasks,
        pending: results.pendingTasks,
        in_progress: results.inProgressTasks,
        success_rate: `${results.successRate}%`,
        total_cost: `$${(results.totalFeeCents / 100).toFixed(2)}`,
        provider_breakdown: results.providerBreakdown,
      }, null, 2));
    });

  campaign
    .command('results <campaignId>')
    .description('Get campaign results')
    .option('-d, --details', 'Include per-task details')
    .option('-f, --format <format>', 'Output format (json, csv)', 'json')
    .action((campaignId, opts) => {
      const camp = getCampaign(campaignId);
      if (!camp) {
        console.error('Campaign not found');
        process.exit(1);
      }

      const results = aggregateResults(camp, opts.details);

      if (opts.format === 'csv' && results.details) {
        console.log('task_id,sequence,status,provider,address,success,fee_cents,media_urls,error');
        for (const d of results.details) {
          console.log([
            d.taskId,
            d.sequence,
            d.status,
            d.provider || '',
            `"${d.targetAddress}"`,
            d.success ?? '',
            d.feeCents ?? '',
            `"${d.mediaUrls.join(';')}"`,
            d.error ? `"${d.error}"` : '',
          ].join(','));
        }
      } else {
        console.log(JSON.stringify(results, null, 2));
      }
    });

  campaign
    .command('cancel <campaignId>')
    .description('Cancel all pending tasks in a campaign')
    .action(async (campaignId) => {
      const { handleCancelCampaign } = await import('../mcp/tools.js');
      const result = await handleCancelCampaign({ campaign_id: campaignId });
      console.log(result.content[0].text);
    });

  campaign
    .command('list')
    .description('List campaigns')
    .option('-s, --status <status>', 'Filter by status')
    .option('-l, --limit <n>', 'Max results', '20')
    .action((opts) => {
      const campaigns = listCampaignsDb(opts.status, parseInt(opts.limit));
      console.log(JSON.stringify(campaigns.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        provider: c.provider,
        status: c.status,
        tasks: `${c.completedTasks}/${c.totalTasks}`,
        created: c.createdAt,
      })), null, 2));
    });

  // --- task ---
  program
    .command('task <taskId>')
    .description('Get details of a single task')
    .action((taskId) => {
      const task = getTask(taskId);
      if (!task) {
        console.error('Task not found');
        process.exit(1);
      }
      console.log(JSON.stringify({
        ...task,
        target: JSON.parse(task.target),
        providerData: task.providerData ? JSON.parse(task.providerData) : null,
      }, null, 2));
    });

  // --- poll ---
  program
    .command('poll')
    .description('Run the status poller once (for cron-based setups)')
    .action(async () => {
      console.log('Running poller...');
      startPoller();
      // Wait one poll cycle then exit
      await new Promise(resolve => setTimeout(resolve, 5000));
      stopPoller();
      console.log('Poll complete');
    });

  // --- estimate ---
  program
    .command('estimate')
    .description('Estimate campaign cost')
    .requiredOption('-T, --type <type>', 'Task type')
    .requiredOption('-p, --provider <provider>', 'Provider name')
    .requiredOption('--targets <file>', 'CSV or JSON file with target addresses')
    .option('--template <file>', 'JSON file with task template')
    .action(async (opts) => {
      let template: CampaignTemplate = {};
      if (opts.template) {
        template = JSON.parse(readFileSync(opts.template, 'utf-8'));
      }
      const targets = parseTargets(opts.targets);

      const { handleEstimateCampaign } = await import('../mcp/tools.js');
      const result = await handleEstimateCampaign({
        type: opts.type,
        provider: opts.provider,
        template,
        targets,
      });
      console.log(result.content[0].text);
    });

  // --- compare ---
  program
    .command('compare')
    .description('Compare cost estimates across all providers for a task type')
    .requiredOption('-T, --type <type>', 'Task type (delivery, photo_capture, verification, errand, survey, custom)')
    .requiredOption('--targets <file>', 'CSV or JSON file with target addresses')
    .option('--template <file>', 'JSON file with task template')
    .option('-w, --window <minutes>', 'Time window in minutes (e.g. 60 for a 1-hour ad flight)')
    .action(async (opts) => {
      let template: CampaignTemplate | undefined;
      if (opts.template) {
        template = JSON.parse(readFileSync(opts.template, 'utf-8'));
      }
      const targets = parseTargets(opts.targets);

      console.log(`Comparing ${targets.length} ${opts.type} tasks across all providers...\n`);

      const { handleCompareEstimates } = await import('../mcp/tools.js');
      const result = await handleCompareEstimates({
        type: opts.type,
        targets,
        template,
        time_window_minutes: opts.window ? parseInt(opts.window) : undefined,
      });

      const data = JSON.parse(result.content[0].text);

      // Pretty-print the comparison table
      console.log(`Task type: ${data.task_type}`);
      console.log(`Targets:   ${data.total_targets}\n`);

      console.log('Provider          | Per Task         | Total              | Concurrency | Coverage              | Status');
      console.log('------------------|------------------|--------------------|-------------|-----------------------|--------');

      for (const p of data.providers) {
        const perTask = 'cents' in p.per_task
          ? `$${(p.per_task.cents / 100).toFixed(2)}`
          : `$${(p.per_task.min_cents / 100).toFixed(2)} - $${(p.per_task.max_cents / 100).toFixed(2)}`;
        const total = `$${(p.total.min_cents / 100).toLocaleString()} - $${(p.total.max_cents / 100).toLocaleString()}`;
        const conc = `${p.dispatch_timing.max_concurrency} (${p.dispatch_timing.estimated_dispatch_minutes}m)`;
        const coverage = p.coverage.excluded_regions
          ? `${p.coverage.countries.join(',')} excl. ${p.coverage.excluded_regions.join(',')}`
          : p.coverage.countries.join(',');
        const status = p.implemented ? 'Ready' : 'Stub';

        console.log(
          `${p.provider.padEnd(18)}| ${perTask.padEnd(17)}| ${total.padEnd(19)}| ${conc.padEnd(12)}| ${coverage.padEnd(22)}| ${status}`
        );
      }

      if (data.time_window) {
        console.log(`\n=== TIME WINDOW: ${data.time_window.window_minutes} minutes ===`);
        for (const rec of data.time_window.recommendations) {
          console.log(`  → ${rec}`);
        }
      }

      console.log(`\n=== RECOMMENDATION ===`);
      console.log(`  ${data.recommendation.suggestion}`);
    });

  return program;
}
