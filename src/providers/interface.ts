import type { Task } from '../db/schema.js';
import type { Target } from '../util/csv.js';

// Task types that providers can support
export type TaskType = 'delivery' | 'photo_capture' | 'verification' | 'errand' | 'survey' | 'custom';

// Errand categories — what kinds of flexible real-world tasks a provider can handle.
// Used by the routing engine to match open-ended errand requests to the right provider.
export type ErrandCategory =
  | 'shopping'        // Buy something from a store (requires judgment — pick a ripe avocado, a straight 2x4)
  | 'wait_in_line'    // Wait at a location and purchase/collect something (Franklin's BBQ, DMV, etc.)
  | 'pickup_dropoff'  // Pick up from A, deliver to B (dry cleaning, returns, packages)
  | 'inspection'      // Go look at something and report back (property, vehicle, venue)
  | 'food_delivery'   // Order/pick up food and deliver it
  | 'personal_errand' // General personal tasks (drop off mail, water plants, let the dog out)
  | 'multi_step'      // Complex tasks with 2+ stops or sequential steps
  | 'skilled_labor';  // Tasks requiring trade skills (assembly, installation, repair)

// Features a provider may offer
export type ProviderFeature =
  | 'real_time_tracking'
  | 'verification_photo'
  | 'custom_instructions'
  | 'scheduling'
  | 'quotes'
  | 'webhooks'
  | 'media_upload'
  | 'worker_rating';

export interface CoverageArea {
  countries: string[]; // ISO 3166-1 alpha-2 codes, or ['*'] for global
  excludedRegions?: string[]; // e.g., ['CA', 'NYC', 'Seattle', 'CO'] for DoorDash
}

export interface ProviderCapabilities {
  taskTypes: TaskType[];
  errandCategories: ErrandCategory[]; // What kinds of errands this provider can handle
  features: ProviderFeature[];
  coverage: CoverageArea;
  maxConcurrency: number;
  estimatedCostRange: { minCents: number; maxCents: number };
}

export interface CampaignTemplate {
  pickupAddress?: string;
  pickupBusinessName?: string;
  pickupPhoneNumber?: string;
  pickupInstructions?: string;
  dropoffPhoneNumber?: string;
  dropoffInstructions?: string;
  orderValue?: number;
  tip?: number;
  customInstructions?: string;

  // Errand-specific fields — used when type is 'errand' or 'custom'
  errandCategory?: ErrandCategory;       // Helps route to the right provider
  purchaseBudgetCents?: number;           // Max spend for shopping errands (agent pays, gets reimbursed)
  estimatedDurationMinutes?: number;      // Expected task duration (e.g., 180 for a BBQ line wait)
  requiresJudgment?: boolean;            // Does the agent need to make quality decisions? (e.g., pick a straight 2x4)
  multiStep?: boolean;                   // Does this involve multiple locations or sequential steps?
  returnTrip?: boolean;                  // Does the agent need to come back (e.g., dry cleaning roundtrip)?

  [key: string]: unknown; // Provider-specific fields
}

export interface DispatchResult {
  providerId: string;
  providerStatus: string;
  providerData: unknown;
  trackingUrl?: string;
}

export interface ProviderStatus {
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  providerStatus: string;
  providerData: unknown;
}

export interface ProviderResult {
  success: boolean;
  mediaUrls: string[];
  feeCents?: number;
  trackingUrl?: string;
  verificationData?: Record<string, unknown>;
  rawResponse: unknown;
}

export interface CostEstimate {
  feeCents: number;
  currency: string;
  estimatedMinutes?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface TaskProvider {
  name: string;
  capabilities: ProviderCapabilities;

  dispatch(task: Task, template: CampaignTemplate): Promise<DispatchResult>;
  getStatus(providerTaskId: string): Promise<ProviderStatus>;
  cancel(providerTaskId: string): Promise<void>;
  extractResult(providerData: unknown): ProviderResult;
  validateTemplate(template: CampaignTemplate): ValidationResult;

  // Optional — only if provider supports 'quotes' feature
  estimateCost?(target: Target, template: CampaignTemplate): Promise<CostEstimate>;

  // Optional — determine if a failed task should be automatically retried
  shouldRetry?(providerData: unknown): { retry: boolean; reason: string };
}
