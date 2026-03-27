import type { Task } from '../db/schema.js';
import type { Target } from '../util/csv.js';
import type {
  TaskProvider,
  ProviderCapabilities,
  CampaignTemplate,
  DispatchResult,
  ProviderStatus,
  ProviderResult,
  CostEstimate,
  ValidationResult,
} from './interface.js';
import { newId } from '../util/id.js';

interface MockConfig {
  delayMs: number;
  failureRate: number; // 0.0 to 1.0
  completionDelayMs: number;
}

const DEFAULT_CONFIG: MockConfig = {
  delayMs: 100,
  failureRate: 0.05,
  completionDelayMs: 500,
};

// Track mock task states in memory
const mockTasks = new Map<string, {
  status: ProviderStatus['status'];
  dispatchedAt: number;
  completionDelayMs: number;
  shouldFail: boolean;
}>();

export class MockProvider implements TaskProvider {
  name = 'mock';
  private config: MockConfig;

  capabilities: ProviderCapabilities = {
    taskTypes: ['delivery', 'photo_capture', 'verification', 'errand', 'survey', 'custom'],
    errandCategories: ['shopping', 'wait_in_line', 'pickup_dropoff', 'inspection', 'food_delivery', 'personal_errand', 'multi_step', 'skilled_labor'],
    features: ['real_time_tracking', 'verification_photo', 'custom_instructions', 'scheduling', 'quotes', 'webhooks', 'media_upload', 'worker_rating'],
    coverage: { countries: ['*'] },
    maxConcurrency: 50,
    estimatedCostRange: { minCents: 100, maxCents: 500 },
  };

  constructor(config: Partial<MockConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async dispatch(task: Task, _template: CampaignTemplate): Promise<DispatchResult> {
    await this.delay();
    const providerId = `mock_${newId()}`;
    const shouldFail = Math.random() < this.config.failureRate;

    mockTasks.set(providerId, {
      status: 'pending',
      dispatchedAt: Date.now(),
      completionDelayMs: this.config.completionDelayMs,
      shouldFail,
    });

    return {
      providerId,
      providerStatus: 'created',
      providerData: { mockId: providerId, taskId: task.id },
      trackingUrl: `https://mock.clawforce.dev/track/${providerId}`,
    };
  }

  async getStatus(providerTaskId: string): Promise<ProviderStatus> {
    const mockTask = mockTasks.get(providerTaskId);
    if (!mockTask) {
      return { status: 'failed', providerStatus: 'not_found', providerData: {} };
    }

    const elapsed = Date.now() - mockTask.dispatchedAt;
    const progress = elapsed / mockTask.completionDelayMs;

    let status: ProviderStatus['status'];
    let providerStatus: string;

    if (mockTask.status === 'cancelled') {
      return { status: 'cancelled', providerStatus: 'cancelled', providerData: { mockId: providerTaskId } };
    }

    if (mockTask.shouldFail && progress > 0.5) {
      status = 'failed';
      providerStatus = 'dasher_cancelled';
    } else if (progress < 0.25) {
      status = 'pending';
      providerStatus = 'confirmed';
    } else if (progress < 0.5) {
      status = 'assigned';
      providerStatus = 'enroute_to_pickup';
    } else if (progress < 0.75) {
      status = 'in_progress';
      providerStatus = 'enroute_to_dropoff';
    } else if (progress >= 1.0) {
      status = 'completed';
      providerStatus = 'delivered';
    } else {
      status = 'in_progress';
      providerStatus = 'arrived_at_dropoff';
    }

    mockTask.status = status;

    return {
      status,
      providerStatus,
      providerData: { mockId: providerTaskId, elapsed, progress },
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    const mockTask = mockTasks.get(providerTaskId);
    if (mockTask) {
      mockTask.status = 'cancelled';
    }
  }

  extractResult(providerData: unknown): ProviderResult {
    const data = providerData as Record<string, unknown>;
    const mockId = data.mockId as string;
    const mockTask = mockTasks.get(mockId);
    const success = mockTask ? mockTask.status === 'completed' : false;

    return {
      success,
      mediaUrls: success ? [`https://mock.clawforce.dev/photos/${mockId}.jpg`] : [],
      feeCents: success ? 350 : 0,
      trackingUrl: `https://mock.clawforce.dev/track/${mockId}`,
      rawResponse: providerData,
    };
  }

  validateTemplate(_template: CampaignTemplate): ValidationResult {
    return { valid: true, errors: [] };
  }

  async estimateCost(_target: Target, _template: CampaignTemplate): Promise<CostEstimate> {
    return {
      feeCents: 350,
      currency: 'USD',
      estimatedMinutes: 30,
    };
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.config.delayMs));
  }
}
