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

// Dolly delivery statuses → normalized ClawForce statuses
const STATUS_MAP: Record<string, ProviderStatus['status']> = {
  COURIER_REQUESTED: 'pending',
  CONFIRMED: 'assigned',
  EN_ROUTE_TO_PICKUP: 'assigned',
  ARRIVED_AT_PICKUP: 'assigned',
  PICKED_UP: 'in_progress',
  EN_ROUTE_TO_DROPOFF: 'in_progress',
  ARRIVED_AT_DROPOFF: 'in_progress',
  DELIVERED: 'completed',
  EN_ROUTE_TO_RETURN: 'failed',
  ARRIVED_AT_RETURN: 'failed',
  RETURNED: 'failed',
  CANCELLED: 'cancelled',
};

// Cancel reasons that indicate a retryable failure
const RETRYABLE_CANCEL_REASONS = new Set([
  'CARRIER_CANCELLED',     // Helper cancelled — try again
  'CAB_NOT_ARRIVED',       // Helper didn't show up
  'ORDER_NOT_READY',       // Timing issue — retry later
  'DELIVERY_TIME_CHANGED', // Schedule shift
]);

export class TaskRabbitProvider implements TaskProvider {
  name = 'taskrabbit';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  capabilities: ProviderCapabilities = {
    taskTypes: ['delivery', 'errand'],
    errandCategories: ['pickup_dropoff', 'food_delivery'],
    features: ['custom_instructions', 'scheduling', 'worker_rating'],
    coverage: { countries: ['US', 'GB', 'CA', 'FR', 'DE', 'ES'] },
    maxConcurrency: 10,
    estimatedCostRange: { minCents: 2000, maxCents: 8000 },
  };

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 300_000) {
      return this.accessToken;
    }

    const tokenUrl = `https://${config.taskrabbit.auth0Domain}/oauth/token`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.taskrabbit.clientId,
      client_secret: config.taskrabbit.clientSecret,
      audience: config.taskrabbit.audience,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TaskRabbit/Dolly auth failed (${response.status}): ${text}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    logger.info('TaskRabbit/Dolly OAuth token acquired');
    return this.accessToken;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.authenticate();
    const url = `${config.taskrabbit.baseUrl}${path}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`TaskRabbit/Dolly API error (${response.status} ${method} ${path}): ${text}`);
    }

    return response.json();
  }

  /**
   * Parse a plain address string into Dolly's structured address format.
   * Tries to extract city/state/zip from comma-separated format,
   * otherwise puts everything in addressLine1 and lets Dolly geocode.
   */
  private parseAddress(address: string): Record<string, string> {
    const parts = address.split(',').map(p => p.trim());

    if (parts.length >= 3) {
      // Try to parse "street, city, state zip" or "street, city, state zip, country"
      const lastPart = parts[parts.length - 1];
      const stateZipPart = parts.length >= 4 ? parts[parts.length - 2] : lastPart;
      const stateZipMatch = stateZipPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);

      if (stateZipMatch) {
        return {
          addressLine1: parts[0],
          addressLine2: '',
          city: parts.length >= 4 ? parts[parts.length - 3] : parts[1],
          state: stateZipMatch[1],
          zipCode: stateZipMatch[2],
          country: parts.length >= 4 ? lastPart : 'US',
        };
      }
    }

    // Fallback: put everything in line 1
    return {
      addressLine1: address,
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
    };
  }

  async dispatch(task: Task, template: CampaignTemplate): Promise<DispatchResult> {
    const target: Target = JSON.parse(task.target);

    const attempt = (template._retryAttempt as number) || 0;
    const externalDeliveryId = attempt > 0
      ? `cf_${task.campaignId}_${task.sequence}_r${attempt}`
      : `cf_${task.campaignId}_${task.sequence}`;
    const externalOrderId = `cfo_${task.campaignId}_${task.sequence}`;

    // Build pickup/delivery windows (default: 4 hours from now, 1-hour windows)
    const now = new Date();
    const pickupStart = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const pickupEnd = new Date(pickupStart.getTime() + 30 * 60 * 1000);
    const deliveryStart = new Date(pickupEnd.getTime() + 30 * 60 * 1000);
    const deliveryEnd = new Date(deliveryStart.getTime() + 60 * 60 * 1000);

    const pickupAddress = this.parseAddress(template.pickupAddress || '');
    const dropoffAddress = this.parseAddress(target.address);

    // Build dropoff instructions with custom task instructions
    const dropoffInstruction = [
      template.customInstructions,
      template.dropoffInstructions,
    ].filter(Boolean).join(' ').slice(0, 500);

    const deliveryReq = {
      batchingWorkflow: 'single',
      clientId: config.taskrabbit.clientEntityId,
      containsAlcohol: false,
      isAutonomousDelivery: false,
      externalDeliveryId,
      externalOrderId,
      externalStoreId: config.taskrabbit.storeId,
      tip: template.tip ? template.tip / 100 : 0, // Dolly takes dollars, not cents

      pickupWindowStartTime: pickupStart.toISOString(),
      pickupWindowEndTime: pickupEnd.toISOString(),
      deliveryWindowStartTime: deliveryStart.toISOString(),
      deliveryWindowEndTime: deliveryEnd.toISOString(),

      pickupInfo: {
        pickupAddress,
        pickupContact: {
          firstName: 'ClawForce',
          lastName: 'Dispatch',
          phone: template.pickupPhoneNumber || '',
        },
        pickupLocation: { latitude: 0.0, longitude: 0.0 },
        pickupInstruction: template.pickupInstructions?.slice(0, 500) || '',
        signatureRequired: false,
      },

      dropOffInfo: {
        dropOffAddress: dropoffAddress,
        dropOffContact: {
          firstName: target.name?.split(' ')[0] || 'Recipient',
          lastName: target.name?.split(' ').slice(1).join(' ') || '',
          phone: target.phone || template.dropoffPhoneNumber || '',
        },
        dropOffLocation: { latitude: 0.0, longitude: 0.0 },
        dropOffInstruction: dropoffInstruction,
        isUnattended: true,
        signatureRequired: false,
      },

      orderInfo: {
        totalWeight: 1,
        totalVolume: 1,
        totalQuantity: 1,
        orderLineItems: [{
          quantity: 1,
          orderedWeight: 1,
          uom: 'LB',
          height: 1,
          width: 1,
          length: 1,
          uomDimension: 'FT',
          name: template.customInstructions?.slice(0, 100) || 'ClawForce task item',
          description: template.customInstructions?.slice(0, 200) || '',
        }],
      },
    };

    logger.info({
      externalDeliveryId,
      address: target.address,
      attempt: attempt + 1,
    }, 'Dispatching TaskRabbit/Dolly delivery');

    const response = await this.request('POST', '/v1/deliveries/', deliveryReq);

    return {
      providerId: response.id, // Dolly's UUID
      providerStatus: 'COURIER_REQUESTED',
      providerData: response,
    };
  }

  async getStatus(providerTaskId: string): Promise<ProviderStatus> {
    const response = await this.request('GET', `/v1/deliveries/${providerTaskId}`);
    const rawStatus = response.status || 'COURIER_REQUESTED';

    return {
      status: STATUS_MAP[rawStatus] || 'in_progress',
      providerStatus: rawStatus,
      providerData: response,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    await this.request('PUT', `/v1/deliveries/${providerTaskId}/cancel`, {
      cancelReason: 'OTHER',
      comment: 'Cancelled by ClawForce',
    });
  }

  extractResult(providerData: unknown): ProviderResult {
    const data = providerData as Record<string, any>;
    const status = data.status as string;

    // Extract proof-of-delivery photos
    const mediaUrls: string[] = [];
    const dropoffVerification = data.dropoffVerification || data.dropOffVerification;
    if (dropoffVerification?.deliveryProofImageUrl) {
      mediaUrls.push(dropoffVerification.deliveryProofImageUrl);
    }
    if (dropoffVerification?.signatureImageUrl) {
      mediaUrls.push(dropoffVerification.signatureImageUrl);
    }
    const pickupVerification = data.pickupVerification;
    if (pickupVerification?.deliveryProofImageUrl) {
      mediaUrls.push(pickupVerification.deliveryProofImageUrl);
    }

    const delivered = status === 'DELIVERED';
    const success = delivered;

    const verificationData: Record<string, unknown> = {
      delivery_status: status,
      has_photo: mediaUrls.length > 0,
      photo_count: mediaUrls.length,
    };

    // Courier info
    if (data.courier) {
      const courier = data.courier as Record<string, unknown>;
      if (courier.fullName) verificationData.courier_name = courier.fullName;
      if (courier.phoneNumber) verificationData.courier_phone = courier.phoneNumber;
      if (courier.location) verificationData.courier_location = courier.location;
      if (courier.vehicle) verificationData.courier_vehicle = courier.vehicle;
    }

    // Timing info
    if (data.actualDeliveryTime) verificationData.delivery_time = data.actualDeliveryTime;
    if (data.actualPickupTime) verificationData.pickup_time = data.actualPickupTime;

    // Cancellation context
    if (status === 'CANCELLED') {
      const reason = data.cancelReasonCode as string | undefined;
      verificationData.cancellation_reason = reason;
      verificationData.cancelled_by = data.cancelledBy;
      verificationData.retryable = reason ? RETRYABLE_CANCEL_REASONS.has(reason) : true;
    }

    if (status === 'RETURNED') {
      verificationData.return_reason = data.returnReasonCode;
      verificationData.retryable = true;
    }

    return {
      success,
      mediaUrls,
      feeCents: data.fee != null ? Math.round(data.fee * 100) : undefined, // Dolly reports dollars
      trackingUrl: undefined, // Dolly doesn't provide tracking URLs
      verificationData,
      rawResponse: providerData,
    };
  }

  shouldRetry(providerData: unknown): { retry: boolean; reason: string } {
    const data = providerData as Record<string, any>;
    const status = data.status as string;

    if (status === 'DELIVERED') {
      return { retry: false, reason: 'success' };
    }

    if (status === 'RETURNED') {
      return { retry: true, reason: 'returned' };
    }

    if (status === 'CANCELLED') {
      const reason = data.cancelReasonCode as string | undefined;
      if (reason && RETRYABLE_CANCEL_REASONS.has(reason)) {
        return { retry: true, reason };
      }
      if (reason === 'FRAUD_ORDER' || reason === 'SYSTEM_ERROR') {
        return { retry: false, reason };
      }
      return { retry: true, reason: reason || 'unknown_cancellation' };
    }

    return { retry: false, reason: status };
  }

  validateTemplate(template: CampaignTemplate): ValidationResult {
    const errors: string[] = [];
    if (!template.customInstructions) {
      errors.push('custom_instructions is required for TaskRabbit tasks');
    }
    if (!template.pickupAddress) {
      errors.push('pickup_address is required for TaskRabbit/Dolly deliveries');
    }
    if (!template.pickupPhoneNumber) {
      errors.push('pickup_phone_number is required for TaskRabbit/Dolly deliveries');
    }
    if (template.errandCategory === 'shopping' && !template.purchaseBudgetCents) {
      errors.push('purchase_budget_cents is required for shopping errands (agent needs to know spending limit)');
    }
    return { valid: errors.length === 0, errors };
  }

  async estimateCost(target: Target, template: CampaignTemplate): Promise<CostEstimate> {
    try {
      // Use the quote endpoint for real pricing
      const now = new Date();
      const pickupStart = new Date(now.getTime() + 4 * 60 * 60 * 1000);
      const pickupEnd = new Date(pickupStart.getTime() + 30 * 60 * 1000);
      const deliveryStart = new Date(pickupEnd.getTime() + 30 * 60 * 1000);
      const deliveryEnd = new Date(deliveryStart.getTime() + 60 * 60 * 1000);

      const quoteReq = {
        batchingWorkflow: 'single',
        clientId: config.taskrabbit.clientEntityId,
        containsAlcohol: false,
        isAutonomousDelivery: false,
        externalDeliveryId: `cfq_${Date.now()}`,
        externalOrderId: `cfoq_${Date.now()}`,
        externalStoreId: config.taskrabbit.storeId,
        pickupWindowStartTime: pickupStart.toISOString(),
        pickupWindowEndTime: pickupEnd.toISOString(),
        deliveryWindowStartTime: deliveryStart.toISOString(),
        deliveryWindowEndTime: deliveryEnd.toISOString(),
        pickupInfo: {
          pickupAddress: this.parseAddress(template.pickupAddress || ''),
          pickupContact: { firstName: 'ClawForce', lastName: 'Quote', phone: template.pickupPhoneNumber || '' },
          pickupLocation: { latitude: 0.0, longitude: 0.0 },
          signatureRequired: false,
        },
        dropOffInfo: {
          dropOffAddress: this.parseAddress(target.address),
          dropOffContact: { firstName: 'Quote', lastName: 'Recipient', phone: '' },
          dropOffLocation: { latitude: 0.0, longitude: 0.0 },
          isUnattended: true,
          signatureRequired: false,
        },
        orderInfo: {
          totalWeight: 1,
          totalVolume: 1,
          totalQuantity: 1,
          orderLineItems: [{ quantity: 1, orderedWeight: 1, uom: 'LB', height: 1, width: 1, length: 1, uomDimension: 'FT' }],
        },
      };

      const quote = await this.request('POST', '/v1/quote/', quoteReq);

      return {
        feeCents: quote.fee != null ? Math.round(quote.fee * 100) : 3500,
        currency: quote.currency || 'USD',
        estimatedMinutes: quote.estimatedDeliveryTime
          ? Math.round((new Date(quote.estimatedDeliveryTime).getTime() - Date.now()) / 60000)
          : undefined,
      };
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'TaskRabbit/Dolly quote failed, using estimate');

      // Fallback to duration-based estimate
      let baseCents = 3500;
      let minutes = 60;

      if (template.estimatedDurationMinutes) {
        minutes = template.estimatedDurationMinutes;
        baseCents = Math.round((minutes / 60) * 3500);
      }
      if (template.requiresJudgment || template.errandCategory === 'shopping') {
        baseCents = Math.round(baseCents * 1.2);
      }
      if (template.multiStep || template.errandCategory === 'multi_step') {
        baseCents = Math.round(baseCents * 1.5);
      }

      return { feeCents: baseCents, currency: 'USD', estimatedMinutes: minutes };
    }
  }
}
