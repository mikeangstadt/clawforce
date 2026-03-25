import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { results, type Result, type NewResult } from '../db/schema.js';
import { newId } from '../util/id.js';

export function createResult(data: Omit<NewResult, 'id' | 'createdAt'>): Result {
  const result: NewResult = {
    id: newId(),
    ...data,
    createdAt: new Date().toISOString(),
  };
  db.insert(results).values(result).run();
  return getResultByTask(data.taskId)!;
}

export function getResultByTask(taskId: string): Result | undefined {
  return db.select().from(results).where(eq(results.taskId, taskId)).get();
}

export function getResultsByCampaign(campaignId: string): Result[] {
  return db.select().from(results).where(eq(results.campaignId, campaignId)).all();
}
