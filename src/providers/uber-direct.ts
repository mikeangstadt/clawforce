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

const API_BASE = 'https://api.uber.com/v1';
const AUTH_URL = 'https://auth.uber.com/oauth/v2/token';

// Uber Direct delivery statuses → normalized ClawForce statuses
const STATUS_MAP: Record<string, ProviderStatus['status']> = {
  pending: 'pending',
  pickup: 'assigned',
  pickup_complete: 'in_progress',
  dropoff: 'in_progress',
  delivered: 'completed',
  canceled: 'cancelled',
  returned: 'failed',
};

// Cancellation-like terminal states that warrant a retry
const RETRYABLE_STATUSES = new Set([
  'returned', // Undeliverable — could be a bad address or timing issue
]);

export class UberDirectProvider implements TaskProvider {
  name = 'uber-direct';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  capabilities: ProviderCapabilities = {
    taskTypes: ['delivery', 'errand'],
    errandCategories: ['pickup_dropoff', 'food_delivery'],
    features: ['real_time_tracking', 'verification_photo', 'quotes', 'webhooks'],
    coverage: { countries: ['US', 'CA', 'MX', 'BR', 'AU', 'JP', 'GB', 'FR', 'DE'] },
    maxConcurrency: 10,
    estimatedCostRange: { minCents: 500, maxCents: 1200 },
  };

  private get customerId(): string {
    return config.uberDirect.customerId;
  }

  private get baseUrl(): string {
    return `${API_BASE}/customers/${this.customerId}`;
  }

  private async authenticate(): Promise<string> {
    // Reuse token if still valid (with 5 min buffer)
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 300_000) {
      return this.accessToken;
    }

    const body = new URLSearchParams({
      client_id: config.uberDirect.clientId,
      client_secret: config.uberDirect.clientSecret,
      grant_type: 'client_credentials',
      scope: 'eats.deliveries',
    });

    const response = await fetch(AUTH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Uber Direct auth failed (${response.status}): ${text}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    logger.info('Uber Direct OAuth token acquired');
    return this.accessToken;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.authenticate();
    const url = `${this.baseUrl}${path}`;

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
      throw new Error(`Uber Direct API error (${response.status} ${method} ${path}): ${text}`);
    }

    return response.json();
  }

  /**
   * Format a plain address string into the JSON-string format Uber expects.
   * Uber requires addresses as JSON strings with street_address, city, state, zip_code, country.
   * If the address is already JSON, pass it through. Otherwise, put it all in street_address
   * and let Uber's geocoder resolve it.
   */
  private formatAddress(address: string): string {
    try {
      const parsed = JSON.parse(address);
      if (parsed.street_address) return address; // Already formatted
    } catch {
      // Not JSON — treat as a plain address string
    }

    return JSON.stringify({
      street_address: [address],
      city: '',
      state: '',
      zip_code: '',
      country: 'US',
    });
  }

  async dispatch(task: Task, template: CampaignTemplate): Promise<DispatchResult> {
    const target: Target = JSON.parse(task.target);

    const attempt = (template._retryAttempt as number) || 0;
    const externalId = attempt > 0
      ? `cf_${task.campaignId}_${task.sequence}_r${attempt}`
      : `cf_${task.campaignId}_${task.sequence}`;

    // Build dropoff notes (Uber max 280 chars)
    const notes = this.buildNotes(template, target);

    const deliveryReq: Record<string, unknown> = {
      // Pickup
      pickup_name: template.pickupBusinessName || 'ClawForce Pickup',
      pickup_address: this.formatAddress(template.pickupAddress || ''),
      pickup_phone_number: template.pickupPhoneNumber || '',
      pickup_notes: template.pickupInstructions?.slice(0, 280) || '',

      // Dropoff
      dropoff_name: target.name || 'Dropoff',
      dropoff_address: this.formatAddress(target.address),
      dropoff_phone_number: target.phone || template.dropoffPhoneNumber || '',
      dropoff_notes: notes,

      // Require photo proof at dropoff
      dropoff_verification: {
        picture: true,
      },

      // Leave at door for contactless
      deliverable_action: 'deliverable_action_leave_at_door',
      undeliverable_action: 'return',

      // Manifest
      manifest_items: [{
        name: template.customInstructions?.slice(0, 100) || 'ClawForce task item',
        quantity: 1,
        size: 'small',
      }],
      manifest_total_value: template.orderValue || 0,

      // Tip (in cents)
      tip: template.tip || 0,

      // Our reference
      external_id: externalId,
    };

    logger.info({
      externalId,
      address: target.address,
      attempt: attempt + 1,
    }, 'Dispatching Uber Direct delivery');

    const response = await this.request('POST', '/deliveries', deliveryReq);

    return {
      providerId: response.id, // Uber's delivery ID (del_xxx)
      providerStatus: response.status || 'pending',
      providerData: response,
      trackingUrl: response.tracking_url,
    };
  }

  async getStatus(providerTaskId: string): Promise<ProviderStatus> {
    const response = await this.request('GET', `/deliveries/${providerTaskId}`);
    const rawStatus = response.status || 'pending';

    return {
      status: STATUS_MAP[rawStatus] || 'in_progress',
      providerStatus: rawStatus,
      providerData: response,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    await this.request('POST', `/deliveries/${providerTaskId}/cancel`);
  }

  extractResult(providerData: unknown): ProviderResult {
    const data = providerData as Record<string, any>;
    const status = data.status as string;

    // Extract proof-of-delivery photo from dropoff waypoint
    const mediaUrls: string[] = [];
    const dropoff = data.dropoff as Record<string, any> | undefined;
    if (dropoff?.verification?.picture?.image_url) {
      mediaUrls.push(dropoff.verification.picture.image_url);
    }
    // Also check pickup verification photo
    const pickup = data.pickup as Record<string, any> | undefined;
    if (pickup?.verification?.picture?.image_url) {
      mediaUrls.push(pickup.verification.picture.image_url);
    }

    const delivered = status === 'delivered';
    const hasPhoto = mediaUrls.length > 0;
    const success = delivered && hasPhoto;

    const verificationData: Record<string, unknown> = {
      delivery_status: status,
      has_photo: hasPhoto,
      photo_count: mediaUrls.length,
      live_mode: data.live_mode,
    };

    // Courier info
    if (data.courier) {
      const courier = data.courier as Record<string, unknown>;
      if (courier.name) verificationData.courier_name = courier.name;
      if (courier.vehicle_type) verificationData.vehicle_type = courier.vehicle_type;
      if (courier.phone_number) verificationData.courier_phone = courier.phone_number;
      if (courier.location) verificationData.courier_location = courier.location;
    }

    // Dropoff time
    if (data.dropoff_deadline) verificationData.dropoff_deadline = data.dropoff_deadline;
    if (dropoff?.eta) verificationData.dropoff_eta = dropoff.eta;

    // Track cancellation/return context
    if (status === 'canceled' || status === 'returned') {
      verificationData.retryable = RETRYABLE_STATUSES.has(status);
    }

    // Edge case: delivered but no photo
    if (delivered && !hasPhoto) {
      verificationData.issue = 'delivered_no_photo';
      verificationData.retryable = true;
      logger.warn({ status, hasPhoto }, 'Uber delivery completed but no verification photo received');
    }

    return {
      success,
      mediaUrls,
      feeCents: data.fee != null ? Math.round(data.fee as number) : undefined,
      trackingUrl: data.tracking_url as string | undefined,
      verificationData,
      rawResponse: providerData,
    };
  }

  shouldRetry(providerData: unknown): { retry: boolean; reason: string } {
    const data = providerData as Record<string, any>;
    const status = data.status as string;

    if (status === 'delivered') {
      const hasPhoto = !!data.dropoff?.verification?.picture?.image_url;
      if (!hasPhoto) {
        return { retry: true, reason: 'delivered_no_photo' };
      }
      return { retry: false, reason: 'success' };
    }

    if (status === 'returned') {
      return { retry: true, reason: 'returned_undeliverable' };
    }

    if (status === 'canceled') {
      return { retry: true, reason: 'canceled' };
    }

    return { retry: false, reason: status };
  }

  validateTemplate(template: CampaignTemplate): ValidationResult {
    const errors: string[] = [];
    if (!template.pickupAddress) {
      errors.push('pickup_address is required for Uber Direct deliveries');
    }
    if (!template.pickupPhoneNumber) {
      errors.push('pickup_phone_number is required for Uber Direct deliveries');
    }
    if (!template.dropoffPhoneNumber) {
      errors.push('dropoff_phone_number is required (can be set per-target or in template)');
    }
    return { valid: errors.length === 0, errors };
  }

  async estimateCost(target: Target, template: CampaignTemplate): Promise<CostEstimate> {
    try {
      const quoteReq = {
        pickup_address: this.formatAddress(template.pickupAddress || ''),
        dropoff_address: this.formatAddress(target.address),
        pickup_phone_number: template.pickupPhoneNumber || '',
        dropoff_phone_number: target.phone || template.dropoffPhoneNumber || '',
        manifest_total_value: template.orderValue || 0,
      };

      const quote = await this.request('POST', '/delivery_quotes', quoteReq);

      return {
        feeCents: quote.fee || 800,
        currency: quote.currency_type || 'USD',
        estimatedMinutes: quote.duration || undefined,
      };
    } catch (err) {
      logger.warn({ error: (err as Error).message }, 'Uber Direct quote failed, using estimate');
      return { feeCents: 800, currency: 'USD', estimatedMinutes: 35 };
    }
  }

  /**
   * Build dropoff notes. Uber caps at 280 chars.
   */
  private buildNotes(template: CampaignTemplate, target: Target): string {
    const parts: string[] = [];

    if (template.customInstructions) {
      parts.push(template.customInstructions);
    }

    if (template.dropoffInstructions) {
      parts.push(template.dropoffInstructions);
    }

    if (target.metadata?.venue_type) {
      parts.push(`Venue: ${target.metadata.venue_type}.`);
    }

    parts.push('Photo required at dropoff.');

    const notes = parts.join(' ');

    if (notes.length > 270) {
      logger.warn({
        length: notes.length,
        address: target.address,
      }, 'Notes approaching Uber Direct 280 char limit');
    }

    return notes.slice(0, 280);
  }
}
