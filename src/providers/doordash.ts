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

export class DoorDashProvider implements TaskProvider {
  name = 'doordash';
  private client: any; // DoorDashClient — lazy-loaded to avoid import issues without credentials

  capabilities: ProviderCapabilities = {
    taskTypes: ['delivery', 'photo_capture'],
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
    const externalDeliveryId = `cf_${task.campaignId}_${task.sequence}`;

    const deliveryInput: Record<string, unknown> = {
      external_delivery_id: externalDeliveryId,
      pickup_address: template.pickupAddress,
      pickup_business_name: template.pickupBusinessName || 'ClawForce',
      pickup_phone_number: template.pickupPhoneNumber,
      pickup_instructions: template.pickupInstructions || '',
      dropoff_address: target.address,
      dropoff_business_name: target.name || '',
      dropoff_phone_number: target.phone || template.dropoffPhoneNumber,
      dropoff_instructions: template.dropoffInstructions || template.customInstructions || '',
      order_value: template.orderValue || 0,
    };

    if (template.tip) {
      deliveryInput.tip = template.tip;
    }

    logger.info({ externalDeliveryId, address: target.address }, 'Dispatching DoorDash delivery');

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
    const success = status === 'delivered';

    const mediaUrls: string[] = [];
    if (data.dropoff_verification_image_url) {
      mediaUrls.push(data.dropoff_verification_image_url as string);
    }
    if (data.pickup_verification_image_url) {
      mediaUrls.push(data.pickup_verification_image_url as string);
    }

    return {
      success,
      mediaUrls,
      feeCents: data.fee ? Math.round((data.fee as number) * 100) : undefined,
      trackingUrl: data.tracking_url as string | undefined,
      rawResponse: providerData,
    };
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
}
