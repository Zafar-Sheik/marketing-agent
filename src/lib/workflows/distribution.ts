import { and, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import { schema, type Db } from '@/db';
import { brandBrief, brandContext } from '@/lib/agents/context';
import { MEDIA_BUYER } from '@/lib/agents/prompts';
import { assertWithinMonthCap, calculatePlacementBudget } from '@/lib/domain/budget';
import { monthEnd, monthStart, parseIsoDate, toIsoDate } from '@/lib/domain/dates';
import { formatMoney } from '@/lib/domain/money';
import { ageGroupsForRange, toTikTokTargeting, AGE_GROUPS, GENDERS, type AudienceSegment } from '@/lib/domain/targeting';
import { creativeFiles } from '@/lib/assets';
import { adsFor, postingFor, objectiveFor } from '@/lib/tiktok';
import { requestApproval } from '@/lib/services/approvals';
import type { WorkflowDef } from '@/lib/engine/types';

export const CTAS = ['LEARN_MORE', 'SHOP_NOW', 'ORDER_NOW', 'BOOK_NOW', 'SIGN_UP', 'CONTACT_US', 'VISIT_STORE', 'DOWNLOAD_NOW'] as const;
const DEFAULT_FLIGHT_DAYS = 7;

const buySchema = z.object({
  segmentNumber: z.number().int().describe('1-based number of the chosen research segment'),
  ageMin: z.number().int(),
  ageMax: z.number().int(),
  genders: z.array(z.enum(GENDERS)),
  interests: z.array(z.string()).describe('Plain-language interest categories'),
  adText: z.string().describe('Ad text shown with the video, max 100 characters, no hashtags'),
  callToAction: z.enum(CTAS),
  rationale: z.string(),
});

/** Spend already committed this month: every campaign that is approved, live or waiting for approval. */
async function committedCents(db: Db, companyId: string, planId: string | null, excludeCampaignId?: string) {
  const rows = await db
    .select({ budget: schema.adCampaigns.budgetCents, id: schema.adCampaigns.id })
    .from(schema.adCampaigns)
    .where(
      and(
        eq(schema.adCampaigns.companyId, companyId),
        planId ? eq(schema.adCampaigns.marketingPlanId, planId) : undefined,
        notInArray(schema.adCampaigns.status, ['draft', 'rejected', 'failed']),
      ),
    );
  return rows.filter((r) => r.id !== excludeCampaignId).reduce((s, r) => s + r.budget, 0);
}

async function planContext(db: Db, creative: typeof schema.creatives.$inferSelect) {
  const [item] = creative.planItemId ? await db.select().from(schema.planItems).where(eq(schema.planItems.id, creative.planItemId)) : [];
  const [request] = creative.contentRequestId
    ? await db.select().from(schema.contentRequests).where(eq(schema.contentRequests.id, creative.contentRequestId))
    : [];
  const planId = item?.marketingPlanId ?? request?.marketingPlanId ?? null;
  const [plan] = planId ? await db.select().from(schema.marketingPlans).where(eq(schema.marketingPlans.id, planId)) : [];
  const [goal] = plan
    ? await db.select().from(schema.monthlyGoals).where(eq(schema.monthlyGoals.id, plan.monthlyGoalId))
    : await db
        .select()
        .from(schema.monthlyGoals)
        .where(and(eq(schema.monthlyGoals.companyId, creative.companyId), eq(schema.monthlyGoals.month, monthStart(new Date()))));
  return { item, request, plan, goal };
}

/** Approved paid creative -> budget + audience + copy, saved as a campaign awaiting approval. */
export const adsPropose: WorkflowDef = {
  first: 'propose',
  steps: {
    async propose({ db, providers: p, run, addCost, log }) {
      const [creative] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, run.subjectId!));
      const { item, plan, goal } = await planContext(db, creative);
      if (!goal) throw new Error('No monthly goal (and budget) set for this month. Set goals before running paid placements.');
      const ctx = await brandContext(db, p, creative.companyId, creative.concept ?? '');
      const { company } = ctx;

      const start = item && item.scheduledFor > new Date() ? item.scheduledFor : new Date(Date.now() + 3600_000);
      const lastDay = monthEnd(goal.month);
      const flightDays = Math.max(1, Math.min(DEFAULT_FLIGHT_DAYS, Math.round((parseIsoDate(lastDay).getTime() - parseIsoDate(toIsoDate(start)).getTime()) / 86_400_000) + 1));
      const planned = item?.plannedSpendCents || Math.floor(goal.adBudgetCents / 4);
      const budget = calculatePlacementBudget({
        monthBudgetCents: goal.adBudgetCents,
        committedCents: await committedCents(db, company.id, plan?.id ?? null),
        plannedSpendCents: planned,
        flightDays,
      });
      if (!budget.ok) throw new Error(budget.reason);

      const segments = await db
        .select()
        .from(schema.audienceSegments)
        .where(eq(schema.audienceSegments.companyId, company.id))
        .orderBy(desc(schema.audienceSegments.createdAt))
        .limit(6);
      if (!segments.length) throw new Error('No audience segments yet. Run monthly research first.');

      const res = await p.llm.structured({
        system: MEDIA_BUYER,
        prompt: `${brandBrief(ctx)}

<creative>
Concept: ${creative.concept}
Hook: ${creative.hook}
Caption: ${creative.caption}
Objective: ${item?.objective ?? 'traffic'}
</creative>

<budget>${formatMoney(budget.budgetCents, company.currency)} over ${budget.flightDays} days (${formatMoney(budget.dailyBudgetCents, company.currency)}/day)</budget>

<segments>
${segments.map((s, i) => `${i + 1}. ${s.name}: ages ${s.ageGroups.join(',')}, ${s.genders.join(',')}, interests ${s.interestLabels.join(', ')}. ${s.rationale}`).join('\n')}
</segments>

Landing page: ${company.websiteUrl ?? 'none'}
Choose the audience and write the ad text.`,
        schema: buySchema,
        tier: 'smart',
        effort: 'medium',
        mock: () => ({
          segmentNumber: 1,
          ageMin: 18,
          ageMax: 34,
          genders: ['GENDER_UNLIMITED' as const],
          interests: segments[0].interestLabels,
          adText: (creative.caption ?? creative.hook ?? 'Discover more').slice(0, 100),
          callToAction: 'LEARN_MORE' as const,
          rationale: 'Best-performing segment in research; broad enough for TikTok to optimise.',
        }),
      });
      addCost(res.costCents);
      const buy = res.data;
      const seg = segments[Math.min(Math.max(buy.segmentNumber, 1), segments.length) - 1];
      const segment: AudienceSegment = {
        name: seg.name,
        ageGroups: ageGroupsForRange(buy.ageMin, buy.ageMax).filter((g) => (AGE_GROUPS as readonly string[]).includes(g)),
        genders: buy.genders.length ? buy.genders : ['GENDER_UNLIMITED'],
        locationIds: seg.locationIds,
        languages: seg.languages,
        interestCategoryIds: [],
        actionCategoryIds: [],
        hashtagIds: [],
        interestLabels: buy.interests,
        rationale: buy.rationale,
      };
      const targeting = toTikTokTargeting(segment); // throws on sensitive targeting

      const objective = objectiveFor(item?.objective ?? 'traffic');
      const startsAt = start;
      const endsAt = new Date(startsAt.getTime() + budget.flightDays * 86_400_000);
      const [campaign] = await db
        .insert(schema.adCampaigns)
        .values({
          companyId: company.id,
          marketingPlanId: plan?.id,
          name: `${company.name} · ${creative.hook?.slice(0, 40) ?? 'Ad'} · ${toIsoDate(startsAt)}`,
          objective,
          budgetCents: budget.budgetCents,
          status: 'pending_approval',
          startsAt,
          endsAt,
        })
        .returning();
      const [audience] = await db
        .insert(schema.audienceSegments)
        .values({
          companyId: company.id,
          researchReportId: seg.researchReportId,
          name: `${seg.name} (for ${creative.hook?.slice(0, 30) ?? 'ad'})`,
          ageGroups: segment.ageGroups,
          genders: segment.genders,
          locationIds: segment.locationIds,
          languages: segment.languages,
          interestLabels: segment.interestLabels,
          rationale: buy.rationale,
        })
        .returning();
      const [group] = await db
        .insert(schema.adGroups)
        .values({
          adCampaignId: campaign.id,
          audienceSegmentId: audience.id,
          name: seg.name,
          optimizationGoal: objective,
          dailyBudgetCents: budget.dailyBudgetCents,
          targetingSnapshot: targeting,
          status: 'pending_approval',
        })
        .returning();
      await db.insert(schema.ads).values({
        adGroupId: group.id,
        creativeId: creative.id,
        adText: buy.adText.replace(/#\S+/g, '').trim().slice(0, 100),
        callToAction: buy.callToAction,
        landingUrl: company.websiteUrl,
      });
      if (budget.cappedByRemaining) log(`budget capped to what is left this month: ${budget.budgetCents}`);
      await requestApproval(db, { companyId: company.id, subjectType: 'ad_campaign', subjectId: campaign.id });
      return { done: true, output: { campaignId: campaign.id, budgetCents: budget.budgetCents } };
    },
  },
};

/** Approved campaign -> TikTok Ads Manager (created paused) -> review -> enable. */
export const adsLaunch: WorkflowDef = {
  first: 'create',
  steps: {
    async create({ db, providers: p, run, state }) {
      const [campaign] = await db.select().from(schema.adCampaigns).where(eq(schema.adCampaigns.id, run.subjectId!));
      if (campaign.tiktokCampaignId) return { next: 'review' }; // already created (retry)
      const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, campaign.companyId));
      const groups = await db.select().from(schema.adGroups).where(eq(schema.adGroups.adCampaignId, campaign.id));
      const adRows = await db.select().from(schema.ads).where(inArray(schema.ads.adGroupId, groups.map((g) => g.id)));

      // Hard stop: re-check the month cap right before money can move.
      if (campaign.marketingPlanId) {
        const [plan] = await db.select().from(schema.marketingPlans).where(eq(schema.marketingPlans.id, campaign.marketingPlanId));
        const [goal] = await db.select().from(schema.monthlyGoals).where(eq(schema.monthlyGoals.id, plan.monthlyGoalId));
        const others = await committedCents(db, company.id, plan.id, campaign.id);
        assertWithinMonthCap(goal.adBudgetCents, [others, campaign.budgetCents]);
      }

      const ads = await adsFor(company.id);
      const categories = await ads.interestCategories();
      const tiktokCampaignId = await ads.createCampaign({ name: campaign.name, objective: objectiveFor(campaign.objective), budgetCents: campaign.budgetCents });
      await db.update(schema.adCampaigns).set({ tiktokCampaignId, status: 'submitted' }).where(eq(schema.adCampaigns.id, campaign.id));

      for (const group of groups) {
        const [segment] = group.audienceSegmentId
          ? await db.select().from(schema.audienceSegments).where(eq(schema.audienceSegments.id, group.audienceSegmentId))
          : [];
        const interestIds = resolveInterests(segment?.interestLabels ?? [], categories);
        const targeting = { ...group.targetingSnapshot, ...(interestIds.length ? { interest_category_ids: interestIds } : {}) };
        const adgroupId = await ads.createAdGroup({
          campaignId: tiktokCampaignId,
          name: group.name,
          objective: objectiveFor(campaign.objective),
          dailyBudgetCents: group.dailyBudgetCents,
          startsAt: campaign.startsAt ?? new Date(),
          endsAt: campaign.endsAt ?? new Date(Date.now() + 7 * 86_400_000),
          targeting,
        });
        await db
          .update(schema.adGroups)
          .set({ tiktokAdgroupId: adgroupId, targetingSnapshot: targeting, status: 'submitted' })
          .where(eq(schema.adGroups.id, group.id));
        if (segment && interestIds.length) {
          await db.update(schema.audienceSegments).set({ interestCategoryIds: interestIds }).where(eq(schema.audienceSegments.id, segment.id));
        }

        for (const ad of adRows.filter((a) => a.adGroupId === group.id)) {
          const files = await creativeFiles(db, ad.creativeId);
          const final = files.find((f) => f.role === 'final');
          const thumb = files.findLast((f) => f.role === 'frame');
          if (!final || !thumb) throw new Error('The creative has no rendered video to advertise.');
          const videoId = await ads.uploadVideo(await p.storage.presignGet(final.asset.s3Key, 3600), `${ad.id}.mp4`);
          const imageId = await ads.uploadImage(await p.storage.presignGet(thumb.asset.s3Key, 3600), `${ad.id}.png`);
          const identityId = await ads.createIdentity(company.name.slice(0, 40), imageId);
          const tiktokAdId = await ads.createAd({
            adGroupId: adgroupId,
            name: `${campaign.name} · ad`,
            identityId,
            videoId,
            thumbnailImageId: imageId,
            adText: ad.adText,
            callToAction: ad.callToAction ?? 'LEARN_MORE',
            landingUrl: ad.landingUrl ?? company.websiteUrl ?? '',
          });
          await db.update(schema.ads).set({ tiktokAdId, tiktokVideoId: videoId, status: 'in_review' }).where(eq(schema.ads.id, ad.id));
          await db.update(schema.creatives).set({ status: 'scheduled' }).where(eq(schema.creatives.id, ad.creativeId));
        }
      }
      await db.update(schema.adCampaigns).set({ status: 'in_review' }).where(eq(schema.adCampaigns.id, campaign.id));
      state.reviewPolls = 0;
      return { next: 'review', waitSeconds: 900 };
    },

    async review({ db, run, state, log }) {
      const [campaign] = await db.select().from(schema.adCampaigns).where(eq(schema.adCampaigns.id, run.subjectId!));
      const groups = await db.select().from(schema.adGroups).where(eq(schema.adGroups.adCampaignId, campaign.id));
      const adRows = await db.select().from(schema.ads).where(inArray(schema.ads.adGroupId, groups.map((g) => g.id)));
      const ads = await adsFor(campaign.companyId);
      const reviews = await ads.reviewStatus(adRows.map((a) => a.tiktokAdId!).filter(Boolean));

      const rejected = reviews.filter((r) => r.state === 'rejected');
      for (const r of rejected) {
        await db.update(schema.ads).set({ status: 'rejected', rejectionReason: r.reason }).where(eq(schema.ads.tiktokAdId, r.adId));
      }
      if (rejected.length === reviews.length && reviews.length) {
        await db.update(schema.adCampaigns).set({ status: 'rejected' }).where(eq(schema.adCampaigns.id, campaign.id));
        for (const ad of adRows) {
          await db.update(schema.creatives).set({ status: 'failed', feedback: `TikTok rejected the ad: ${rejected.map((r) => r.reason).join('; ')}` }).where(eq(schema.creatives.id, ad.creativeId));
        }
        return { done: true, output: { rejected: rejected.map((r) => r.reason) } };
      }
      if (reviews.some((r) => r.state === 'in_review')) {
        state.reviewPolls = ((state.reviewPolls as number) ?? 0) + 1;
        if ((state.reviewPolls as number) > 96) throw new Error('TikTok review has taken more than 24 hours.');
        return { next: 'review', waitSeconds: 900 };
      }

      await ads.setCampaignStatus([campaign.tiktokCampaignId!], 'ENABLE');
      const approved = reviews.filter((r) => r.state === 'approved').map((r) => r.adId);
      await db.update(schema.adCampaigns).set({ status: 'active' }).where(eq(schema.adCampaigns.id, campaign.id));
      await db.update(schema.adGroups).set({ status: 'active' }).where(eq(schema.adGroups.adCampaignId, campaign.id));
      await db.update(schema.ads).set({ status: 'active' }).where(inArray(schema.ads.tiktokAdId, approved));
      for (const ad of adRows.filter((a) => approved.includes(a.tiktokAdId!))) {
        await db.update(schema.creatives).set({ status: 'published' }).where(eq(schema.creatives.id, ad.creativeId));
      }
      log(`enabled campaign ${campaign.tiktokCampaignId} with ${approved.length} approved ads`);
      return { done: true, output: { live: approved.length } };
    },
  },
};

/** Match plain-language interests to TikTok's category ids. */
export function resolveInterests(labels: string[], categories: { id: string; name: string }[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const ids = labels.flatMap((label) => {
    const l = norm(label);
    const exact = categories.find((c) => norm(c.name) === l);
    if (exact) return [exact.id];
    const partial = categories.find((c) => norm(c.name).includes(l) || l.includes(norm(c.name)));
    return partial ? [partial.id] : [];
  });
  return [...new Set(ids)];
}

/** Scheduled organic post -> TikTok Content Posting API. */
export const organicPublish: WorkflowDef = {
  first: 'wait',
  steps: {
    async wait({ db, run }) {
      const [post] = await db.select().from(schema.organicPosts).where(eq(schema.organicPosts.id, run.subjectId!));
      const seconds = Math.ceil((post.scheduledFor.getTime() - Date.now()) / 1000);
      // Re-check after every wake-up: a runner may wake early (capped waits, restarts), and must never publish early.
      return seconds > 30 ? { next: 'wait', waitSeconds: seconds } : { next: 'publish' };
    },

    async publish({ db, providers: p, run, state, log }) {
      const [post] = await db.select().from(schema.organicPosts).where(eq(schema.organicPosts.id, run.subjectId!));
      const [creative] = await db.select().from(schema.creatives).where(eq(schema.creatives.id, post.creativeId));
      const files = await creativeFiles(db, creative.id);
      const posting = await postingFor(post.companyId);
      const info = await posting.creatorInfo();
      // Unaudited TikTok apps may only post privately; use what the account allows.
      const privacy = info.privacyLevels.includes(post.privacyLevel) ? post.privacyLevel : (info.privacyLevels.find((l) => l === 'SELF_ONLY') ?? info.privacyLevels[0]);
      if (privacy !== post.privacyLevel) log(`privacy ${post.privacyLevel} not allowed for this account, using ${privacy}`);
      const caption = [creative.caption, creative.hashtags.join(' ')].filter(Boolean).join(' ');

      let publishId: string;
      const final = files.find((f) => f.role === 'final');
      if (final) {
        publishId = await posting.publishVideo({ videoUrl: await p.storage.presignGet(final.asset.s3Key, 3600), caption, privacyLevel: privacy });
      } else {
        const slides = files.filter((f) => f.role === 'slide');
        if (!slides.length) throw new Error('Nothing to publish: the creative has no final video or slides.');
        publishId = await posting.publishPhotos({
          imageUrls: await Promise.all(slides.map((s) => p.storage.presignGet(s.asset.s3Key, 3600))),
          title: creative.hook ?? '',
          caption,
          privacyLevel: privacy,
        });
      }
      await db
        .update(schema.organicPosts)
        .set({ status: 'publishing', tiktokPublishId: publishId, privacyLevel: privacy })
        .where(eq(schema.organicPosts.id, post.id));
      state.nickname = info.nickname;
      state.attempts = ((state.attempts as number) ?? 0) + 1;
      state.polls = 0;
      return { next: 'status', waitSeconds: 15 };
    },

    async status({ db, run, state }) {
      const [post] = await db.select().from(schema.organicPosts).where(eq(schema.organicPosts.id, run.subjectId!));
      const posting = await postingFor(post.companyId);
      const s = await posting.status(post.tiktokPublishId!);
      if (s.state === 'processing') {
        state.polls = (state.polls as number) + 1;
        if ((state.polls as number) > 80) throw new Error('TikTok is still processing after 20 minutes.');
        return { next: 'status', waitSeconds: 15 };
      }
      if (s.state === 'failed') {
        if ((state.attempts as number) < 3) return { next: 'publish', waitSeconds: 60 };
        await db.update(schema.organicPosts).set({ status: 'failed', error: s.reason }).where(eq(schema.organicPosts.id, post.id));
        await db.update(schema.creatives).set({ status: 'failed', feedback: `TikTok publish failed: ${s.reason}` }).where(eq(schema.creatives.id, post.creativeId));
        return { done: true, output: { error: s.reason } };
      }
      await db
        .update(schema.organicPosts)
        .set({
          status: 'published',
          publishedAt: new Date(),
          tiktokPostId: s.postId,
          shareUrl: s.postId ? `https://www.tiktok.com/@${state.nickname}/video/${s.postId}` : null,
        })
        .where(eq(schema.organicPosts.id, post.id));
      await db.update(schema.creatives).set({ status: 'published' }).where(eq(schema.creatives.id, post.creativeId));
      return { done: true, output: { postId: s.postId } };
    },
  },
};

