import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { campaigns, type Campaign, type NewCampaign } from '../db/schema.js';
import { newId } from '../util/id.js';

export function createCampaign(data: Omit<NewCampaign, 'id' | 'createdAt' | 'updatedAt'>): Campaign {
  const now = new Date().toISOString();
  const campaign: NewCampaign = {
    id: newId(),
    ...data,
    createdAt: now,
    updatedAt: now,
  };
  db.insert(campaigns).values(campaign).run();
  return getCampaign(campaign.id!)!;
}

export function getCampaign(id: string): Campaign | undefined {
  return db.select().from(campaigns).where(eq(campaigns.id, id)).get();
}

export function updateCampaign(id: string, data: Partial<Pick<Campaign, 'status' | 'totalTasks' | 'completedTasks' | 'failedTasks' | 'updatedAt'>>): void {
  db.update(campaigns)
    .set({ ...data, updatedAt: new Date().toISOString() })
    .where(eq(campaigns.id, id))
    .run();
}

export function listCampaigns(status?: string, limit = 20): Campaign[] {
  let query = db.select().from(campaigns);
  if (status) {
    query = query.where(eq(campaigns.status, status)) as typeof query;
  }
  return query.limit(limit).all();
}

export function incrementCompleted(id: string): void {
  const campaign = getCampaign(id);
  if (!campaign) return;
  updateCampaign(id, { completedTasks: campaign.completedTasks + 1 });
}

export function incrementFailed(id: string): void {
  const campaign = getCampaign(id);
  if (!campaign) return;
  updateCampaign(id, { failedTasks: campaign.failedTasks + 1 });
}
