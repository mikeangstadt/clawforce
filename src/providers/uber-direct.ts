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

export class UberDirectProvider implements TaskProvider {
  name = 'uber-direct';

  capabilities: ProviderCapabilities = {
    taskTypes: ['delivery', 'errand'],
    errandCategories: ['pickup_dropoff', 'food_delivery'],
    features: ['real_time_tracking', 'verification_photo', 'quotes', 'webhooks'],
    coverage: { countries: ['US', 'CA', 'MX', 'BR', 'AU', 'JP', 'GB', 'FR', 'DE'] },
    maxConcurrency: 10,
    estimatedCostRange: { minCents: 500, maxCents: 1200 },
  };

  async dispatch(_task: Task, _template: CampaignTemplate): Promise<DispatchResult> {
    throw new Error('Uber Direct provider not yet implemented — API access required. Apply at https://developer.uber.com/products/direct');
  }

  async getStatus(_providerTaskId: string): Promise<ProviderStatus> {
    throw new Error('Uber Direct provider not yet implemented');
  }

  async cancel(_providerTaskId: string): Promise<void> {
    throw new Error('Uber Direct provider not yet implemented');
  }

  extractResult(_providerData: unknown): ProviderResult {
    throw new Error('Uber Direct provider not yet implemented');
  }

  validateTemplate(template: CampaignTemplate): ValidationResult {
    const errors: string[] = [];
    if (!template.pickupAddress) {
      errors.push('pickup_address is required for Uber Direct deliveries');
    }
    return { valid: errors.length === 0, errors };
  }

  async estimateCost(_target: Target, _template: CampaignTemplate): Promise<CostEstimate> {
    return { feeCents: 800, currency: 'USD', estimatedMinutes: 35 };
  }
}
