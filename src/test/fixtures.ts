import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { setProviders } from '@/lib/providers';
import { mockProviders } from '@/lib/providers/mock';
import { localStorage } from '@/lib/providers/storage';
import { mockTikTok } from '@/lib/tiktok';
import { setInlineWaitScale } from '@/lib/engine/runs';
import { monthStart } from '@/lib/domain/dates';
import { freshDb } from './db';

export async function setup() {
  const db = await freshDb();
  const p = mockProviders(localStorage(mkdtempSync(path.join(tmpdir(), 'storage-'))));
  setProviders(p);
  mockTikTok(true);
  setInlineWaitScale(0);
  return { db, p };
}

export async function seedCompany(db: Db, opts: { autopilot?: boolean; budgetCents?: number } = {}) {
  const [user] = await db.insert(schema.users).values({ email: `u${Math.random()}@agency.test` }).returning();
  const [ws] = await db.insert(schema.workspaces).values({ name: 'WS', slug: `ws-${Math.random()}`, autopilot: opts.autopilot ?? false }).returning();
  await db.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
  const [company] = await db
    .insert(schema.companies)
    .values({ workspaceId: ws.id, name: 'Acme', slug: `acme-${Math.random()}`, currency: 'USD', websiteUrl: 'https://acme.test', headquartersCountry: 'US', status: 'active' })
    .returning();
  await db.insert(schema.brandProfiles).values({ companyId: company.id, version: 1, isCurrent: true, primaryColors: ['#111827'] });
  await db.insert(schema.tiktokConnections).values({ companyId: company.id, advertiserId: '1', adsAccessTokenEnc: 'x', postingAccessTokenEnc: 'x' });
  const [goal] = await db
    .insert(schema.monthlyGoals)
    .values({ companyId: company.id, month: monthStart(new Date()), prompt: 'Grow', adBudgetCents: opts.budgetCents ?? 100_000, locations: ['US'] })
    .returning();
  const [plan] = await db
    .insert(schema.marketingPlans)
    .values({ companyId: company.id, monthlyGoalId: goal.id, status: 'approved' })
    .returning();
  await db.insert(schema.audienceSegments).values({
    companyId: company.id,
    name: 'Broad US adults',
    ageGroups: ['AGE_18_24', 'AGE_25_34'],
    genders: ['GENDER_UNLIMITED'],
    locationIds: ['6252001'],
    interestLabels: ['Fitness'],
    rationale: 'test',
  });
  return { user, ws, company, goal, plan };
}

export async function idle(db: Db, timeoutMs = 20_000) {
  const start = Date.now();
  let quiet = 0;
  while (Date.now() - start < timeoutMs) {
    const busy = await db.select({ id: schema.agentRuns.id }).from(schema.agentRuns).where(inArray(schema.agentRuns.status, ['queued', 'running']));
    quiet = busy.length ? 0 : quiet + 1;
    if (quiet >= 3) return;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('runs did not finish');
}
