import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, db } from '../../src/db/index.js';
import { campaigns, tasks, results } from '../../src/db/schema.js';
import { createCampaign, updateCampaign } from '../../src/models/campaign.js';
import { createTasks } from '../../src/models/task.js';
import { createResult } from '../../src/models/result.js';
import { aggregateResults } from '../../src/engine/aggregator.js';
import { sql } from 'drizzle-orm';

beforeEach(() => {
  initDb();
  db.run(sql`DELETE FROM results`);
  db.run(sql`DELETE FROM tasks`);
  db.run(sql`DELETE FROM campaigns`);
});

describe('aggregateResults', () => {
  it('aggregates empty campaign', () => {
    const campaign = createCampaign({
      name: 'Empty',
      type: 'delivery',
      provider: 'mock',
      template: JSON.stringify({}),
    });

    const results = aggregateResults(campaign);

    expect(results.totalTasks).toBe(0);
    expect(results.completedTasks).toBe(0);
    expect(results.successRate).toBe(0);
    expect(results.mediaUrls).toEqual([]);
  });

  it('aggregates completed campaign with results', () => {
    const campaign = createCampaign({
      name: 'Completed',
      type: 'delivery',
      provider: 'mock',
      template: JSON.stringify({}),
    });

    const taskRecords = createTasks(campaign.id, [
      { address: '123 Main St' },
      { address: '456 Oak Ave' },
      { address: '789 Pine Rd' },
    ]);

    updateCampaign(campaign.id, {
      totalTasks: 3,
      completedTasks: 2,
      failedTasks: 1,
    });

    // Create results for completed tasks
    createResult({
      taskId: taskRecords[0].id,
      campaignId: campaign.id,
      success: 1,
      mediaUrls: JSON.stringify(['https://example.com/photo1.jpg']),
      feeCents: 975,
      trackingUrl: 'https://track.example.com/1',
      rawResponse: JSON.stringify({}),
      verificationData: null,
    });

    createResult({
      taskId: taskRecords[1].id,
      campaignId: campaign.id,
      success: 1,
      mediaUrls: JSON.stringify(['https://example.com/photo2.jpg']),
      feeCents: 850,
      trackingUrl: null,
      rawResponse: JSON.stringify({}),
      verificationData: null,
    });

    createResult({
      taskId: taskRecords[2].id,
      campaignId: campaign.id,
      success: 0,
      mediaUrls: null,
      feeCents: 0,
      trackingUrl: null,
      rawResponse: JSON.stringify({ error: 'cancelled' }),
      verificationData: null,
    });

    const updatedCampaign = { ...campaign, totalTasks: 3, completedTasks: 2, failedTasks: 1 };
    const agg = aggregateResults(updatedCampaign);

    expect(agg.totalTasks).toBe(3);
    expect(agg.completedTasks).toBe(2);
    expect(agg.failedTasks).toBe(1);
    expect(agg.successRate).toBe(66.7);
    expect(agg.totalFeeCents).toBe(1825);
    expect(agg.mediaUrls).toEqual([
      'https://example.com/photo1.jpg',
      'https://example.com/photo2.jpg',
    ]);
  });

  it('includes per-task details when requested', () => {
    const campaign = createCampaign({
      name: 'Details Test',
      type: 'photo_capture',
      provider: 'mock',
      template: JSON.stringify({}),
    });

    const taskRecords = createTasks(campaign.id, [
      { address: '100 Broadway, New York, NY' },
    ]);

    updateCampaign(campaign.id, { totalTasks: 1, completedTasks: 1 });

    createResult({
      taskId: taskRecords[0].id,
      campaignId: campaign.id,
      success: 1,
      mediaUrls: JSON.stringify(['https://example.com/billboard.jpg']),
      feeCents: 500,
      trackingUrl: null,
      rawResponse: JSON.stringify({}),
      verificationData: null,
    });

    const updatedCampaign = { ...campaign, totalTasks: 1, completedTasks: 1, failedTasks: 0 };
    const agg = aggregateResults(updatedCampaign, true);

    expect(agg.details).toBeDefined();
    expect(agg.details!.length).toBe(1);
    expect(agg.details![0].targetAddress).toBe('100 Broadway, New York, NY');
    expect(agg.details![0].success).toBe(true);
    expect(agg.details![0].mediaUrls).toEqual(['https://example.com/billboard.jpg']);
  });

  it('tracks provider breakdown', () => {
    const campaign = createCampaign({
      name: 'Multi Provider',
      type: 'delivery',
      provider: 'auto',
      template: JSON.stringify({}),
    });

    // Manually create tasks with different providers
    const taskRecords = createTasks(campaign.id, [
      { address: '123 Main St' },
      { address: '456 Oak Ave' },
    ]);

    // Simulate provider assignment
    db.run(sql`UPDATE tasks SET provider = 'doordash', status = 'completed' WHERE sequence = 0 AND campaign_id = ${campaign.id}`);
    db.run(sql`UPDATE tasks SET provider = 'mock', status = 'completed' WHERE sequence = 1 AND campaign_id = ${campaign.id}`);

    updateCampaign(campaign.id, { totalTasks: 2, completedTasks: 2 });

    const updatedCampaign = { ...campaign, totalTasks: 2, completedTasks: 2, failedTasks: 0 };
    const agg = aggregateResults(updatedCampaign);

    expect(agg.providerBreakdown).toHaveProperty('doordash');
    expect(agg.providerBreakdown).toHaveProperty('mock');
    expect(agg.providerBreakdown.doordash.completed).toBe(1);
    expect(agg.providerBreakdown.mock.completed).toBe(1);
  });
});
