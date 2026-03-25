import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks, type Task, type NewTask } from '../db/schema.js';
import { newId } from '../util/id.js';
import type { Target } from '../util/csv.js';

export function createTasks(campaignId: string, targets: Target[]): Task[] {
  const now = new Date().toISOString();
  const newTasks: NewTask[] = targets.map((target, i) => ({
    id: newId(),
    campaignId,
    sequence: i,
    status: 'pending',
    target: JSON.stringify(target),
    createdAt: now,
    updatedAt: now,
  }));

  // Batch insert in chunks of 100
  for (let i = 0; i < newTasks.length; i += 100) {
    const chunk = newTasks.slice(i, i + 100);
    db.insert(tasks).values(chunk).run();
  }

  return getTasksByCampaign(campaignId);
}

export function getTask(id: string): Task | undefined {
  return db.select().from(tasks).where(eq(tasks.id, id)).get();
}

export function getTasksByCampaign(campaignId: string): Task[] {
  return db.select().from(tasks).where(eq(tasks.campaignId, campaignId)).all();
}

export function getActiveTasks(): Task[] {
  return db.select().from(tasks)
    .where(inArray(tasks.status, ['dispatched', 'assigned', 'in_progress']))
    .all();
}

export function getPendingTasks(campaignId: string): Task[] {
  return db.select().from(tasks)
    .where(eq(tasks.campaignId, campaignId))
    .all()
    .filter(t => t.status === 'pending');
}

export function updateTask(id: string, data: Partial<Pick<Task, 'status' | 'provider' | 'providerId' | 'providerStatus' | 'providerData' | 'error' | 'dispatchedAt' | 'completedAt'>>): void {
  db.update(tasks)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(tasks.id, id))
    .run();
}
