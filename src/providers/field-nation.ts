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

export class FieldNationProvider implements TaskProvider {
  name = 'field-nation';

  capabilities: ProviderCapabilities = {
    taskTypes: ['verification', 'survey', 'photo_capture', 'custom'],
    features: ['custom_instructions', 'scheduling', 'worker_rating', 'media_upload'],
    coverage: { countries: ['US'] },
    maxConcurrency: 20,
    estimatedCostRange: { minCents: 5000, maxCents: 20000 },
  };

  async dispatch(_task: Task, _template: CampaignTemplate): Promise<DispatchResult> {
    throw new Error('Field Nation provider not yet implemented — API access required. Contact Field Nation for API partnership.');
  }

  async getStatus(_providerTaskId: string): Promise<ProviderStatus> {
    throw new Error('Field Nation provider not yet implemented');
  }

  async cancel(_providerTaskId: string): Promise<void> {
    throw new Error('Field Nation provider not yet implemented');
  }

  extractResult(_providerData: unknown): ProviderResult {
    throw new Error('Field Nation provider not yet implemented');
  }

  validateTemplate(template: CampaignTemplate): ValidationResult {
    const errors: string[] = [];
    if (!template.customInstructions) {
      errors.push('custom_instructions is required for Field Nation tasks');
    }
    return { valid: errors.length === 0, errors };
  }

  async estimateCost(_target: Target, _template: CampaignTemplate): Promise<CostEstimate> {
    return { feeCents: 10000, currency: 'USD', estimatedMinutes: 120 };
  }
}
