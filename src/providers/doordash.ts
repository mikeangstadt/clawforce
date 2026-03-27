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
import { config } from '../config.js';
import { logger } from '../util/logger.js';

// DoorDash delivery status to normalized status mapping
const STATUS_MAP: Record<string, ProviderStatus['status']> = {
  quote: 'pending',
  created: 'pending',
  confirmed: 'pending',
  enroute_to_pickup: 'assigned',
  arrived_at_pickup: 'assigned',
  picked_up: 'in_progress',
  enroute_to_dropoff: 'in_progress',
  arrived_at_dropoff: 'in_progress',
  delivered: 'completed',
  cancelled: 'cancelled',
  enroute_to_return: 'failed',
  arrived_at_return: 'failed',
  returned: 'failed',
};

// Cancellation reasons that are retryable (not the customer/merchant's fault)
const RETRYABLE_CANCELLATIONS = new Set([
  'failed_to_assign_and_refunded', // No Dasher found — try again
  'dasher_not_responding',         // Dasher went AFK
  'dasher_cannot_fulfill_other',   // Dasher bailed — try again
  'too_late',                      // Took too long — try again
  'no_available_dashers',          // Supply issue — retry later
]);

// Non-retryable — something structurally wrong
const NON_RETRYABLE_CANCELLATIONS = new Set([
  'wrong_delivery_address',        // Bad address data
  'cancelled_by_creator',          // We cancelled it
  'fraudulent_order',              // Flagged
  'store_closed',                  // Pickup location closed
  'failed_to_process_payment',     // Payment issue
]);

export class DoorDashProvider implements TaskProvider {
  name = 'doordash';
  private client: any;

  capabilities: ProviderCapabilities = {
    taskTypes: ['delivery', 'photo_capture', 'errand'],
    errandCategories: ['pickup_dropoff', 'food_delivery'],
    features: ['real_time_tracking', 'verification_photo', 'custom_instructions', 'quotes', 'webhooks'],
    coverage: {
      countries: ['US'],
      excludedRegions: ['CA', 'NYC', 'Seattle', 'CO'],
    },
    maxConcurrency: 5,
    estimatedCostRange: { minCents: 775, maxCents: 1500 },
  };

  private async getClient(): Promise<any> {
    if (this.client) return this.client;

    const { DoorDashClient } = await import('@doordash/sdk');
    this.client = new DoorDashClient({
      developer_id: config.doordash.developerId,
      key_id: config.doordash.keyId,
      signing_secret: config.doordash.signingSecret,
    });
    return this.client;
  }

  async dispatch(task: Task, template: CampaignTemplate): Promise<DispatchResult> {
    const client = await this.getClient();
    const target: Target = JSON.parse(task.target);

    // Support retry by appending attempt number to external ID
    const attempt = (template._retryAttempt as number) || 0;
    const externalDeliveryId = attempt > 0
      ? `cf_${task.campaignId}_${task.sequence}_r${attempt}`
      : `cf_${task.campaignId}_${task.sequence}`;

    // Build optimized instructions for maximum Dasher success
    const instructions = this.buildInstructions(template, target);

    // Derive pickup business name from address or template
    const pickupName = template.pickupBusinessName
      || this.extractBusinessName(template.pickupAddress || '')
      || 'Pickup';

    // Build pickup instructions — lead with action so Dasher knows to ORDER
    const pickupInstructions = template.pickupInstructions
      || (template.customInstructions
        ? `PLEASE ORDER AND PAY at ${pickupName}: ${template.customInstructions}`.slice(0, 512)
        : 'Pick up the order.');

    const deliveryInput: Record<string, unknown> = {
      external_delivery_id: externalDeliveryId,

      // Pickup — use the real business name so Dashers know where they're going
      pickup_address: template.pickupAddress,
      pickup_business_name: pickupName,
      pickup_phone_number: template.pickupPhoneNumber,
      pickup_instructions: pickupInstructions,
      pickup_reference_tag: `CLAWFORCE-${task.sequence}`,

      // Dropoff — the target location
      dropoff_address: target.address,
      dropoff_business_name: target.name || '',
      dropoff_phone_number: target.phone || template.dropoffPhoneNumber,
      dropoff_instructions: instructions,

      // Force photo proof — this is the whole point
      contactless_dropoff: true,
      dropoff_options: {
        proof_of_delivery: 'photo_required',
      },

      // Value and tip — default $5 tip if not specified
      order_value: template.orderValue || 0,
      tip: template.tip || 500,

      // If something goes wrong, don't return — just dispose
      action_if_undeliverable: 'dispose',
    };

    logger.info({
      externalDeliveryId,
      address: target.address,
      attempt: attempt + 1,
      instructionLength: instructions.length,
    }, 'Dispatching DoorDash delivery');

    const response = await client.createDelivery(deliveryInput);

    return {
      providerId: externalDeliveryId,
      providerStatus: response.delivery_status || 'created',
      providerData: response,
      trackingUrl: response.tracking_url,
    };
  }

  async getStatus(providerTaskId: string): Promise<ProviderStatus> {
    const client = await this.getClient();
    const response = await client.getDelivery(providerTaskId);
    const rawStatus = response.delivery_status || 'unknown';

    return {
      status: STATUS_MAP[rawStatus] || 'in_progress',
      providerStatus: rawStatus,
      providerData: response,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    const client = await this.getClient();
    await client.cancelDelivery(providerTaskId);
  }

  extractResult(providerData: unknown): ProviderResult {
    const data = providerData as Record<string, unknown>;
    const status = data.delivery_status as string;
    const cancellationReason = data.cancellation_reason as string | undefined;
    const cancellationMessage = data.cancellation_reason_message as string | undefined;

    // Collect all available media
    const mediaUrls: string[] = [];
    if (data.dropoff_verification_image_url) {
      mediaUrls.push(data.dropoff_verification_image_url as string);
    }
    if (data.pickup_verification_image_url) {
      mediaUrls.push(data.pickup_verification_image_url as string);
    }
    if (data.dropoff_signature_image_url) {
      mediaUrls.push(data.dropoff_signature_image_url as string);
    }

    const delivered = status === 'delivered';
    const hasPhoto = mediaUrls.length > 0;

    // Success = delivered AND we got a photo
    const success = delivered && hasPhoto;

    // Build verification data with all available context
    const verificationData: Record<string, unknown> = {
      delivery_status: status,
      has_photo: hasPhoto,
      photo_count: mediaUrls.length,
    };

    if (data.dasher_name) verificationData.dasher_name = data.dasher_name;
    if (data.dasher_id) verificationData.dasher_id = data.dasher_id;
    if (data.dropoff_time_actual) verificationData.dropoff_time = data.dropoff_time_actual;

    // Track Dasher location at time of delivery for GPS verification
    if (data.dasher_location) {
      verificationData.dasher_location = data.dasher_location;
    }

    // Capture cancellation context for retry logic
    if (cancellationReason) {
      verificationData.cancellation_reason = cancellationReason;
      verificationData.retryable = RETRYABLE_CANCELLATIONS.has(cancellationReason);
    }
    if (cancellationMessage) {
      verificationData.cancellation_message = cancellationMessage;
    }

    // Edge case: delivered but no photo — partial success
    if (delivered && !hasPhoto) {
      verificationData.issue = 'delivered_no_photo';
      verificationData.retryable = true;
      logger.warn({ status, hasPhoto }, 'Delivery completed but no verification photo received');
    }

    return {
      success,
      mediaUrls,
      feeCents: data.fee ? Math.round((data.fee as number) * 100) : undefined,
      trackingUrl: data.tracking_url as string | undefined,
      verificationData,
      rawResponse: providerData,
    };
  }

  /**
   * Determine if a failed task should be retried based on the failure reason.
   */
  shouldRetry(providerData: unknown): { retry: boolean; reason: string } {
    const data = providerData as Record<string, unknown>;
    const status = data.delivery_status as string;
    const cancellationReason = data.cancellation_reason as string | undefined;

    // Delivered but no photo — retry to get the photo
    if (status === 'delivered') {
      const hasPhoto = !!(data.dropoff_verification_image_url);
      if (!hasPhoto) {
        return { retry: true, reason: 'delivered_no_photo' };
      }
      return { retry: false, reason: 'success' };
    }

    // Cancelled with a retryable reason
    if (cancellationReason && RETRYABLE_CANCELLATIONS.has(cancellationReason)) {
      return { retry: true, reason: cancellationReason };
    }

    // Non-retryable cancellation
    if (cancellationReason && NON_RETRYABLE_CANCELLATIONS.has(cancellationReason)) {
      return { retry: false, reason: cancellationReason };
    }

    // Unknown cancellation — retry once to be safe
    if (status === 'cancelled') {
      return { retry: true, reason: 'unknown_cancellation' };
    }

    return { retry: false, reason: status };
  }

  validateTemplate(template: CampaignTemplate): ValidationResult {
    const errors: string[] = [];

    if (!template.pickupAddress) {
      errors.push('pickup_address is required for DoorDash deliveries');
    }
    if (!template.pickupPhoneNumber) {
      errors.push('pickup_phone_number is required for DoorDash deliveries');
    }
    if (!template.dropoffPhoneNumber) {
      errors.push('dropoff_phone_number is required (can be set per-target or in template)');
    }

    return { valid: errors.length === 0, errors };
  }

  async estimateCost(target: Target, template: CampaignTemplate): Promise<CostEstimate> {
    const client = await this.getClient();
    const response = await client.createDeliveryQuote({
      pickup_address: template.pickupAddress,
      dropoff_address: target.address,
      order_value: template.orderValue || 0,
    });

    return {
      feeCents: response.fee ? Math.round(response.fee * 100) : 975,
      currency: 'USD',
      estimatedMinutes: response.estimated_pickup_time
        ? Math.round((new Date(response.estimated_pickup_time).getTime() - Date.now()) / 60000)
        : undefined,
    };
  }

  /**
   * Build optimized dropoff instructions that maximize Dasher success rate.
   * Limited to 512 chars by DoorDash, so every word counts.
   */
  private buildInstructions(template: CampaignTemplate, target: Target): string {
    const parts: string[] = [];

    // For photo_capture tasks, lead with what they're doing
    if (template.customInstructions) {
      parts.push(template.customInstructions);
    }

    if (template.dropoffInstructions) {
      parts.push(template.dropoffInstructions);
    }

    // Add venue context if available
    if (target.metadata?.venue_type) {
      parts.push(`Venue type: ${target.metadata.venue_type}.`);
    }

    // Always end with photo requirement
    parts.push('IMPORTANT: Take a clear photo as your proof of delivery.');

    const instructions = parts.join(' ');

    // DoorDash truncates at 512 chars — warn if we're close
    if (instructions.length > 500) {
      logger.warn({
        length: instructions.length,
        address: target.address,
      }, 'Instructions approaching DoorDash 512 char limit');
    }

    return instructions.slice(0, 512);
  }

  /**
   * Extract a business name from an address string like "P. Terry's, 1501 S 1st St, Austin, TX".
   */
  private extractBusinessName(address: string): string | null {
    const firstComma = address.indexOf(',');
    if (firstComma === -1) return null;
    const firstPart = address.slice(0, firstComma).trim();
    if (/^\d/.test(firstPart)) return null;
    return firstPart;
  }
}
