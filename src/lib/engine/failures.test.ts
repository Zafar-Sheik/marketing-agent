import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { setup, seedCompany, idle } from '@/test/fixtures';
import { mockTikTok } from '@/lib/tiktok';
import { BRAND_QA } from '@/lib/agents/prompts';
import { startWorkflow, executeStep } from './runs';
import { requestApproval, decide } from '@/lib/services/approvals';
import type { mockProviders } from '@/lib/providers/mock';

let db: Db;
let p: ReturnType<typeof mockProviders>;
beforeEach(async () => {
  ({ db, p } = await setup());
});

async function producedCreative(companyId: string, planId: string, isPaid: boolean, plannedSpendCents = 0) {
  const [item] = await db
    .insert(schema.planItems)
    .values({ marketingPlanId: planId, scheduledFor: new Date(), format: 'short_video', objective: 'traffic', brief: 'Test', isPaid, plannedSpendCents })
    .returning();
  const [creative] = await db.insert(schema.creatives).values({ companyId, planItemId: item.id, format: 'short_video' }).returning();
  await startWorkflow('creative-production', { companyId, subjectType: 'creative', subjectId: creative.id });
  await idle(db);
  return creative;
}

describe('failure paths', () => {
  it('low brand score triggers regeneration with the reviewer’s issues', async () => {
    const { company, plan } = await seedCompany(db);
    let qaCalls = 0;
    const base = p.llm.structured.bind(p.llm);
    p.llm.structured = (async (req) => {
      if (req.system === BRAND_QA && qaCalls++ === 0) {
        return { data: { score: 0.4, issues: ['Logo missing'], strengths: [] }, costCents: 0, model: 'mock' };
      }
      return base(req);
    }) as typeof p.llm.structured;
    const creative = await producedCreative(company.id, plan.id, false);
    const [c] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, creative.id));
    expect(qaCalls).toBe(2);
    expect(c.status).toBe('in_review');
    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.subjectId, creative.id));
    expect((run.output as { state: { attempt: number } }).state.attempt).toBe(2);
  });

  it('a provider failure fails the run and marks the creative for retry', async () => {
    const { company, plan } = await seedCompany(db);
    p.video.get = async () => ({ status: 'failed', error: 'content moderation' });
    const creative = await producedCreative(company.id, plan.id, false);
    const [c] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, creative.id));
    expect(c.status).toBe('failed');
    expect(c.feedback).toMatch(/content moderation/);
    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.subjectId, creative.id));
    expect(run.status).toBe('failed');
  });

  it('TikTok rejection marks the campaign rejected and never enables it', async () => {
    const { company, plan, user } = await seedCompany(db);
    const creative = await producedCreative(company.id, plan.id, true, 50_000);
    const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.subjectId, creative.id));
    await decide(db, approval.id, user.id, 'approved');
    await idle(db);
    const [campaign] = await db.select().from(schema.adCampaigns);
    expect(campaign.status).toBe('pending_approval');
    mockTikTok().rejectNextAdWith = 'Exaggerated claims';
    const [spend] = await db.select().from(schema.approvals).where(eq(schema.approvals.subjectId, campaign.id));
    await decide(db, spend.id, user.id, 'approved');
    await idle(db);
    const [after] = await db.select().from(schema.adCampaigns);
    expect(after.status).toBe('rejected');
    expect(mockTikTok().campaigns.get(after.tiktokCampaignId!)?.status).toBe('DISABLE');
    const [ad] = await db.select().from(schema.ads);
    expect(ad.rejectionReason).toBe('Exaggerated claims');
  });

  it('launch refuses to exceed the monthly cap and calls TikTok zero times', async () => {
    const { company, plan, user } = await seedCompany(db, { budgetCents: 10_000 });
    const [over] = await db
      .insert(schema.adCampaigns)
      .values({ companyId: company.id, marketingPlanId: plan.id, name: 'too big', objective: 'traffic', budgetCents: 50_000, status: 'pending_approval' })
      .returning();
    const approval = await requestApproval(db, { companyId: company.id, subjectType: 'ad_campaign', subjectId: over.id });
    await decide(db, approval.id, user.id, 'approved');
    await idle(db);
    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.workflow, 'ads-launch'));
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/exceed the monthly cap/);
    expect(mockTikTok().calls.filter((c) => c.method === 'createCampaign')).toHaveLength(0);
  });

  it('paid placements without a goal fail with a clear message', async () => {
    const { company, plan, user, goal } = await seedCompany(db);
    await db.delete(schema.marketingPlans).where(eq(schema.marketingPlans.id, plan.id));
    await db.delete(schema.monthlyGoals).where(eq(schema.monthlyGoals.id, goal.id));
    const [creative] = await db.insert(schema.creatives).values({ companyId: company.id, format: 'short_video', status: 'approved' }).returning();
    await startWorkflow('ads-propose', { companyId: company.id, subjectType: 'creative', subjectId: creative.id });
    await idle(db);
    const [run] = await db.select().from(schema.agentRuns);
    expect(run.error).toMatch(/No monthly goal/);
    void user;
  });

  it('autopilot approves within guardrails without a human', async () => {
    const { company, plan } = await seedCompany(db, { autopilot: true });
    await producedCreative(company.id, plan.id, false);
    await idle(db);
    const posts = await db.select().from(schema.organicPosts);
    expect(posts[0]?.status).toBe('published');
    const approvals = await db.select().from(schema.approvals);
    expect(approvals.every((a) => a.decision === 'approved' && a.comment?.includes('autopilot'))).toBe(true);
  });

  it('a finished run ignores replayed steps (n8n redelivery)', async () => {
    const { company } = await seedCompany(db);
    const run = await startWorkflow('optimise', { companyId: company.id });
    await idle(db);
    expect(await executeStep(run.id, 'sync')).toEqual({ done: true });
  });

  it('an approval can only be decided once', async () => {
    const { company, plan, user } = await seedCompany(db);
    const a = await requestApproval(db, { companyId: company.id, subjectType: 'marketing_plan', subjectId: plan.id });
    await decide(db, a.id, user.id, 'approved');
    await expect(decide(db, a.id, user.id, 'rejected')).rejects.toThrow(/already decided/);
    await idle(db);
  });
});
