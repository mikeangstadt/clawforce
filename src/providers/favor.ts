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

export class FavorProvider implements TaskProvider {
  name = 'favor';

  capabilities: ProviderCapabilities = {
    taskTypes: ['delivery', 'errand', 'custom'],
    errandCategories: ['shopping', 'wait_in_line', 'pickup_dropoff', 'food_delivery', 'personal_errand'],
    features: ['real_time_tracking', 'custom_instructions'],
    coverage: {
      countries: ['US'],
      excludedRegions: ['non-TX'], // Texas only — Austin, San Antonio, DFW, Houston, and 200+ TX cities
    },
    maxConcurrency: 10,
    estimatedCostRange: { minCents: 600, maxCents: 2000 },
  };

  async dispatch(_task: Task, _template: CampaignTemplate): Promise<DispatchResult> {
    throw new Error('Favor provider not yet implemented — no public API. Contact Favor/H-E-B for partnership inquiries.');
  }

  async getStatus(_providerTaskId: string): Promise<ProviderStatus> {
    throw new Error('Favor provider not yet implemented');
  }

  async cancel(_providerTaskId: string): Promise<void> {
    throw new Error('Favor provider not yet implemented');
  }

  extractResult(_providerData: unknown): ProviderResult {
    throw new Error('Favor provider not yet implemented');
  }

  validateTemplate(template: CampaignTemplate): ValidationResult {
    const errors: string[] = [];
    if (!template.customInstructions) {
      errors.push('custom_instructions is required for Favor tasks — Runners need clear instructions');
    }
    if (template.errandCategory === 'shopping' && !template.purchaseBudgetCents) {
      errors.push('purchase_budget_cents is required for shopping errands (Runner pays with Favor card, needs a limit)');
    }
    return { valid: errors.length === 0, errors };
  }

  async estimateCost(_target: Target, template: CampaignTemplate): Promise<CostEstimate> {
    // Favor charges a flat delivery fee (~$6) + service fee + tip
    // Errands and "anything delivered" tasks cost more due to time
    let baseCents = 600;
    let minutes = 30;

    if (template.errandCategory === 'wait_in_line') {
      // Waiting errands scale with estimated duration
      minutes = template.estimatedDurationMinutes || 120;
      baseCents = Math.round((minutes / 60) * 1000); // ~$10/hr for wait time + base fee
    } else if (template.errandCategory === 'shopping') {
      minutes = template.estimatedDurationMinutes || 45;
      baseCents = 1000; // Shopping errands ~$10 base
    } else if (template.errandCategory === 'food_delivery') {
      minutes = 30;
      baseCents = 600; // Standard delivery fee
    }

    return { feeCents: baseCents, currency: 'USD', estimatedMinutes: minutes };
  }
}
