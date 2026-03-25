import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import { config } from '../config.js';
import * as schema from './schema.js';

const sqlite = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export function initDb(): void {
  // Create tables if they don't exist
  db.run(sql`
    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      provider TEXT NOT NULL,
      template TEXT NOT NULL,
      config TEXT,
      total_tasks INTEGER NOT NULL DEFAULT 0,
      completed_tasks INTEGER NOT NULL DEFAULT 0,
      failed_tasks INTEGER NOT NULL DEFAULT 0,
      webhook_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      sequence INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      target TEXT NOT NULL,
      provider TEXT,
      provider_id TEXT,
      provider_status TEXT,
      provider_data TEXT,
      error TEXT,
      dispatched_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      campaign_id TEXT NOT NULL REFERENCES campaigns(id),
      success INTEGER NOT NULL,
      media_urls TEXT,
      verification_data TEXT,
      fee_cents INTEGER,
      tracking_url TEXT,
      raw_response TEXT,
      created_at TEXT NOT NULL
    )
  `);

  // Indexes for common queries
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_campaign_id ON tasks(campaign_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_results_campaign_id ON results(campaign_id)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_results_task_id ON results(task_id)`);
}
