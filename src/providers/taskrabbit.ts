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
    errandCategories: ['shopping', 'wait_in_line', 'pickup_dropoff', 'inspection', 'food_delivery', 'personal_errand', 'multi_step', 'skilled_labor'],
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
    if (template.errandCategory === 'shopping' && !template.purchaseBudgetCents) {
      errors.push('purchase_budget_cents is required for shopping errands (agent needs to know spending limit)');
    }
    return { valid: errors.length === 0, errors };
  }

  async estimateCost(_target: Target, template: CampaignTemplate): Promise<CostEstimate> {
    // Errand cost scales with expected duration and complexity
    let baseCents = 3500;
    let minutes = 60;

    if (template.estimatedDurationMinutes) {
      // TaskRabbit charges hourly; scale estimate by duration
      minutes = template.estimatedDurationMinutes;
      baseCents = Math.round((minutes / 60) * 3500);
    }

    if (template.requiresJudgment || template.errandCategory === 'shopping') {
      baseCents = Math.round(baseCents * 1.2); // 20% premium for judgment tasks
    }

    if (template.multiStep || template.errandCategory === 'multi_step') {
      baseCents = Math.round(baseCents * 1.5); // 50% premium for multi-step
    }

    return { feeCents: baseCents, currency: 'USD', estimatedMinutes: minutes };
  }
}
