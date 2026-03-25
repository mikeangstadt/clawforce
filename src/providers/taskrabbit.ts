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

export class TaskRabbitProvider implements TaskProvider {
  name = 'taskrabbit';

  capabilities: ProviderCapabilities = {
    taskTypes: ['photo_capture', 'verification', 'errand', 'custom'],
    features: ['custom_instructions', 'scheduling', 'worker_rating'],
    coverage: { countries: ['US', 'GB', 'CA', 'FR', 'DE', 'ES'] },
    maxConcurrency: 10,
    estimatedCostRange: { minCents: 2000, maxCents: 8000 },
  };

  async dispatch(_task: Task, _template: CampaignTemplate): Promise<DispatchResult> {
    throw new Error('TaskRabbit provider not yet implemented — API access required. Contact TaskRabbit for enterprise API access.');
  }

  async getStatus(_providerTaskId: string): Promise<ProviderStatus> {
    throw new Error('TaskRabbit provider not yet implemented');
  }

  async cancel(_providerTaskId: string): Promise<void> {
    throw new Error('TaskRabbit provider not yet implemented');
  }

  extractResult(_providerData: unknown): ProviderResult {
    throw new Error('TaskRabbit provider not yet implemented');
  }

  validateTemplate(template: CampaignTemplate): ValidationResult {
    const errors: string[] = [];
    if (!template.customInstructions) {
      errors.push('custom_instructions is required for TaskRabbit tasks');
    }
    return { valid: errors.length === 0, errors };
  }

  async estimateCost(_target: Target, _template: CampaignTemplate): Promise<CostEstimate> {
    return { feeCents: 3500, currency: 'USD', estimatedMinutes: 60 };
  }
}
