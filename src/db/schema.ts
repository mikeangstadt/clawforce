import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(), // delivery, photo_capture, verification, errand, survey, custom
  status: text('status').notNull().default('draft'), // draft, dispatching, active, paused, completed, failed, cancelled
  provider: text('provider').notNull(), // doordash, taskrabbit, uber-direct, field-nation, mock, auto
  template: text('template').notNull(), // JSON: CampaignTemplate
  config: text('config'), // JSON: FanoutConfig
  totalTasks: integer('total_tasks').notNull().default(0),
  completedTasks: integer('completed_tasks').notNull().default(0),
  failedTasks: integer('failed_tasks').notNull().default(0),
  webhookUrl: text('webhook_url'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  sequence: integer('sequence').notNull(),
  status: text('status').notNull().default('pending'), // pending, dispatching, dispatched, assigned, in_progress, completed, failed, cancelled
  target: text('target').notNull(), // JSON: Target
  provider: text('provider'), // Which provider handled this task (for multi-provider campaigns)
  providerId: text('provider_id'), // External ID from provider
  providerStatus: text('provider_status'),
  providerData: text('provider_data'), // JSON: full provider response
  error: text('error'),
  dispatchedAt: text('dispatched_at'),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const results = sqliteTable('results', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  campaignId: text('campaign_id').notNull().references(() => campaigns.id),
  success: integer('success').notNull(), // 0 or 1
  mediaUrls: text('media_urls'), // JSON: string[]
  verificationData: text('verification_data'), // JSON: arbitrary structured data
  feeCents: integer('fee_cents'),
  trackingUrl: text('tracking_url'),
  rawResponse: text('raw_response'), // JSON: full provider response
  createdAt: text('created_at').notNull(),
});

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Result = typeof results.$inferSelect;
export type NewResult = typeof results.$inferInsert;
