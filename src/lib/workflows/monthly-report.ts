import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@/db';
import { env } from '@/env';
import { REPORT_WRITER } from '@/lib/agents/prompts';
import { brandBrief, brandContext, latestPlanForGoal } from '@/lib/agents/context';
import { formatMonth, monthEnd, monthStart } from '@/lib/domain/dates';
import { formatMoney } from '@/lib/domain/money';
import { storeAsset } from '@/lib/assets';
import { renderReportPdf } from '@/lib/pdf/report-pdf';
import type { WorkflowDef } from '@/lib/engine/types';

const reportSchema = z.object({
  summary: z.string(),
  kpiResults: z.array(z.object({ metric: z.string(), target: z.number(), actual: z.number() })),
  adverts: z.array(
    z.object({
      number: z.number().int().describe('1-based number from the content table'),
      audience: z.string(),
      results: z.string(),
      learnings: z.string(),
    }),
  ),
  logos: z.array(z.object({ name: z.string(), rationale: z.string(), selected: z.boolean() })),
  researchRecap: z.string(),
  recommendations: z.string(),
});

/** Month end: KPI results, per-advert and logo documentation, research recap, recommendations, PDF, email. */
export const monthlyReport: WorkflowDef = {
  first: 'compile',
  steps: {
    async compile({ db, providers: p, run, input, state, addCost }) {
      const companyId = run.companyId!;
      const month = monthStart(input.month as string);
      const from = new Date(`${month}T00:00:00Z`);
      const to = new Date(`${monthEnd(month)}T23:59:59Z`);
      const ctx = await brandContext(db, p, companyId, 'monthly results report');
      const { company } = ctx;
      const [goal] = await db
        .select()
        .from(schema.monthlyGoals)
        .where(and(eq(schema.monthlyGoals.companyId, companyId), eq(schema.monthlyGoals.month, month)));
      const plan = goal ? await latestPlanForGoal(db, goal.id) : undefined;
      const [research] = goal
        ? await db.select().from(schema.researchReports).where(eq(schema.researchReports.monthlyGoalId, goal.id)).orderBy(desc(schema.researchReports.createdAt)).limit(1)
        : [];

      const content = await db
        .select({
          creative: schema.creatives,
          spend: sql<number>`coalesce((select sum(m.spend_cents) from ads a join ad_metrics_daily m on m.ad_id = a.id where a.creative_id = creatives.id and m.date between ${month} and ${monthEnd(month)}), 0)::bigint`,
          impressions: sql<number>`coalesce((select sum(m.impressions) from ads a join ad_metrics_daily m on m.ad_id = a.id where a.creative_id = creatives.id and m.date between ${month} and ${monthEnd(month)}), 0)::bigint`,
          clicks: sql<number>`coalesce((select sum(m.clicks) from ads a join ad_metrics_daily m on m.ad_id = a.id where a.creative_id = creatives.id and m.date between ${month} and ${monthEnd(month)}), 0)::bigint`,
          views: sql<number>`coalesce((select max(pm.views) from organic_posts op join post_metrics_daily pm on pm.organic_post_id = op.id where op.creative_id = creatives.id), 0)::bigint`,
          audience: sql<string>`(select s.name from ads a join ad_groups g on g.id = a.ad_group_id join audience_segments s on s.id = g.audience_segment_id where a.creative_id = creatives.id limit 1)`,
        })
        .from(schema.creatives)
        .where(
          and(
            eq(schema.creatives.companyId, companyId),
            inArray(schema.creatives.status, ['published', 'scheduled', 'approved']),
            gte(schema.creatives.createdAt, new Date(from.getTime() - 14 * 86_400_000)),
            lte(schema.creatives.createdAt, to),
            sql`${schema.creatives.format} <> 'logo'`,
          ),
        );
      const logos = await db
        .select({ creative: schema.creatives, selected: schema.logoRequests.selectedCreativeId })
        .from(schema.creatives)
        .innerJoin(schema.logoRequests, eq(schema.logoRequests.id, schema.creatives.logoRequestId))
        .where(and(eq(schema.creatives.companyId, companyId), gte(schema.creatives.createdAt, from), lte(schema.creatives.createdAt, to)));
      const spent = content.reduce((s, c) => s + Number(c.spend), 0);

      const res = await p.llm.structured({
        system: REPORT_WRITER,
        prompt: `${brandBrief(ctx)}

<month>${formatMonth(month)}</month>
<goal>${goal?.prompt ?? 'No goals were set.'}</goal>
<kpis>${goal?.kpis.map((k) => `${k.metric}: target ${k.target}`).join('; ') ?? 'none'}</kpis>
<budget>${formatMoney(goal?.adBudgetCents ?? 0, company.currency)}, spent ${formatMoney(spent, company.currency)}</budget>
<strategy>${plan?.strategy ?? ''}</strategy>
<research>${research?.executiveSummary ?? ''}</research>

<content>
| # | format | hook | concept | spend | impressions | clicks | organic views |
${content
  .map((c, i) => `| ${i + 1} | ${c.creative.format} | ${c.creative.hook} | ${c.creative.concept} | ${formatMoney(Number(c.spend), company.currency)} | ${c.impressions} | ${c.clicks} | ${c.views} |`)
  .join('\n')}
</content>

<logos>
${logos.map((l) => `- ${l.creative.concept}${l.selected === l.creative.id ? ' (selected)' : ''}: ${l.creative.rationale}`).join('\n') || 'none'}
</logos>

Write the report. Compute KPI actuals only from the numbers given; if a KPI cannot be measured from them, use 0 and say so in the summary.`,
        schema: reportSchema,
        effort: 'high',
        mock: () => ({
          summary: `${company.name} published ${content.length} pieces this month and spent ${formatMoney(spent, company.currency)}.`,
          kpiResults: (goal?.kpis ?? []).map((k) => ({ metric: k.metric, target: k.target, actual: 0 })),
          adverts: content.map((_, i) => ({ number: i + 1, audience: content[i].audience ?? 'Organic', results: 'See table', learnings: 'Product-first hooks held attention.' })),
          logos: logos.map((l) => ({ name: l.creative.concept ?? 'Concept', rationale: l.creative.rationale ?? '', selected: l.selected === l.creative.id })),
          researchRecap: research?.executiveSummary ?? 'No research this month.',
          recommendations: 'Double down on the best hook, test two new formats, keep budget on winners.',
        }),
      });
      addCost(res.costCents);
      const r = res.data;

      const creativeBreakdown = r.adverts
        .filter((a) => content[a.number - 1])
        .map((a) => {
          const c = content[a.number - 1];
          return {
            creativeId: c.creative.id,
            title: c.creative.concept ?? 'Content',
            format: c.creative.format,
            hook: c.creative.hook ?? '',
            audience: a.audience,
            spendCents: Number(c.spend),
            impressions: Number(c.impressions),
            clicks: Number(c.clicks),
            views: Number(c.views),
            results: a.results,
            learnings: a.learnings,
          };
        });
      const [report] = await db
        .insert(schema.monthlyReports)
        .values({
          companyId,
          marketingPlanId: plan?.id,
          researchReportId: research?.id,
          month,
          status: 'running',
          summary: r.summary,
          kpiResults: r.kpiResults,
          creativeBreakdown,
          logoBreakdown: r.logos,
          recommendations: r.recommendations,
        })
        .onConflictDoUpdate({
          target: [schema.monthlyReports.companyId, schema.monthlyReports.month],
          set: { summary: r.summary, kpiResults: r.kpiResults, creativeBreakdown, logoBreakdown: r.logos, recommendations: r.recommendations, status: 'running' },
        })
        .returning();
      state.reportId = report.id;
      state.researchRecap = r.researchRecap;
      state.spent = spent;
      return { next: 'pdf' };
    },

    async pdf({ db, providers: p, run, state }) {
      const [report] = await db.select().from(schema.monthlyReports).where(eq(schema.monthlyReports.id, state.reportId as string));
      const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, run.companyId!));
      const [goal] = await db
        .select()
        .from(schema.monthlyGoals)
        .where(and(eq(schema.monthlyGoals.companyId, company.id), eq(schema.monthlyGoals.month, report.month)));
      const ctx = await brandContext(db, p, company.id, 'report');
      const money = (c: number) => formatMoney(c, company.currency);
      const breakdown = report.creativeBreakdown as {
        title: string; format: string; hook: string; audience: string; spendCents: number; impressions: number; clicks: number; views: number; results: string; learnings: string;
      }[];
      const bytes = await renderReportPdf({
        companyName: company.name,
        monthLabel: formatMonth(report.month),
        brandColor: ctx.brand?.primaryColors[0] ?? '#111827',
        summary: report.summary ?? '',
        kpis: report.kpiResults,
        spend: { budget: money(goal?.adBudgetCents ?? 0), spent: money(state.spent as number) },
        adverts: breakdown.map((b) => ({
          title: b.title,
          format: b.format,
          hook: b.hook,
          audience: b.audience,
          spend: money(b.spendCents),
          results: `${b.impressions} impressions, ${b.clicks} clicks, ${b.views} organic views. ${b.results}`,
          learnings: b.learnings,
        })),
        logos: report.logoBreakdown as { name: string; rationale: string; selected: boolean }[],
        research: state.researchRecap as string,
        recommendations: report.recommendations ?? '',
      });
      const asset = await storeAsset(db, p, {
        companyId: company.id,
        key: `companies/${company.id}/reports/${report.month}-report.pdf`,
        bytes,
        mimeType: 'application/pdf',
        kind: 'report',
      });
      await db.update(schema.monthlyReports).set({ pdfAssetId: asset.id, status: 'succeeded' }).where(eq(schema.monthlyReports.id, report.id));
      state.pdfKey = asset.s3Key;
      return { next: 'send' };
    },

    async send({ db, providers: p, run, state }) {
      const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, run.companyId!));
      const [report] = await db.select().from(schema.monthlyReports).where(eq(schema.monthlyReports.id, state.reportId as string));
      const members = await db
        .select({ email: schema.users.email })
        .from(schema.workspaceMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
        .where(and(eq(schema.workspaceMembers.workspaceId, company.workspaceId), inArray(schema.workspaceMembers.role, ['owner', 'admin'])));
      if (members.length) {
        const link = await p.storage.presignGet(state.pdfKey as string, 7 * 86_400);
        await p.mail.send({
          to: members.map((m) => m.email),
          subject: `${company.name}: your ${formatMonth(report.month)} TikTok report`,
          html: `<p>${report.summary}</p><p><a href="${link}">Download the PDF report</a> (link valid 7 days) or open it in <a href="${env().NEXT_PUBLIC_APP_URL}/companies/${company.slug}/reports">Marketing Agent</a>.</p>`,
        });
      }
      await db.update(schema.monthlyReports).set({ sentAt: new Date() }).where(eq(schema.monthlyReports.id, report.id));
      if (report.marketingPlanId) {
        await db.update(schema.marketingPlans).set({ status: 'completed' }).where(eq(schema.marketingPlans.id, report.marketingPlanId));
      }
      return { done: true, output: { reportId: report.id, emailed: members.length } };
    },
  },
};
