import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { env } from '@/env';
import { startWorkflow } from '@/lib/engine/runs';
import { applyApprovedOptimisation } from '@/lib/workflows/optimise';

export async function onPlanDecision(db: Db, planId: string, userId: string | null, decision: string, comment?: string) {
  const [plan] = await db.select().from(schema.marketingPlans).where(eq(schema.marketingPlans.id, planId));
  if (decision === 'approved') {
    await db
      .update(schema.marketingPlans)
      .set({ status: 'approved', approvedBy: userId, approvedAt: new Date() })
      .where(eq(schema.marketingPlans.id, planId));
    await scheduleProduction(db, plan.companyId);
    return;
  }
  await db.update(schema.marketingPlans).set({ status: 'changes_requested', feedback: comment }).where(eq(schema.marketingPlans.id, planId));
  if (decision === 'changes_requested') {
    await startWorkflow('monthly-plan', {
      companyId: plan.companyId,
      subjectType: 'monthly_goal',
      subjectId: plan.monthlyGoalId,
      input: { goalId: plan.monthlyGoalId, feedback: comment ?? 'Please revise.' },
      startAt: 'plan',
    });
  }
}

export async function onCreativeDecision(db: Db, creativeId: string, decision: string, comment?: string) {
  const [creative] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, creativeId));
  if (decision === 'approved') {
    await db.update(schema.creatives).set({ status: 'approved' }).where(eq(schema.creatives.id, creativeId));
    if (creative.format !== 'logo') await distributeCreative(db, creativeId);
    return;
  }
  if (decision === 'rejected') {
    await db.update(schema.creatives).set({ status: 'rejected', feedback: comment }).where(eq(schema.creatives.id, creativeId));
    return;
  }
  await regenerateCreative(db, creativeId, comment ?? 'Please try a different approach.');
}

export async function onCampaignDecision(db: Db, campaignId: string, decision: string, comment?: string) {
  if (comment?.startsWith('OPTIMISE:')) {
    if (decision === 'approved') await applyApprovedOptimisation(db, campaignId, comment);
    return;
  }
  if (decision === 'approved') {
    const [campaign] = await db.select().from(schema.adCampaigns).where(eq(schema.adCampaigns.id, campaignId));
    await startWorkflow('ads-launch', {
      companyId: campaign.companyId,
      subjectType: 'ad_campaign',
      subjectId: campaignId,
      idempotencyKey: `ads-launch:${campaignId}`,
    });
    return;
  }
  await db.update(schema.adCampaigns).set({ status: 'draft' }).where(eq(schema.adCampaigns.id, campaignId));
}

/** New version of a creative with the user's feedback, linked to the old one. */
export async function regenerateCreative(db: Db, creativeId: string, feedback: string) {
  const [old] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, creativeId));
  await db.update(schema.creatives).set({ status: 'changes_requested', feedback }).where(eq(schema.creatives.id, creativeId));
  const [next] = await db
    .insert(schema.creatives)
    .values({
      companyId: old.companyId,
      planItemId: old.planItemId,
      contentRequestId: old.contentRequestId,
      logoRequestId: old.logoRequestId,
      parentCreativeId: old.id,
      format: old.format,
      concept: old.concept,
      feedback,
    })
    .returning();
  await startWorkflow('creative-production', { companyId: old.companyId, subjectType: 'creative', subjectId: next.id });
  return next;
}

/** Approved creative -> paid placement proposal or scheduled organic post. */
export async function distributeCreative(db: Db, creativeId: string) {
  const [creative] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, creativeId));
  const [item] = creative.planItemId
    ? await db.select().from(schema.planItems).where(eq(schema.planItems.id, creative.planItemId))
    : [undefined];
  const [request] = creative.contentRequestId
    ? await db.select().from(schema.contentRequests).where(eq(schema.contentRequests.id, creative.contentRequestId))
    : [undefined];
  const isPaid = item?.isPaid ?? request?.isPaid ?? false;
  if (isPaid) {
    await startWorkflow('ads-propose', {
      companyId: creative.companyId,
      subjectType: 'creative',
      subjectId: creative.id,
      idempotencyKey: `ads-propose:${creative.id}`,
    });
    return;
  }
  const scheduledFor = item && item.scheduledFor > new Date() ? item.scheduledFor : new Date();
  const [post] = await db
    .insert(schema.organicPosts)
    .values({ companyId: creative.companyId, creativeId: creative.id, scheduledFor })
    .returning();
  await db.update(schema.creatives).set({ status: 'scheduled' }).where(eq(schema.creatives.id, creative.id));
  await startWorkflow('organic-publish', {
    companyId: creative.companyId,
    subjectType: 'organic_post',
    subjectId: post.id,
    idempotencyKey: `organic-publish:${post.id}`,
  });
}

/**
 * Start production for approved plan items due within PRODUCTION_LEAD_DAYS that have no creative yet.
 * Runs when a plan is approved and hourly from n8n.
 */
export async function scheduleProduction(db: Db, companyId?: string) {
  const horizon = new Date(Date.now() + env().PRODUCTION_LEAD_DAYS * 86_400_000);
  const due = await db
    .select({ item: schema.planItems, plan: schema.marketingPlans })
    .from(schema.planItems)
    .innerJoin(schema.marketingPlans, eq(schema.marketingPlans.id, schema.planItems.marketingPlanId))
    .leftJoin(schema.creatives, eq(schema.creatives.planItemId, schema.planItems.id))
    .where(
      and(
        inArray(schema.marketingPlans.status, ['approved', 'active']),
        lte(schema.planItems.scheduledFor, horizon),
        isNull(schema.creatives.id),
        companyId ? eq(schema.marketingPlans.companyId, companyId) : sql`true`,
      ),
    );
  const started: string[] = [];
  for (const { item, plan } of due) {
    const [creative] = await db
      .insert(schema.creatives)
      .values({ companyId: plan.companyId, planItemId: item.id, contentRequestId: item.contentRequestId, format: item.format })
      .returning();
    await startWorkflow('creative-production', {
      companyId: plan.companyId,
      subjectType: 'creative',
      subjectId: creative.id,
      idempotencyKey: `produce:${item.id}`,
    });
    if (item.contentRequestId) {
      await db.update(schema.contentRequests).set({ status: 'in_production' }).where(eq(schema.contentRequests.id, item.contentRequestId));
    }
    started.push(creative.id);
  }
  // Plans whose month has started become active.
  await db
    .update(schema.marketingPlans)
    .set({ status: 'active' })
    .where(
      and(
        eq(schema.marketingPlans.status, 'approved'),
        sql`exists (select 1 from monthly_goals g where g.id = ${schema.marketingPlans.monthlyGoalId} and g.month <= current_date)`,
      ),
    );
  return started;
}
