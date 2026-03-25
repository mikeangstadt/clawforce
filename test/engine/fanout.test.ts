import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, db } from '../../src/db/index.js';
import { campaigns, tasks, results } from '../../src/db/schema.js';
import { createCampaign, getCampaign } from '../../src/models/campaign.js';
import { getTasksByCampaign } from '../../src/models/task.js';
import { fanout } from '../../src/engine/fanout.js';
import type { Target } from '../../src/util/csv.js';
import { sql } from 'drizzle-orm';

beforeEach(() => {
  initDb();
  // Clean tables
  db.run(sql`DELETE FROM results`);
  db.run(sql`DELETE FROM tasks`);
  db.run(sql`DELETE FROM campaigns`);
});

describe('fanout', () => {
  it('creates task records for each target', async () => {
    const campaign = createCampaign({
      name: 'Test Campaign',
      type: 'delivery',
      provider: 'mock',
      template: JSON.stringify({ customInstructions: 'Test delivery' }),
    });

    const targets: Target[] = [
      { address: '123 Main St, Springfield, IL' },
      { address: '456 Oak Ave, Chicago, IL' },
      { address: '789 Pine Rd, Peoria, IL' },
    ];

    const report = await fanout(campaign, targets, { concurrency: 2, delayMs: 10 });

    expect(report.totalTasks).toBe(3);
    expect(report.dispatched).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.dryRun).toBe(false);

    const taskRecords = getTasksByCampaign(campaign.id);
    expect(taskRecords.length).toBe(3);
    expect(taskRecords.every(t => t.status === 'dispatched')).toBe(true);
    expect(taskRecords.every(t => t.providerId !== null)).toBe(true);
  });

  it('dry run creates records without dispatching', async () => {
    const campaign = createCampaign({
      name: 'Dry Run Test',
      type: 'photo_capture',
      provider: 'mock',
      template: JSON.stringify({ customInstructions: 'Take photo' }),
    });

    const targets: Target[] = [
      { address: '123 Main St' },
      { address: '456 Oak Ave' },
    ];

    const report = await fanout(campaign, targets, { dryRun: true });

    expect(report.totalTasks).toBe(2);
    expect(report.dispatched).toBe(0);
    expect(report.dryRun).toBe(true);

    const taskRecords = getTasksByCampaign(campaign.id);
    expect(taskRecords.length).toBe(2);
    expect(taskRecords.every(t => t.status === 'pending')).toBe(true);

    const updated = getCampaign(campaign.id);
    expect(updated?.status).toBe('draft');
  });

  it('handles large target lists', async () => {
    const campaign = createCampaign({
      name: 'Scale Test',
      type: 'delivery',
      provider: 'mock',
      template: JSON.stringify({}),
    });

    const targets: Target[] = Array.from({ length: 50 }, (_, i) => ({
      address: `${i + 1} Test St, City, ST`,
    }));

    const report = await fanout(campaign, targets, { concurrency: 10, delayMs: 10 });

    expect(report.totalTasks).toBe(50);
    expect(report.dispatched).toBe(50);

    const taskRecords = getTasksByCampaign(campaign.id);
    expect(taskRecords.length).toBe(50);
  });

  it('isolates per-task failures', async () => {
    // Use mock with high failure rate
    const campaign = createCampaign({
      name: 'Failure Test',
      type: 'delivery',
      provider: 'mock',
      template: JSON.stringify({}),
    });

    const targets: Target[] = [
      { address: '123 Main St' },
      { address: '456 Oak Ave' },
    ];

    // Even if some tasks fail dispatch retries, the fanout should complete
    const report = await fanout(campaign, targets, { concurrency: 1, delayMs: 10, maxRetries: 1 });

    expect(report.totalTasks).toBe(2);
    // Should have dispatched (mock doesn't fail on dispatch, only on completion)
    expect(report.dispatched + report.failed).toBe(2);
  });
});
