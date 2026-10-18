import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';

/** Pending approvals with enough context to decide without clicking through. */
export async function pendingApprovals(db: Db, workspaceId: string, companyId?: string) {
  const rows = await db
    .select({ approval: schema.approvals, company: schema.companies })
    .from(schema.approvals)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.approvals.companyId))
    .where(
      and(
        eq(schema.companies.workspaceId, workspaceId),
        eq(schema.approvals.decision, 'pending'),
        companyId ? eq(schema.companies.id, companyId) : undefined,
      ),
    )
    .orderBy(desc(schema.approvals.requestedAt));
  const ids = (t: string) => rows.filter((r) => r.approval.subjectType === t).map((r) => r.approval.subjectId);
  const none = ['00000000-0000-0000-0000-000000000000'];
  const plans = await db.select().from(schema.marketingPlans).where(inArray(schema.marketingPlans.id, ids('marketing_plan').concat(none)));
  const goals = await db.select().from(schema.monthlyGoals).where(inArray(schema.monthlyGoals.id, plans.map((p) => p.monthlyGoalId).concat(none)));
  const creatives = await db.select().from(schema.creatives).where(inArray(schema.creatives.id, ids('creative').concat(none)));
  const campaigns = await db.select().from(schema.adCampaigns).where(inArray(schema.adCampaigns.id, ids('ad_campaign').concat(none)));
  const groups = await db.select().from(schema.adGroups).where(inArray(schema.adGroups.adCampaignId, campaigns.map((c) => c.id).concat(none)));
  const segments = await db.select().from(schema.audienceSegments).where(inArray(schema.audienceSegments.id, groups.map((g) => g.audienceSegmentId!).filter(Boolean).concat(none)));
  const adRows = await db.select().from(schema.ads).where(inArray(schema.ads.adGroupId, groups.map((g) => g.id).concat(none)));
  const thumbs = await previewAssets(db, creatives.map((c) => c.id).concat(adRows.map((a) => a.creativeId)));
  return rows.map((r) => {
    const plan = plans.find((p) => p.id === r.approval.subjectId);
    const campaign = campaigns.find((c) => c.id === r.approval.subjectId);
    const group = groups.find((g) => g.adCampaignId === campaign?.id);
    const ad = adRows.find((a) => a.adGroupId === group?.id);
    return {
      ...r,
      plan,
      goal: goals.find((g) => g.id === plan?.monthlyGoalId),
      creative: creatives.find((c) => c.id === r.approval.subjectId),
      campaign,
      group,
      segment: segments.find((s) => s.id === group?.audienceSegmentId),
      ad,
      thumb: thumbs.get(r.approval.subjectId) ?? (ad ? thumbs.get(ad.creativeId) : undefined),
    };
  });
}

/** Best still image per creative (final slide, else last key frame, else logo). */
export async function previewAssets(db: Db, creativeIds: string[]) {
  const map = new Map<string, string>();
  if (!creativeIds.length) return map;
  const files = await db
    .select({ creativeId: schema.creativeAssets.creativeId, role: schema.creativeAssets.role, assetId: schema.assets.id, mime: schema.assets.mimeType })
    .from(schema.creativeAssets)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.creativeAssets.assetId))
    .where(inArray(schema.creativeAssets.creativeId, creativeIds))
    .orderBy(schema.creativeAssets.createdAt);
  const rank = (role: string) => ({ slide: 0, logo_png: 0, frame: 1 })[role] ?? 9;
  const best = new Map<string, number>();
  // Files come oldest first, so the latest version wins within a rank.
  for (const f of files) {
    const r = rank(f.role);
    if (!f.mime.startsWith('image/') || r === 9) continue;
    if (r <= (best.get(f.creativeId) ?? 9)) {
      best.set(f.creativeId, r);
      map.set(f.creativeId, f.assetId);
    }
  }
  return map;
}
