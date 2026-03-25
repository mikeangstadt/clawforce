import type { Task } from '../db/schema.js';
import type { Target } from '../util/csv.js';

// Task types that providers can support
export type TaskType = 'delivery' | 'photo_capture' | 'verification' | 'errand' | 'survey' | 'custom';

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
}
