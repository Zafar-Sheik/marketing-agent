import { and, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@/db';
import { env } from '@/env';
import { OPTIMISER } from '@/lib/agents/prompts';
import { applyGuardrails, type OptimisationAction } from '@/lib/domain/guardrails';
import { daysRemainingInMonth, monthStart, toIsoDate } from '@/lib/domain/dates';
import { formatMoney } from '@/lib/domain/money';
import { adsFor, postingFor, NotConnectedError } from '@/lib/tiktok';
import { requestApproval } from '@/lib/services/approvals';
import type { WorkflowDef } from '@/lib/engine/types';

const decisionSchema = z.object({
  actions: z.array(
    z.object({
      type: z.enum(['set_daily_budget', 'pause_ad', 'enable_ad', 'request_variant']),
      adNumber: z.number().int().describe('1-based number of the ad in the table'),
      newDailyBudget: z.number().describe('In currency units, only for set_daily_budget; else 0'),
      variantBrief: z.string().describe('Only for request_variant; else empty'),
      reason: z.string(),
    }),
  ),
  summary: z.string(),
});

/** Daily: pull TikTok metrics, then let the optimiser move budget within guardrails. */
export const optimise: WorkflowDef = {
  first: 'sync',
  steps: {
    async sync({ db, run, log }) {
      const companyId = run.companyId!;
      const today = toIsoDate(new Date());
      const start = monthStart(today);
      const adRows = await db
        .select({ ad: schema.ads })
        .from(schema.ads)
        .innerJoin(schema.adGroups, eq(schema.adGroups.id, schema.ads.adGroupId))
        .innerJoin(schema.adCampaigns, eq(schema.adCampaigns.id, schema.adGroups.adCampaignId))
        .where(and(eq(schema.adCampaigns.companyId, companyId), isNotNull(schema.ads.tiktokAdId)));
      if (adRows.length) {
        const byTikTokId = new Map(adRows.map((r) => [r.ad.tiktokAdId!, r.ad.id]));
        const metrics = await (await adsFor(companyId)).report(start, today);
        for (const m of metrics) {
          const adId = byTikTokId.get(m.adId);
          if (!adId) continue;
          const values = {
            spendCents: m.spendCents,
            impressions: m.impressions,
            reach: m.reach,
            clicks: m.clicks,
            videoViews: m.videoViews,
            avgWatchMs: m.avgWatchMs,
            conversions: m.conversions,
          };
          await db
            .insert(schema.adMetricsDaily)
            .values({ adId, date: m.date, ...values })
            .onConflictDoUpdate({ target: [schema.adMetricsDaily.adId, schema.adMetricsDaily.date], set: values });
        }
        log(`synced ${metrics.length} ad-day rows`);
      }

      const posts = await db
        .select()
        .from(schema.organicPosts)
        .where(and(eq(schema.organicPosts.companyId, companyId), eq(schema.organicPosts.status, 'published'), isNotNull(schema.organicPosts.tiktokPostId)));
      if (posts.length) {
        try {
          const stats = await (await postingFor(companyId)).stats(posts.map((p) => p.tiktokPostId!));
          for (const s of stats) {
            const post = posts.find((p) => p.tiktokPostId === s.postId);
            if (!post) continue;
            // The Display API returns lifetime totals; we store today's snapshot of them.
            const values = { views: s.views, likes: s.likes, comments: s.comments, shares: s.shares };
            await db
              .insert(schema.postMetricsDaily)
              .values({ organicPostId: post.id, date: today, ...values })
              .onConflictDoUpdate({ target: [schema.postMetricsDaily.organicPostId, schema.postMetricsDaily.date], set: values });
          }
        } catch (e) {
          if (!(e instanceof NotConnectedError)) throw e;
        }
      }
      return adRows.length ? { next: 'decide' } : { done: true, output: { ads: 0 } };
    },

    async decide({ db, providers: p, run, addCost }) {
      const companyId = run.companyId!;
      const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, companyId));
      const [ws] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.id, company.workspaceId));
      const today = toIsoDate(new Date());
      const start = monthStart(today);
      const [goal] = await db
        .select()
        .from(schema.monthlyGoals)
        .where(and(eq(schema.monthlyGoals.companyId, companyId), eq(schema.monthlyGoals.month, start)));
      if (!goal) return { done: true, output: { skipped: 'no goal this month' } };

      const rows = await db
        .select({
          adId: schema.ads.id,
          adGroupId: schema.adGroups.id,
          creativeId: schema.ads.creativeId,
          status: schema.ads.status,
          hook: schema.creatives.hook,
          dailyBudget: schema.adGroups.dailyBudgetCents,
          spend: sql<number>`coalesce(sum(${schema.adMetricsDaily.spendCents}), 0)::bigint`,
          impressions: sql<number>`coalesce(sum(${schema.adMetricsDaily.impressions}), 0)::bigint`,
          clicks: sql<number>`coalesce(sum(${schema.adMetricsDaily.clicks}), 0)::bigint`,
          conversions: sql<number>`coalesce(sum(${schema.adMetricsDaily.conversions}), 0)::bigint`,
        })
        .from(schema.ads)
        .innerJoin(schema.adGroups, eq(schema.adGroups.id, schema.ads.adGroupId))
        .innerJoin(schema.adCampaigns, eq(schema.adCampaigns.id, schema.adGroups.adCampaignId))
        .innerJoin(schema.creatives, eq(schema.creatives.id, schema.ads.creativeId))
        .leftJoin(schema.adMetricsDaily, and(eq(schema.adMetricsDaily.adId, schema.ads.id), gte(schema.adMetricsDaily.date, start)))
        .where(and(eq(schema.adCampaigns.companyId, companyId), inArray(schema.ads.status, ['active', 'paused'])))
        .groupBy(schema.ads.id, schema.adGroups.id, schema.creatives.hook);
      if (!rows.length) return { done: true, output: { ads: 0 } };

      const spent = rows.reduce((s, r) => s + Number(r.spend), 0);
      const remaining = Math.max(0, goal.adBudgetCents - spent);
      const daysLeft = daysRemainingInMonth(today);
      const res = await p.llm.structured({
        system: OPTIMISER,
        prompt: `Company: ${company.name} (${company.currency})
Month budget ${formatMoney(goal.adBudgetCents, company.currency)}, spent ${formatMoney(spent, company.currency)}, ${daysLeft} days left.
KPIs: ${goal.kpis.map((k) => `${k.metric} ${k.target}`).join('; ') || 'not set'}

| # | hook | status | daily budget | spend | impressions | clicks | CTR | conversions |
${rows
  .map((r, i) => `| ${i + 1} | ${r.hook} | ${r.status} | ${formatMoney(r.dailyBudget, company.currency)} | ${formatMoney(Number(r.spend), company.currency)} | ${r.impressions} | ${r.clicks} | ${((Number(r.clicks) / Math.max(1, Number(r.impressions))) * 100).toFixed(2)}% | ${r.conversions} |`)
  .join('\n')}`,
        schema: decisionSchema,
        tier: 'smart',
        effort: 'medium',
        mock: () => ({ actions: [], summary: 'Not enough data yet to change anything.' }),
      });
      addCost(res.costCents);

      const actions: OptimisationAction[] = res.data.actions.flatMap((a): OptimisationAction[] => {
        const row = rows[a.adNumber - 1];
        if (!row) return [];
        if (a.type === 'set_daily_budget') return [{ type: a.type, adGroupId: row.adGroupId, dailyBudgetCents: Math.round(a.newDailyBudget * 100), reason: a.reason }];
        if (a.type === 'request_variant') return [{ type: a.type, creativeId: row.creativeId, brief: a.variantBrief, reason: a.reason }];
        return [{ type: a.type, adId: row.adId, reason: a.reason }];
      });
      const verdict = applyGuardrails(actions, {
        currentDailyBudgets: Object.fromEntries(rows.map((r) => [r.adGroupId, r.dailyBudget])),
        maxChangePct: env().MAX_DAILY_BUDGET_CHANGE_PCT,
        remainingMonthCents: remaining,
        daysLeft,
        autopilot: ws.autopilot,
      });
      await applyActions(db, companyId, verdict.autoApply);
      if (verdict.needsApproval.length) {
        const [campaign] = await db
          .select({ id: schema.adCampaigns.id })
          .from(schema.adCampaigns)
          .innerJoin(schema.adGroups, eq(schema.adGroups.adCampaignId, schema.adCampaigns.id))
          .where(eq(schema.adGroups.id, rows[0].adGroupId));
        await requestApproval(db, {
          companyId,
          subjectType: 'ad_campaign',
          subjectId: campaign.id,
          comment: `OPTIMISE:${JSON.stringify(verdict.needsApproval)}`,
        });
      }
      return {
        done: true,
        output: { summary: res.data.summary, applied: verdict.autoApply, proposed: verdict.needsApproval, rejected: verdict.rejected },
      };
    },
  },
};

async function applyActions(db: Db, companyId: string, actions: OptimisationAction[]) {
  if (!actions.length) return;
  const ads = await adsFor(companyId);
  for (const a of actions) {
    if (a.type === 'set_daily_budget') {
      const [group] = await db.select().from(schema.adGroups).where(eq(schema.adGroups.id, a.adGroupId));
      await ads.setAdGroupBudget(group.tiktokAdgroupId!, a.dailyBudgetCents);
      await db.update(schema.adGroups).set({ dailyBudgetCents: a.dailyBudgetCents }).where(eq(schema.adGroups.id, a.adGroupId));
    } else if (a.type === 'pause_ad' || a.type === 'enable_ad') {
      const [ad] = await db.select().from(schema.ads).where(eq(schema.ads.id, a.adId));
      await ads.setAdStatus([ad.tiktokAdId!], a.type === 'pause_ad' ? 'DISABLE' : 'ENABLE');
      await db.update(schema.ads).set({ status: a.type === 'pause_ad' ? 'paused' : 'active' }).where(eq(schema.ads.id, a.adId));
    } else {
      const { regenerateCreative } = await import('@/lib/services/transitions');
      const [old] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, a.creativeId));
      await regenerateCreative(db, a.creativeId, `New variant requested by the optimiser: ${a.brief}`);
      // The original stays live; only the new one goes through production.
      await db.update(schema.creatives).set({ status: old.status }).where(eq(schema.creatives.id, old.id));
    }
  }
}

/** A human approved optimiser proposals that exceeded the guardrails. */
export async function applyApprovedOptimisation(db: Db, campaignId: string, comment: string) {
  const [campaign] = await db.select().from(schema.adCampaigns).where(eq(schema.adCampaigns.id, campaignId));
  const proposals = JSON.parse(comment.slice('OPTIMISE:'.length)) as { action: OptimisationAction }[];
  await applyActions(db, campaign.companyId, proposals.map((p) => p.action));
}
