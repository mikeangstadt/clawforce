import { describe, it, expect } from 'vitest';
import { MockProvider } from '../../src/providers/mock.js';
import type { Task } from '../../src/db/schema.js';

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: 'test-task-1',
    campaignId: 'test-campaign-1',
    sequence: 0,
    status: 'pending',
    target: JSON.stringify({ address: '123 Main St, Springfield, IL' }),
    provider: null,
    providerId: null,
    providerStatus: null,
    providerData: null,
    error: null,
    dispatchedAt: null,
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('MockProvider', () => {
  it('declares all capabilities', () => {
    const provider = new MockProvider();
    expect(provider.name).toBe('mock');
    expect(provider.capabilities.taskTypes).toContain('delivery');
    expect(provider.capabilities.taskTypes).toContain('photo_capture');
    expect(provider.capabilities.taskTypes).toContain('verification');
    expect(provider.capabilities.coverage.countries).toEqual(['*']);
  });

  it('dispatches a task and returns a provider ID', async () => {
    const provider = new MockProvider({ delayMs: 10 });
    const task = makeTask();
    const result = await provider.dispatch(task, {});

    expect(result.providerId).toMatch(/^mock_/);
    expect(result.providerStatus).toBe('created');
    expect(result.trackingUrl).toContain(result.providerId);
  });

  it('tracks task status through lifecycle', async () => {
    const provider = new MockProvider({ delayMs: 10, completionDelayMs: 100, failureRate: 0 });
    const task = makeTask();
    const dispatch = await provider.dispatch(task, {});

    // Immediately after dispatch, should be pending
    const status1 = await provider.getStatus(dispatch.providerId);
    expect(['pending', 'assigned', 'in_progress', 'completed']).toContain(status1.status);

    // Wait for completion
    await new Promise(resolve => setTimeout(resolve, 150));

    const status2 = await provider.getStatus(dispatch.providerId);
    expect(status2.status).toBe('completed');
    expect(status2.providerStatus).toBe('delivered');
  });

  it('extracts results from completed tasks', async () => {
    const provider = new MockProvider({ delayMs: 10, completionDelayMs: 50, failureRate: 0 });
    const task = makeTask();
    const dispatch = await provider.dispatch(task, {});

    await new Promise(resolve => setTimeout(resolve, 100));

    const status = await provider.getStatus(dispatch.providerId);
    const result = provider.extractResult(status.providerData);

    expect(result.success).toBe(true);
    expect(result.mediaUrls.length).toBeGreaterThan(0);
    expect(result.feeCents).toBe(350);
  });

  it('validates any template', () => {
    const provider = new MockProvider();
    const result = provider.validateTemplate({});
    expect(result.valid).toBe(true);
  });

  it('provides cost estimates', async () => {
    const provider = new MockProvider();
    const estimate = await provider.estimateCost!(
      { address: '123 Main St' },
      {},
    );
    expect(estimate.feeCents).toBe(350);
    expect(estimate.currency).toBe('USD');
  });

  it('cancels a task', async () => {
    const provider = new MockProvider({ delayMs: 10 });
    const task = makeTask();
    const dispatch = await provider.dispatch(task, {});

    await provider.cancel(dispatch.providerId);

    const status = await provider.getStatus(dispatch.providerId);
    expect(status.status).toBe('cancelled');
  });
});
