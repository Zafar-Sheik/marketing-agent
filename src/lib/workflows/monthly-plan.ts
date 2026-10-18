import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@/db';
import { brandBrief, brandContext } from '@/lib/agents/context';
import { MARKET_RESEARCHER, STRATEGIST } from '@/lib/agents/prompts';
import { addDays, daysInMonth, formatMonth, isInMonth, monthEnd, monthStart, parseIsoDate, toIsoDate } from '@/lib/domain/dates';
import { fitPlannedSpend } from '@/lib/domain/budget';
import { formatMoney } from '@/lib/domain/money';
import { ageGroupsForRange, assertNoSensitiveTargeting, SensitiveTargetingError } from '@/lib/domain/targeting';
import { locationIdsFor } from '@/lib/domain/geo';
import type { SearchResult } from '@/lib/providers/types';
import type { WorkflowDef } from '@/lib/engine/types';

const researchSchema = z.object({
  executiveSummary: z.string(),
  trends: z.array(
    z.object({ name: z.string(), format: z.string(), whyItWorks: z.string(), howToUse: z.string(), sourceUrl: z.string() }),
  ),
  competitors: z.array(z.object({ name: z.string(), whatTheyDo: z.string(), opportunity: z.string(), sourceUrl: z.string() })),
  audienceInsights: z.object({
    summary: z.string(),
    peakPostingTimes: z.array(z.string()).describe('Local times, e.g. "Tue 18:00"'),
    motivations: z.array(z.string()),
    objections: z.array(z.string()),
  }),
  segments: z.array(
    z.object({
      name: z.string(),
      ageMin: z.number().int(),
      ageMax: z.number().int(),
      genders: z.array(z.enum(['GENDER_MALE', 'GENDER_FEMALE', 'GENDER_UNLIMITED'])),
      countries: z.array(z.string()).describe('ISO 3166-1 alpha-2'),
      languages: z.array(z.string()).describe('ISO 639-1'),
      interests: z.array(z.string()).describe('Plain-language interest categories, e.g. "Food & Drink"'),
      rationale: z.string(),
    }),
  ),
});

const FORMATS = ['short_video', 'image_post', 'carousel'] as const;

const planSchema = z.object({
  strategy: z.string().describe('The month strategy in markdown: positioning, what we will test, how we measure'),
  contentPillars: z.array(z.object({ name: z.string(), description: z.string(), share: z.number().describe('0-1') })),
  budgetAllocation: z.record(z.string(), z.number()).describe('Share of paid budget per objective (awareness, traffic, video_views), summing to 1'),
  items: z.array(
    z.object({
      date: z.string().describe('YYYY-MM-DD within the month'),
      time: z.string().describe('HH:MM local time'),
      format: z.enum(FORMATS),
      pillar: z.string(),
      objective: z.enum(['awareness', 'traffic', 'video_views', 'engagement', 'conversions']),
      brief: z.string(),
      isPaid: z.boolean(),
      plannedSpend: z.number().describe('In the company currency (not cents); 0 for organic'),
      clientRequest: z.number().int().describe('Number of the client request this item fulfils (1-based), or 0'),
    }),
  ),
});

/** monthly_goals -> research_reports + audience_segments -> marketing_plans + plan_items (pending approval). */
export const monthlyPlan: WorkflowDef = {
  first: 'research',
  steps: {
    async research({ db, providers: p, run, input, addCost, log }) {
      const goalId = input.goalId as string;
      const [goal] = await db.select().from(schema.monthlyGoals).where(eq(schema.monthlyGoals.id, goalId));
      const ctx = await brandContext(db, p, goal.companyId, `${goal.prompt} audience competitors`);
      const { company, brand } = ctx;
      const where = goal.locations.length ? goal.locations.join(', ') : company.headquartersCountry ?? 'global';
      const month = formatMonth(goal.month);

      const [report] = await db
        .insert(schema.researchReports)
        .values({ companyId: company.id, monthlyGoalId: goal.id, status: 'running' })
        .returning();

      const queries = [
        `${company.industry ?? company.name} TikTok trends ${where} ${month}`,
        `TikTok Creative Center top ads ${company.industry ?? ''} ${where}`,
        `trending TikTok hashtags and sounds ${company.industry ?? ''} ${month}`,
        `${company.industry ?? company.name} customers ${where} buying behaviour`,
        ...(brand?.competitors ?? []).slice(0, 3).map((c) => `${c} TikTok marketing`),
      ];
      const results: SearchResult[] = [];
      for (const q of queries) {
        try {
          results.push(...(await p.research.search(q, { maxResults: 6 })));
        } catch (e) {
          log(`search "${q}" failed: ${(e as Error).message}`);
        }
      }
      const unique = [...new Map(results.map((r) => [r.url, r])).values()].slice(0, 30);

      const history = await performanceHistory(db, company.id, goal.month);
      const res = await p.llm.structured({
        system: MARKET_RESEARCHER,
        prompt: `${brandBrief(ctx)}

<goal month="${month}" markets="${where}">
${goal.prompt}
</goal>

<past_performance>
${history || 'No previous TikTok activity recorded.'}
</past_performance>

<search_results>
${unique.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content.slice(0, 1500)}`).join('\n\n')}
</search_results>

Write this month's market research for ${company.name}. Give 4-8 trends, the main competitors, audience insights and 2-4 audience segments for paid placements.`,
        schema: researchSchema,
        effort: 'high',
        mock: () => mockResearch(company.name, unique, goal.locations.length ? goal.locations : [company.headquartersCountry ?? 'US']),
      });
      addCost(res.costCents);
      const r = res.data;

      await db
        .update(schema.researchReports)
        .set({
          status: 'succeeded',
          executiveSummary: r.executiveSummary,
          trends: r.trends,
          competitors: r.competitors,
          audienceInsights: r.audienceInsights,
          sources: unique.map(({ title, url }) => ({ title, url })),
        })
        .where(eq(schema.researchReports.id, report.id));

      for (const s of r.segments) {
        try {
          assertNoSensitiveTargeting({ name: s.name, interestLabels: s.interests });
        } catch (e) {
          if (e instanceof SensitiveTargetingError) {
            log(`dropped segment "${s.name}": ${e.message}`);
            continue;
          }
          throw e;
        }
        const ageGroups = ageGroupsForRange(s.ageMin, s.ageMax);
        const locationIds = locationIdsFor(s.countries.length ? s.countries : goal.locations);
        if (!ageGroups.length || !locationIds.length) {
          log(`dropped segment "${s.name}": no valid ages or locations`);
          continue;
        }
        await db.insert(schema.audienceSegments).values({
          companyId: company.id,
          researchReportId: report.id,
          name: s.name,
          ageGroups,
          genders: s.genders.length ? s.genders : ['GENDER_UNLIMITED'],
          locationIds,
          languages: s.languages.filter((l) => /^[a-z]{2}$/.test(l)),
          interestLabels: s.interests,
          rationale: s.rationale,
        });
      }
      return { next: 'plan' };
    },

    async plan({ db, providers: p, input, addCost, log }) {
      const goalId = input.goalId as string;
      const [goal] = await db.select().from(schema.monthlyGoals).where(eq(schema.monthlyGoals.id, goalId));
      const ctx = await brandContext(db, p, goal.companyId, goal.prompt);
      const { company, brand } = ctx;
      const [research] = await db
        .select()
        .from(schema.researchReports)
        .where(and(eq(schema.researchReports.monthlyGoalId, goalId), eq(schema.researchReports.status, 'succeeded')))
        .orderBy(desc(schema.researchReports.createdAt))
        .limit(1);
      const [previous] = await db
        .select()
        .from(schema.marketingPlans)
        .where(eq(schema.marketingPlans.monthlyGoalId, goalId))
        .orderBy(desc(schema.marketingPlans.version))
        .limit(1);
      const requests = await db
        .select()
        .from(schema.contentRequests)
        .where(and(eq(schema.contentRequests.companyId, company.id), eq(schema.contentRequests.status, 'submitted')));
      const monthRequests = requests.filter((r) => isInMonth(r.weekStart, goal.month) || isInMonth(addDays(r.weekStart, 6), goal.month));
      const feedback = (input.feedback as string | undefined) ?? undefined;

      const res = await p.llm.structured({
        system: STRATEGIST,
        prompt: `${brandBrief(ctx)}

<goal month="${formatMonth(goal.month)}" first_day="${goal.month}" last_day="${monthEnd(goal.month)}" timezone="${company.timezone}">
${goal.prompt}
KPIs: ${goal.kpis.map((k) => `${k.metric} -> ${k.target}${k.unit ?? ''}`).join('; ') || 'none given'}
Paid budget for the month: ${formatMoney(goal.adBudgetCents, company.currency)} (${company.currency})
</goal>

${research ? `<research>\n${research.executiveSummary}\nTrends: ${JSON.stringify(research.trends)}\nAudience: ${JSON.stringify(research.audienceInsights)}\n</research>` : ''}

${monthRequests.length ? `<client_requests>\nThe client asked for these specifically; include each one in its week:\n${monthRequests.map((r, n) => `${n + 1}. week of ${r.weekStart}: ${r.format}${r.isPaid ? ' (paid)' : ''}: ${r.prompt}`).join('\n')}\n</client_requests>` : ''}

${previous && feedback ? `<previous_plan version="${previous.version}">\n${previous.strategy}\n</previous_plan>\n<client_feedback>\n${feedback}\n</client_feedback>\nRevise the plan to address the feedback.` : ''}

Build the plan: 3-5 posts per week, mostly short videos, with paid placements only where they serve the KPIs.`,
        schema: planSchema,
        effort: 'high',
        mock: () => mockPlan(goal.month, goal.adBudgetCents / 100, monthRequests),
      });
      addCost(res.costCents);
      const plan = res.data;

      // Guardrails on the model's output: dates in month, spend within budget.
      const items = fitPlannedSpend(
        plan.items
          .filter((i) => {
            const ok = /^\d{4}-\d{2}-\d{2}$/.test(i.date) && isInMonth(i.date, goal.month);
            if (!ok) log(`dropped item outside the month: ${i.date}`);
            return ok;
          })
          .map((i) => ({ ...i, plannedSpendCents: Math.max(0, Math.round(i.plannedSpend * 100)) })),
        goal.adBudgetCents,
      );

      const version = (previous?.version ?? 0) + 1;
      if (previous && previous.status === 'pending_approval') {
        await db.update(schema.marketingPlans).set({ status: 'changes_requested', feedback }).where(eq(schema.marketingPlans.id, previous.id));
      }
      const [created] = await db
        .insert(schema.marketingPlans)
        .values({
          companyId: company.id,
          monthlyGoalId: goal.id,
          researchReportId: research?.id,
          brandProfileId: brand?.id,
          version,
          status: 'pending_approval',
          strategy: plan.strategy,
          contentPillars: plan.contentPillars,
          budgetAllocation: plan.budgetAllocation,
          feedback,
        })
        .returning();
      if (items.length) {
        await db.insert(schema.planItems).values(
          items.map((i) => {
            const request = i.clientRequest > 0 ? monthRequests[i.clientRequest - 1] : undefined;
            return {
              marketingPlanId: created.id,
              contentRequestId: request?.id,
              scheduledFor: localTime(i.date, i.time, company.timezone),
              format: i.format,
              pillar: i.pillar,
              objective: i.objective,
              brief: i.brief,
              isPaid: i.isPaid && i.plannedSpendCents > 0,
              plannedSpendCents: i.isPaid ? i.plannedSpendCents : 0,
            };
          }),
        );
      }
      if (monthRequests.length) {
        await db
          .update(schema.contentRequests)
          .set({ status: 'planned', marketingPlanId: created.id })
          .where(inArray(schema.contentRequests.id, monthRequests.map((r) => r.id)));
      }
      await db.insert(schema.approvals).values({ companyId: company.id, subjectType: 'marketing_plan', subjectId: created.id });
      return { done: true, output: { planId: created.id, version, items: items.length } };
    },
  },
};

/** "2026-11-06" + "17:30" in Africa/Johannesburg -> the UTC instant. */
export function localTime(date: string, time: string, timeZone: string): Date {
  const [h, m] = /^\d{1,2}:\d{2}$/.test(time) ? time.split(':').map(Number) : [12, 0];
  const [y, mo, d] = date.split('-').map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, m);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const shown = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return new Date(asUtc - (shown - asUtc));
}

async function performanceHistory(db: Parameters<WorkflowDef['steps'][string]>[0]['db'], companyId: string, month: string) {
  const since = addDays(month, -90);
  const rows = await db
    .select({
      hook: schema.creatives.hook,
      spend: sql<number>`sum(${schema.adMetricsDaily.spendCents})`,
      impressions: sql<number>`sum(${schema.adMetricsDaily.impressions})`,
      clicks: sql<number>`sum(${schema.adMetricsDaily.clicks})`,
    })
    .from(schema.adMetricsDaily)
    .innerJoin(schema.ads, eq(schema.ads.id, schema.adMetricsDaily.adId))
    .innerJoin(schema.creatives, eq(schema.creatives.id, schema.ads.creativeId))
    .where(and(eq(schema.creatives.companyId, companyId), gte(schema.adMetricsDaily.date, since)))
    .groupBy(schema.creatives.hook)
    .limit(20);
  return rows
    .map((r) => `- "${r.hook}": ${r.impressions} impressions, ${r.clicks} clicks, CTR ${((Number(r.clicks) / Math.max(1, Number(r.impressions))) * 100).toFixed(2)}%`)
    .join('\n');
}

function mockResearch(name: string, results: SearchResult[], countries: string[]): z.infer<typeof researchSchema> {
  const src = results[0]?.url ?? 'https://example.com';
  return {
    executiveSummary: `${name}'s audience responds to fast, authentic behind-the-scenes content. Short hooks and on-screen captions win.`,
    trends: [
      { name: 'Day-in-the-life', format: 'short_video', whyItWorks: 'Authentic and relatable', howToUse: 'Show a team member prepping the bestseller', sourceUrl: src },
      { name: 'POV hooks', format: 'short_video', whyItWorks: 'Instant context in 1 second', howToUse: 'POV: you just found your new favourite', sourceUrl: src },
    ],
    competitors: [{ name: 'Competitor A', whatTheyDo: 'Polished ads, little community', opportunity: 'Be more human', sourceUrl: src }],
    audienceInsights: {
      summary: 'Urban 18-34, mobile-first, discovers brands on TikTok.',
      peakPostingTimes: ['Tue 18:00', 'Thu 19:00', 'Sat 11:00'],
      motivations: ['Value', 'Discovery'],
      objections: ['Price'],
    },
    segments: [
      { name: 'Young urban explorers', ageMin: 18, ageMax: 34, genders: ['GENDER_UNLIMITED'], countries, languages: ['en'], interests: ['Food & Drink'], rationale: 'Highest engagement with similar content.' },
      { name: 'Established professionals', ageMin: 35, ageMax: 54, genders: ['GENDER_UNLIMITED'], countries, languages: ['en'], interests: ['Restaurants'], rationale: 'Higher basket size.' },
    ],
  };
}

function mockPlan(month: string, budget: number, requests: { weekStart: string; format: string; prompt: string; isPaid: boolean }[]): z.infer<typeof planSchema> {
  const days = daysInMonth(month);
  const items: z.infer<typeof planSchema>['items'] = [];
  for (let d = 2; d <= days; d += 3) {
    const date = `${month.slice(0, 8)}${String(d).padStart(2, '0')}`;
    const paid = items.length % 4 === 1;
    items.push({
      date,
      time: '18:00',
      format: items.length % 5 === 4 ? 'carousel' : 'short_video',
      pillar: items.length % 2 ? 'Behind the scenes' : 'Product hero',
      objective: paid ? 'traffic' : 'awareness',
      brief: `Post ${items.length + 1}: show the product in the first second, end on a clear call to action.`,
      isPaid: paid,
      plannedSpend: 0,
      clientRequest: 0,
    });
  }
  // Something due today, so a fresh plan always has content to publish straight away.
  const today = toIsoDate(new Date());
  if (isInMonth(today, month)) {
    items.push({ date: today, time: '00:01', format: 'short_video', pillar: 'Product hero', objective: 'awareness', brief: 'Launch post: the bestseller, up close.', isPaid: false, plannedSpend: 0, clientRequest: 0 });
  }
  for (const [n, r] of requests.entries()) {
    const date = parseIsoDate(r.weekStart) < parseIsoDate(monthStart(month)) ? monthStart(month) : r.weekStart;
    items.push({ date, time: '12:00', format: r.format as (typeof FORMATS)[number], pillar: 'Client request', objective: r.isPaid ? 'traffic' : 'awareness', brief: r.prompt, isPaid: r.isPaid, plannedSpend: 0, clientRequest: n + 1 });
  }
  const paid = items.filter((i) => i.isPaid);
  paid.forEach((i) => (i.plannedSpend = Math.floor(budget / paid.length)));
  return {
    strategy: '## Strategy\nLead with product-first short videos, test two hooks per week, put paid budget behind organic winners.',
    contentPillars: [
      { name: 'Product hero', description: 'Show the product beautifully', share: 0.5 },
      { name: 'Behind the scenes', description: 'People and process', share: 0.5 },
    ],
    budgetAllocation: { traffic: 0.7, awareness: 0.3 },
    items,
  };
}
