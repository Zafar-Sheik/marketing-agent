import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { freshDb } from '@/test/db';
import { schema, type Db } from '@/db';
import { setProviders } from '@/lib/providers';
import { mockProviders, solidPng } from '@/lib/providers/mock';
import { localStorage } from '@/lib/providers/storage';
import { mockTikTok } from '@/lib/tiktok';
import { storeAsset } from '@/lib/assets';
import { monthStart, toIsoDate } from '@/lib/domain/dates';
import { startWorkflow, setInlineWaitScale } from './runs';
import { decide } from '@/lib/services/approvals';
import { selectLogo } from '@/lib/services/logos';

let db: Db;
let p: ReturnType<typeof mockProviders>;
const ids: Record<string, string> = {};
const month = monthStart(new Date());

/** Inline runs are fire-and-forget; wait until nothing is queued or running. */
async function idle(timeoutMs = 20_000) {
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

async function failedRuns() {
  return db.select().from(schema.agentRuns).where(eq(schema.agentRuns.status, 'failed'));
}

async function approvePending(subjectType: string) {
  const pending = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.decision, 'pending'), eq(schema.approvals.subjectType, subjectType as 'creative')));
  for (const a of pending) await decide(db, a.id, ids.user, 'approved');
  return pending.length;
}

beforeAll(async () => {
  db = await freshDb();
  p = mockProviders(localStorage(mkdtempSync(path.join(tmpdir(), 'storage-'))));
  setProviders(p);
  mockTikTok(true);
  setInlineWaitScale(0);
  const [user] = await db.insert(schema.users).values({ email: 'owner@agency.test', name: 'Owner' }).returning();
  const [ws] = await db.insert(schema.workspaces).values({ name: 'Agency', slug: 'agency' }).returning();
  await db.insert(schema.workspaceMembers).values({ workspaceId: ws.id, userId: user.id, role: 'owner' });
  const [company] = await db
    .insert(schema.companies)
    .values({ workspaceId: ws.id, name: 'Kauai Cafe', slug: 'kauai', industry: 'Food & Beverage', currency: 'ZAR', websiteUrl: 'https://kauai.test', headquartersCountry: 'ZA', timezone: 'Africa/Johannesburg', monthlyAdBudgetCents: 1_500_000 })
    .returning();
  await db.insert(schema.brandProfiles).values({ companyId: company.id, version: 1, isCurrent: true, primaryColors: ['#0F766E', '#F59E0B'], toneOfVoice: 'Warm and playful' });
  await db.insert(schema.tiktokConnections).values({ companyId: company.id, advertiserId: '7000', adsAccessTokenEnc: 'mock', businessOpenId: 'open', postingAccessTokenEnc: 'mock' });
  const asset = await storeAsset(db, p, { companyId: company.id, key: `companies/${company.id}/portfolio/shoot`, bytes: solidPng([15, 118, 110], 10, 10), mimeType: 'image/png' });
  await db.insert(schema.portfolioItems).values({ companyId: company.id, assetId: asset.id, title: 'Smoothie shoot' });
  Object.assign(ids, { user: user.id, ws: ws.id, company: company.id });
});

describe('a client month, end to end (offline providers)', () => {
  it('trains on the brand', async () => {
    await startWorkflow('brand-training', { companyId: ids.company, subjectType: 'company', subjectId: ids.company });
    await idle();
    expect(await failedRuns()).toEqual([]);
    const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, ids.company));
    expect(company.status).toBe('active');
    const profiles = await db.select().from(schema.brandProfiles).where(eq(schema.brandProfiles.companyId, ids.company));
    expect(profiles.filter((b) => b.isCurrent).map((b) => b.version)).toEqual([2]);
    expect(profiles.find((b) => b.isCurrent)?.primaryColors).toEqual(['#0F766E', '#F59E0B']); // operator's colours kept
    const chunks = await db.select().from(schema.knowledgeChunks).where(eq(schema.knowledgeChunks.companyId, ids.company));
    expect(chunks.length).toBeGreaterThan(1);
    const [item] = await db.select().from(schema.portfolioItems);
    expect(item.aiDescription).toBeTruthy();
  });

  it('retraining replaces memory instead of duplicating it', async () => {
    const before = (await db.select().from(schema.knowledgeChunks)).length;
    await startWorkflow('brand-training', { companyId: ids.company, subjectType: 'company', subjectId: ids.company });
    await idle();
    expect((await db.select().from(schema.knowledgeChunks)).length).toBe(before);
  });

  it('researches the market and drafts a plan inside the budget', async () => {
    const [request] = await db
      .insert(schema.contentRequests)
      .values({ companyId: ids.company, weekStart: toIsoDate(new Date(Date.now() - ((new Date().getUTCDay() + 6) % 7) * 86_400_000)), format: 'short_video', prompt: 'Friday 2-for-1 smoothie deal', isPaid: false })
      .returning();
    ids.request = request.id;
    const [goal] = await db
      .insert(schema.monthlyGoals)
      .values({ companyId: ids.company, month, prompt: 'Launch the summer menu and grow followers 20%', kpis: [{ metric: 'followers', target: 20, unit: '%' }], adBudgetCents: 1_500_000, locations: ['ZA'] })
      .returning();
    ids.goal = goal.id;
    await startWorkflow('monthly-plan', { companyId: ids.company, subjectType: 'monthly_goal', subjectId: goal.id, input: { goalId: goal.id } });
    await idle();
    expect(await failedRuns()).toEqual([]);

    const [research] = await db.select().from(schema.researchReports);
    expect(research.status).toBe('succeeded');
    expect(research.sources.length).toBeGreaterThan(0);
    const segments = await db.select().from(schema.audienceSegments);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.locationIds.includes('953987'))).toBe(true);

    const [plan] = await db.select().from(schema.marketingPlans);
    expect(plan.status).toBe('pending_approval');
    const items = await db.select().from(schema.planItems).where(eq(schema.planItems.marketingPlanId, plan.id));
    expect(items.length).toBeGreaterThan(5);
    expect(items.reduce((s, i) => s + i.plannedSpendCents, 0)).toBeLessThanOrEqual(1_500_000);
    expect(items.some((i) => i.contentRequestId === ids.request)).toBe(true);
    const [req] = await db.select().from(schema.contentRequests).where(eq(schema.contentRequests.id, ids.request));
    expect(req.status).toBe('planned');
  });

  it('revises the plan as a new version when changes are requested', async () => {
    const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.decision, 'pending'));
    await decide(db, approval.id, ids.user, 'changes_requested', 'More behind-the-scenes please');
    await idle();
    const plans = await db.select().from(schema.marketingPlans).orderBy(schema.marketingPlans.version);
    expect(plans.map((p) => [p.version, p.status])).toEqual([
      [1, 'changes_requested'],
      [2, 'pending_approval'],
    ]);
    expect(plans[1].feedback).toBe('More behind-the-scenes please');
  });

  it('approving the plan produces the next week of content, each brand-checked', async () => {
    expect(await approvePending('marketing_plan')).toBe(1);
    await idle();
    expect(await failedRuns()).toEqual([]);
    const creatives = await db.select().from(schema.creatives);
    expect(creatives.length).toBeGreaterThan(0);
    for (const c of creatives) {
      expect(c.status).toBe('in_review');
      expect(c.brandScore).toBeGreaterThanOrEqual(0.8);
      expect(c.hook).toBeTruthy();
    }
    const files = await db.select().from(schema.creativeAssets);
    const video = creatives.find((c) => c.format === 'short_video')!;
    const roles = files.filter((f) => f.creativeId === video.id).map((f) => f.role);
    expect(roles).toEqual(expect.arrayContaining(['frame', 'clip', 'voiceover', 'final']));
  });

  it('regenerating a creative keeps lineage', async () => {
    const [creative] = await db.select().from(schema.creatives).where(eq(schema.creatives.status, 'in_review')).limit(1);
    const [approval] = await db.select().from(schema.approvals).where(and(eq(schema.approvals.subjectId, creative.id), eq(schema.approvals.decision, 'pending')));
    await decide(db, approval.id, ids.user, 'changes_requested', 'Warmer colours');
    await idle();
    const [child] = await db.select().from(schema.creatives).where(eq(schema.creatives.parentCreativeId, creative.id));
    expect(child.status).toBe('in_review');
    expect(child.feedback === null || typeof child.feedback === 'string').toBe(true);
  });

  it('approved content goes out: paid -> ads proposal, organic -> published post', async () => {
    await approvePending('creative');
    await idle();
    expect(await failedRuns()).toEqual([]);
    const posts = await db.select().from(schema.organicPosts);
    expect(posts.length).toBeGreaterThan(0);
    expect(posts.every((p) => p.status === 'published' && p.tiktokPostId)).toBe(true);

    const campaigns = await db.select().from(schema.adCampaigns);
    expect(campaigns.length).toBeGreaterThan(0);
    expect(campaigns.every((c) => c.status === 'pending_approval')).toBe(true);
    expect(campaigns.reduce((s, c) => s + c.budgetCents, 0)).toBeLessThanOrEqual(1_500_000);
    expect(mockTikTok().calls.find((c) => c.method === 'createCampaign')).toBeUndefined(); // nothing spent before approval
  });

  it('approved spend launches on TikTok paused, waits for review, then enables', async () => {
    await approvePending('ad_campaign');
    await idle();
    expect(await failedRuns()).toEqual([]);
    const campaigns = await db.select().from(schema.adCampaigns);
    expect(campaigns.every((c) => c.status === 'active' && c.tiktokCampaignId)).toBe(true);
    const tt = mockTikTok();
    for (const c of campaigns) expect(tt.campaigns.get(c.tiktokCampaignId!)?.status).toBe('ENABLE');
    const created = tt.calls.filter((c) => c.method === 'createAdGroup').map((c) => c.args as { targeting: Record<string, unknown> });
    for (const g of created) {
      expect(g.targeting).toMatchObject({ location_ids: ['953987'] });
      expect(JSON.stringify(g.targeting)).not.toMatch(/religio/i);
    }
    const ads = await db.select().from(schema.ads);
    expect(ads.every((a) => a.status === 'active')).toBe(true);
  });

  it('daily optimisation syncs metrics', async () => {
    await startWorkflow('optimise', { companyId: ids.company, subjectType: 'company', subjectId: ids.company });
    await idle();
    expect(await failedRuns()).toEqual([]);
    expect((await db.select().from(schema.adMetricsDaily)).length).toBeGreaterThan(0);
    expect((await db.select().from(schema.postMetricsDaily)).length).toBeGreaterThan(0);
  });

  it('designs logos and makes the chosen one the brand logo', async () => {
    const [req] = await db.insert(schema.logoRequests).values({ companyId: ids.company, prompt: 'Premium wordmark', conceptCount: 3 }).returning();
    await startWorkflow('logo-design', { companyId: ids.company, subjectType: 'logo_request', subjectId: req.id });
    await idle();
    expect(await failedRuns()).toEqual([]);
    const concepts = await db.select().from(schema.creatives).where(eq(schema.creatives.logoRequestId, req.id));
    expect(concepts).toHaveLength(3);
    await selectLogo(db, req.id, concepts[1].id);
    const brands = await db.select().from(schema.brandProfiles).where(and(eq(schema.brandProfiles.companyId, ids.company), eq(schema.brandProfiles.isCurrent, true)));
    expect(brands).toHaveLength(1);
    expect(brands[0].logoAssetId).toBeTruthy();
  });

  it('writes the monthly report as a PDF and emails it', async () => {
    await startWorkflow('monthly-report', { companyId: ids.company, subjectType: 'company', subjectId: ids.company, input: { month } });
    await idle();
    expect(await failedRuns()).toEqual([]);
    const [report] = await db.select().from(schema.monthlyReports);
    expect(report.status).toBe('succeeded');
    expect((report.creativeBreakdown as unknown[]).length).toBeGreaterThan(0);
    expect((report.logoBreakdown as unknown[]).length).toBe(3);
    const [pdf] = await db.select().from(schema.assets).where(eq(schema.assets.id, report.pdfAssetId!));
    expect(pdf.mimeType).toBe('application/pdf');
    expect((await p.storage.get(pdf.s3Key)).subarray(0, 4).toString()).toBe('%PDF');
    expect(p.sentMail.at(-1)?.to).toEqual(['owner@agency.test']);
  });

  it('idempotency keys stop duplicate runs', async () => {
    const a = await startWorkflow('optimise', { companyId: ids.company, idempotencyKey: 'opt-today' });
    const b = await startWorkflow('optimise', { companyId: ids.company, idempotencyKey: 'opt-today' });
    expect(b.id).toBe(a.id);
    await idle();
  });

  it('records cost and a log on every run', async () => {
    const runs = await db.select().from(schema.agentRuns);
    expect(runs.every((r) => r.status === 'succeeded')).toBe(true);
    expect(runs.every((r) => Array.isArray((r.output as { log?: unknown[] }).log))).toBe(true);
  });
});
