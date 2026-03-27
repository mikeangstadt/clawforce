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

const AUTH_PATH = '/authentication/oauth/token';

// Field Nation work order statuses → normalized ClawForce statuses
const STATUS_MAP: Record<string, ProviderStatus['status']> = {
  draft: 'pending',
  published: 'pending',
  routed: 'pending',
  assigned: 'assigned',
  work_scheduled: 'assigned',
  ready_to_go: 'assigned',
  checked_in: 'in_progress',
  on_my_way: 'in_progress',
  work_done: 'in_progress', // Work done but not yet approved
  approved: 'completed',
  paid: 'completed',
  closed: 'completed',
  cancelled: 'cancelled',
};

export class FieldNationProvider implements TaskProvider {
  name = 'field-nation';
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  capabilities: ProviderCapabilities = {
    taskTypes: ['verification', 'survey', 'photo_capture', 'errand', 'custom'],
    errandCategories: ['inspection', 'skilled_labor', 'multi_step'],
    features: ['custom_instructions', 'scheduling', 'worker_rating', 'media_upload'],
    coverage: { countries: ['US'] },
    maxConcurrency: 20,
    estimatedCostRange: { minCents: 5000, maxCents: 20000 },
  };

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 300_000) {
      return this.accessToken;
    }

    const tokenUrl = `${config.fieldNation.baseUrl}${AUTH_PATH}`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.fieldNation.clientId,
      client_secret: config.fieldNation.clientSecret,
    });

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Field Nation auth failed (${response.status}): ${text}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    logger.info('Field Nation OAuth token acquired');
    return this.accessToken;
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.authenticate();
    const url = `${config.fieldNation.baseUrl}/api/rest/v2${path}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Field Nation API error (${response.status} ${method} ${path}): ${text}`);
    }

    // Some endpoints return 204 No Content
    if (response.status === 204) return {};

    return response.json();
  }

  /**
   * Parse an address string into Field Nation's location format.
   */
  private parseLocation(address: string): Record<string, unknown> {
    const parts = address.split(',').map(p => p.trim());

    if (parts.length >= 3) {
      const stateZipPart = parts.length >= 4 ? parts[parts.length - 2] : parts[parts.length - 1];
      const stateZipMatch = stateZipPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);

      if (stateZipMatch) {
        return {
          address1: parts[0],
          address2: '',
          city: parts.length >= 4 ? parts[parts.length - 3] : parts[1],
          state: stateZipMatch[1],
          zip: stateZipMatch[2],
          country: 'US',
        };
      }
    }

    return {
      address1: address,
      address2: '',
      city: '',
      state: '',
      zip: '',
      country: 'US',
    };
  }

  async dispatch(task: Task, template: CampaignTemplate): Promise<DispatchResult> {
    const target: Target = JSON.parse(task.target);

    const attempt = (template._retryAttempt as number) || 0;
    const externalId = attempt > 0
      ? `cf_${task.campaignId}_${task.sequence}_r${attempt}`
      : `cf_${task.campaignId}_${task.sequence}`;

    // Build work order title and description
    const title = template.customInstructions?.slice(0, 100) || 'ClawForce Task';
    const description = [
      template.customInstructions,
      template.dropoffInstructions,
      `\n\nTarget: ${target.name || ''} @ ${target.address}`,
      target.phone ? `Phone: ${target.phone}` : '',
    ].filter(Boolean).join('\n');

    // Schedule: default to next business day, 4-hour window
    const now = new Date();
    const scheduleStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    scheduleStart.setHours(9, 0, 0, 0);
    const scheduleEnd = new Date(scheduleStart.getTime() + 4 * 60 * 60 * 1000);

    // Estimate pay based on task complexity
    const payCents = this.estimatePayCents(template);

    const workOrder = {
      title,
      description,
      type_of_work: this.mapTaskType(template),
      location: this.parseLocation(target.address),
      schedule: {
        start: scheduleStart.toISOString(),
        end: scheduleEnd.toISOString(),
        type: 'exact',
      },
      pay: {
        type: 'fixed',
        amount: payCents / 100, // Field Nation uses dollars
      },
      custom_fields: [
        { name: 'clawforce_campaign_id', value: task.campaignId },
        { name: 'clawforce_external_id', value: externalId },
      ],
      // Auto-publish so it goes to the marketplace immediately
      status: 'published',
      // Require photo uploads as deliverables
      deliverables: {
        required: true,
        instructions: 'Upload all photos and documentation as attachments. Take clear, well-lit photos.',
      },
    };

    logger.info({
      externalId,
      address: target.address,
      attempt: attempt + 1,
      payCents,
    }, 'Dispatching Field Nation work order');

    const response = await this.request('POST', '/work-orders', workOrder);

    return {
      providerId: String(response.id), // Field Nation work order ID
      providerStatus: response.status?.name || 'published',
      providerData: response,
      trackingUrl: response.id ? `https://app.fieldnation.com/workorders/${response.id}` : undefined,
    };
  }

  async getStatus(providerTaskId: string): Promise<ProviderStatus> {
    const response = await this.request('GET', `/work-orders/${providerTaskId}`);
    const rawStatus = response.status?.name || 'draft';

    return {
      status: STATUS_MAP[rawStatus] || 'in_progress',
      providerStatus: rawStatus,
      providerData: response,
    };
  }

  async cancel(providerTaskId: string): Promise<void> {
    await this.request('POST', `/work-orders/${providerTaskId}/cancel`, {
      reason: 'Cancelled by ClawForce',
    });
  }

  extractResult(providerData: unknown): ProviderResult {
    const data = providerData as Record<string, any>;
    const rawStatus = data.status?.name as string || 'draft';

    // Extract media from attachments/shipments
    const mediaUrls: string[] = [];
    const attachments = data.attachments as Array<Record<string, any>> | undefined;
    if (attachments) {
      for (const att of attachments) {
        if (att.url) mediaUrls.push(att.url);
        if (att.thumbnail_url) mediaUrls.push(att.thumbnail_url);
      }
    }

    // Check custom deliverables too
    const shipments = data.shipments as Array<Record<string, any>> | undefined;
    if (shipments) {
      for (const s of shipments) {
        if (s.tracking_url) mediaUrls.push(s.tracking_url);
      }
    }

    const isComplete = ['approved', 'paid', 'closed'].includes(rawStatus);
    const success = isComplete;

    const verificationData: Record<string, unknown> = {
      work_order_status: rawStatus,
      has_attachments: mediaUrls.length > 0,
      attachment_count: mediaUrls.length,
    };

    // Assignee info
    const assignee = data.assignee as Record<string, any> | undefined;
    if (assignee) {
      if (assignee.first_name) verificationData.technician_name = `${assignee.first_name} ${assignee.last_name || ''}`.trim();
      if (assignee.rating) verificationData.technician_rating = assignee.rating;
      if (assignee.phone) verificationData.technician_phone = assignee.phone;
    }

    // Time tracking
    if (data.time_logs) {
      const logs = data.time_logs as Array<Record<string, any>>;
      const totalMinutes = logs.reduce((sum: number, log: Record<string, any>) => {
        if (log.hours) return sum + (log.hours as number) * 60;
        return sum;
      }, 0);
      verificationData.total_time_minutes = totalMinutes;
    }

    // Check-in/check-out times
    if (data.check_in_time) verificationData.check_in_time = data.check_in_time;
    if (data.check_out_time) verificationData.check_out_time = data.check_out_time;

    // Cancellation context
    if (rawStatus === 'cancelled') {
      verificationData.retryable = true;
    }

    // Work done but not approved — still waiting
    if (rawStatus === 'work_done') {
      verificationData.awaiting_approval = true;
    }

    return {
      success,
      mediaUrls,
      feeCents: data.pay?.amount != null ? Math.round((data.pay.amount as number) * 100) : undefined,
      trackingUrl: data.id ? `https://app.fieldnation.com/workorders/${data.id}` : undefined,
      verificationData,
      rawResponse: providerData,
    };
  }

  shouldRetry(providerData: unknown): { retry: boolean; reason: string } {
    const data = providerData as Record<string, any>;
    const rawStatus = data.status?.name as string || 'draft';

    if (['approved', 'paid', 'closed'].includes(rawStatus)) {
      return { retry: false, reason: 'success' };
    }

    if (rawStatus === 'cancelled') {
      return { retry: true, reason: 'cancelled' };
    }

    return { retry: false, reason: rawStatus };
  }

  validateTemplate(template: CampaignTemplate): ValidationResult {
    const errors: string[] = [];
    if (!template.customInstructions) {
      errors.push('custom_instructions is required for Field Nation tasks');
    }
    return { valid: errors.length === 0, errors };
  }

  async estimateCost(_target: Target, template: CampaignTemplate): Promise<CostEstimate> {
    const payCents = this.estimatePayCents(template);
    const minutes = template.estimatedDurationMinutes || 120;

    return { feeCents: payCents, currency: 'USD', estimatedMinutes: minutes };
  }

  /**
   * Estimate pay for a work order based on task complexity.
   * Field Nation technicians expect fair market rates.
   */
  private estimatePayCents(template: CampaignTemplate): number {
    let baseCents = 7500; // $75 base for a standard task

    if (template.estimatedDurationMinutes) {
      // ~$50/hr for skilled work
      baseCents = Math.round((template.estimatedDurationMinutes / 60) * 5000);
      baseCents = Math.max(baseCents, 5000); // $50 minimum
    }

    if (template.errandCategory === 'skilled_labor') {
      baseCents = Math.round(baseCents * 1.3); // 30% premium for skilled labor
    }

    if (template.multiStep || template.errandCategory === 'multi_step') {
      baseCents = Math.round(baseCents * 1.5); // 50% premium for multi-step
    }

    return baseCents;
  }

  /**
   * Map ClawForce task type / errand category to a Field Nation work type string.
   */
  private mapTaskType(template: CampaignTemplate): string {
    if (template.errandCategory === 'skilled_labor') return 'Installation & Setup';
    if (template.errandCategory === 'inspection') return 'Site Survey';
    if (template.errandCategory === 'multi_step') return 'Complex Task';
    return 'Site Survey'; // Default — covers verification, photo_capture, etc.
  }
}
