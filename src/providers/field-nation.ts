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

// Field Nation work order statuses → normalized ClawForce statuses
const STATUS_MAP: Record<string, ProviderStatus['status']> = {
  draft: 'pending',
  published: 'pending',
  routed: 'pending',
  assigned: 'assigned',
  confirmed: 'assigned',
  at_risk: 'assigned',
  provider_running_late: 'assigned',
  provider_on_the_way: 'in_progress',
  provider_checked_in: 'in_progress',
  provider_checked_out: 'in_progress',
  work_done: 'in_progress', // Work done but not yet approved
  approved: 'completed',
  paid: 'completed',
  cancelled: 'cancelled',
  deleted: 'cancelled',
  postponed: 'pending',
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

  /**
   * Field Nation uses OAuth 2.0 password grant.
   * Token is passed as a query parameter, not a Bearer header.
   */
  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    const tokenUrl = `${config.fieldNation.baseUrl}/api/rest/v2/oauth/token`;

    // Field Nation requires form-data, not JSON
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: config.fieldNation.clientId,
      client_secret: config.fieldNation.clientSecret,
      username: config.fieldNation.username,
      password: config.fieldNation.password,
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

  /**
   * Field Nation passes the token as a query parameter on every request.
   */
  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.authenticate();
    const separator = path.includes('?') ? '&' : '?';
    const url = `${config.fieldNation.baseUrl}/api/rest/v2${path}${separator}access_token=${token}`;

    const options: RequestInit = {
      method,
      headers: {
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

    if (response.status === 204) return {};

    return response.json();
  }

  /**
   * Parse an address string into Field Nation's location format.
   */
  private parseLocation(address: string): Record<string, unknown> {
    const parts = address.split(',').map(p => p.trim());

    let addr: Record<string, string> = {
      address1: address,
      address2: '',
      city: '',
      state: '',
      zip: '',
      country: 'US',
    };

    if (parts.length >= 3) {
      const stateZipPart = parts.length >= 4 ? parts[parts.length - 2] : parts[parts.length - 1];
      const stateZipMatch = stateZipPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);

      if (stateZipMatch) {
        addr = {
          address1: parts[0],
          address2: '',
          city: parts.length >= 4 ? parts[parts.length - 3] : parts[1],
          state: stateZipMatch[1],
          zip: stateZipMatch[2],
          country: parts.length >= 4 ? parts[parts.length - 1] : 'US',
        };
      }
    }

    return {
      mode: 'custom',
      ...addr,
      type: { id: 1 }, // 1 = Commercial
    };
  }

  async dispatch(task: Task, template: CampaignTemplate): Promise<DispatchResult> {
    const target: Target = JSON.parse(task.target);

    const attempt = (template._retryAttempt as number) || 0;
    const externalId = attempt > 0
      ? `cf_${task.campaignId}_${task.sequence}_r${attempt}`
      : `cf_${task.campaignId}_${task.sequence}`;

    const title = template.customInstructions?.slice(0, 100) || 'ClawForce Task';

    // Field Nation uses HTML for descriptions
    const descriptionParts = [
      template.customInstructions,
      template.dropoffInstructions,
      `<br><br><b>Target:</b> ${target.name || ''} @ ${target.address}`,
      target.phone ? `<br><b>Phone:</b> ${target.phone}` : '',
      `<br><b>ClawForce ID:</b> ${externalId}`,
    ].filter(Boolean);
    const descriptionHtml = `<p>${descriptionParts.join(' ')}</p>`;

    // Schedule: default to next business day, 4-hour window
    const now = new Date();
    const scheduleStart = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    scheduleStart.setHours(9, 0, 0, 0);
    const scheduleEnd = new Date(scheduleStart.getTime() + 4 * 60 * 60 * 1000);

    // Estimate pay
    const payCents = this.estimatePayCents(template);

    const workOrder: Record<string, unknown> = {
      title,
      description: {
        html: descriptionHtml,
      },
      location: this.parseLocation(target.address),
      schedule: {
        service_window: {
          mode: 'hours',
          start: { utc: this.formatUtcDate(scheduleStart) },
          end: { utc: this.formatUtcDate(scheduleEnd) },
        },
      },
      pay: {
        type: 'fixed',
        base: {
          amount: payCents / 100, // Field Nation uses dollars
          units: 1,
        },
      },
    };

    logger.info({
      externalId,
      address: target.address,
      attempt: attempt + 1,
      payCents,
    }, 'Creating Field Nation work order');

    // Step 1: Create work order (creates in draft)
    const response = await this.request('POST', '/workorders', workOrder);
    const workOrderId = response.id;

    // Step 2: Publish to marketplace so technicians can see and request it
    try {
      await this.request('POST', `/workorders/${workOrderId}/publish`);
      logger.info({ workOrderId }, 'Field Nation work order published');
    } catch (err) {
      logger.warn({ workOrderId, error: (err as Error).message }, 'Failed to publish work order, left in draft');
    }

    return {
      providerId: String(workOrderId),
      providerStatus: 'published',
      providerData: response,
      trackingUrl: `https://app.fieldnation.com/workorders/${workOrderId}`,
    };
  }

  async getStatus(providerTaskId: string): Promise<ProviderStatus> {
    const response = await this.request('GET', `/workorders/${providerTaskId}`);
    const statusObj = response.status as Record<string, any> | undefined;
    const rawStatus = statusObj?.name?.toLowerCase().replace(/ /g, '_') || 'draft';

    return {
      status: STATUS_MAP[rawStatus] || 'in_progress',
      providerStatus: rawStatus,
      providerData: response,
    };
  }

  /**
   * Field Nation uses DELETE to cancel work orders.
   */
  async cancel(providerTaskId: string): Promise<void> {
    await this.request('DELETE', `/workorders/${providerTaskId}`, {
      cancel_reason: 'Cancelled by ClawForce',
      notes: '',
      message_to_provider: 'This task has been cancelled.',
    });
  }

  extractResult(providerData: unknown): ProviderResult {
    const data = providerData as Record<string, any>;
    const statusObj = data.status as Record<string, any> | undefined;
    const rawStatus = statusObj?.name?.toLowerCase().replace(/ /g, '_') || 'draft';

    // Extract media from attachments
    const mediaUrls: string[] = [];
    const attachments = data.attachments as Record<string, any> | undefined;
    if (attachments?.results) {
      for (const folder of attachments.results as Array<Record<string, any>>) {
        const files = folder.results || folder.files || [];
        for (const file of files as Array<Record<string, any>>) {
          if (file.file?.url) mediaUrls.push(file.file.url);
          if (file.url) mediaUrls.push(file.url);
        }
      }
    }

    // Check for signatures
    const signatures = data.signatures as Record<string, any> | undefined;
    if (signatures?.results) {
      for (const sig of signatures.results as Array<Record<string, any>>) {
        if (sig.url) mediaUrls.push(sig.url);
      }
    }

    const isComplete = ['approved', 'paid'].includes(rawStatus);
    const success = isComplete;

    const verificationData: Record<string, unknown> = {
      work_order_status: rawStatus,
      has_attachments: mediaUrls.length > 0,
      attachment_count: mediaUrls.length,
    };

    // Assignee info
    const assignee = data.assignee as Record<string, any> | undefined;
    if (assignee) {
      const name = [assignee.first_name, assignee.last_name].filter(Boolean).join(' ');
      if (name) verificationData.technician_name = name;
      if (assignee.rating) verificationData.technician_rating = assignee.rating;
      if (assignee.phone) verificationData.technician_phone = assignee.phone;
    }

    // Time tracking
    const timeLogs = data.time_logs as Record<string, any> | undefined;
    if (timeLogs?.results) {
      const totalMinutes = (timeLogs.results as Array<Record<string, any>>).reduce(
        (sum: number, log: Record<string, any>) => {
          if (log.hours) return sum + (log.hours as number) * 60;
          return sum;
        }, 0);
      verificationData.total_time_minutes = totalMinutes;
    }

    // Closing notes
    if (data.closing_notes) {
      verificationData.closing_notes = data.closing_notes;
    }

    // Cancellation context
    if (rawStatus === 'cancelled' || rawStatus === 'deleted') {
      verificationData.retryable = true;
    }

    if (rawStatus === 'work_done') {
      verificationData.awaiting_approval = true;
    }

    return {
      success,
      mediaUrls,
      feeCents: data.pay?.base?.amount != null ? Math.round((data.pay.base.amount as number) * 100) : undefined,
      trackingUrl: data.id ? `https://app.fieldnation.com/workorders/${data.id}` : undefined,
      verificationData,
      rawResponse: providerData,
    };
  }

  shouldRetry(providerData: unknown): { retry: boolean; reason: string } {
    const data = providerData as Record<string, any>;
    const statusObj = data.status as Record<string, any> | undefined;
    const rawStatus = statusObj?.name?.toLowerCase().replace(/ /g, '_') || 'draft';

    if (['approved', 'paid'].includes(rawStatus)) {
      return { retry: false, reason: 'success' };
    }

    if (['cancelled', 'deleted'].includes(rawStatus)) {
      return { retry: true, reason: 'cancelled' };
    }

    // Provider removed themselves — retry to get a new one
    if (rawStatus === 'provider_removed_assignment') {
      return { retry: true, reason: 'provider_removed' };
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
   */
  private estimatePayCents(template: CampaignTemplate): number {
    let baseCents = 7500; // $75 base for a standard task

    if (template.estimatedDurationMinutes) {
      baseCents = Math.round((template.estimatedDurationMinutes / 60) * 5000);
      baseCents = Math.max(baseCents, 5000); // $50 minimum
    }

    if (template.errandCategory === 'skilled_labor') {
      baseCents = Math.round(baseCents * 1.3);
    }

    if (template.multiStep || template.errandCategory === 'multi_step') {
      baseCents = Math.round(baseCents * 1.5);
    }

    return baseCents;
  }

  /**
   * Format a Date to Field Nation's expected UTC format: "YYYY-MM-DD HH:MM:SS"
   */
  private formatUtcDate(date: Date): string {
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
  }
}
