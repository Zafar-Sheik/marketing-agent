import Link from 'next/link';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@/db';
import { formatMoney } from '@/lib/domain/money';
import { optimiseNowAction } from '@/app/actions';
import { SubmitButton } from '@/components/app/action-form';
import { AutoRefresh } from '@/components/app/live';
import { Badge, Card, CardTitle, Empty } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Ads' };

export default async function Ads({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const money = (c: number) => formatMoney(c, company.currency);
  const campaigns = await db.select().from(schema.adCampaigns).where(eq(schema.adCampaigns.companyId, company.id)).orderBy(desc(schema.adCampaigns.createdAt));
  const none = ['00000000-0000-0000-0000-000000000000'];
  const groups = await db.select().from(schema.adGroups).where(inArray(schema.adGroups.adCampaignId, campaigns.map((c) => c.id).concat(none)));
  const segments = await db.select().from(schema.audienceSegments).where(inArray(schema.audienceSegments.id, groups.map((g) => g.audienceSegmentId!).filter(Boolean).concat(none)));
  const ads = await db
    .select({
      ad: schema.ads,
      hook: schema.creatives.hook,
      spend: sql<number>`coalesce(sum(${schema.adMetricsDaily.spendCents}), 0)::bigint`,
      impressions: sql<number>`coalesce(sum(${schema.adMetricsDaily.impressions}), 0)::bigint`,
      clicks: sql<number>`coalesce(sum(${schema.adMetricsDaily.clicks}), 0)::bigint`,
      views: sql<number>`coalesce(sum(${schema.adMetricsDaily.videoViews}), 0)::bigint`,
      conversions: sql<number>`coalesce(sum(${schema.adMetricsDaily.conversions}), 0)::bigint`,
    })
    .from(schema.ads)
    .innerJoin(schema.creatives, eq(schema.creatives.id, schema.ads.creativeId))
    .leftJoin(schema.adMetricsDaily, eq(schema.adMetricsDaily.adId, schema.ads.id))
    .where(inArray(schema.ads.adGroupId, groups.map((g) => g.id).concat(none)))
    .groupBy(schema.ads.id, schema.creatives.hook);
  const [lastOptimise] = await db
    .select()
    .from(schema.agentRuns)
    .where(and(eq(schema.agentRuns.companyId, company.id), eq(schema.agentRuns.workflow, 'optimise')))
    .orderBy(desc(schema.agentRuns.createdAt))
    .limit(1);
  const working = lastOptimise && (lastOptimise.status === 'queued' || lastOptimise.status === 'running');
  const out = (lastOptimise?.output ?? {}) as { summary?: string; applied?: { type: string; reason: string }[] };

  return (
    <div className="space-y-6">
      <AutoRefresh active={Boolean(working) || campaigns.some((c) => c.status === 'in_review' || c.status === 'submitted')} seconds={10} />
      <Card>
        <CardTitle
          action={
            campaigns.length > 0 && (
              <form action={optimiseNowAction.bind(null, company.id)}>
                <SubmitButton variant="ghost">Sync & optimise now</SubmitButton>
              </form>
            )
          }
        >
          Optimiser
        </CardTitle>
        {lastOptimise ? (
          <div className="text-sm">
            <p>
              Last run {lastOptimise.createdAt.toLocaleString()} <Badge status={lastOptimise.status} />
            </p>
            {out.summary && <p className="mt-2 text-muted">{out.summary}</p>}
            {out.applied?.length ? (
              <ul className="mt-2 list-disc pl-5 text-muted">
                {out.applied.map((a, i) => (
                  <li key={i}>
                    {a.type.replace(/_/g, ' ')}: {a.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">Runs daily once ads are live: syncs results from TikTok and moves budget to what works, within your guardrails.</p>
        )}
      </Card>

      {campaigns.length ? (
        campaigns.map((c) => {
          const cGroups = groups.filter((g) => g.adCampaignId === c.id);
          return (
            <Card key={c.id}>
              <CardTitle action={<Badge status={c.status} />}>{c.name}</CardTitle>
              <p className="mb-4 text-sm text-muted">
                {c.objective} · {money(c.budgetCents)} total
                {c.startsAt && ` · ${c.startsAt.toLocaleDateString()} – ${c.endsAt?.toLocaleDateString()}`}
                {c.tiktokCampaignId && ` · TikTok #${c.tiktokCampaignId}`}
              </p>
              {cGroups.map((g) => {
                const seg = segments.find((s) => s.id === g.audienceSegmentId);
                return (
                  <div key={g.id} className="mb-4 rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-medium">{g.name}</span>
                      <span className="text-muted">{money(g.dailyBudgetCents)}/day</span>
                    </div>
                    {seg && (
                      <p className="mt-1 text-xs text-muted">
                        Ages {seg.ageGroups.map((a) => a.replace('AGE_', '').replace('_', '–')).join(', ')} · {seg.genders.map((x) => x.replace('GENDER_', '').toLowerCase()).join(', ')} ·{' '}
                        {seg.interestLabels.join(', ') || 'broad'} · {seg.languages.join(', ')}
                        <br />
                        {seg.rationale}
                      </p>
                    )}
                    <table className="mt-3 w-full text-left text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th className="py-1 font-normal">Ad</th>
                          <th className="font-normal">Status</th>
                          <th className="text-right font-normal">Spend</th>
                          <th className="text-right font-normal">Impr.</th>
                          <th className="text-right font-normal">Clicks</th>
                          <th className="text-right font-normal">CTR</th>
                          <th className="text-right font-normal">Conv.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ads
                          .filter((a) => a.ad.adGroupId === g.id)
                          .map((a) => (
                            <tr key={a.ad.id} className="border-t border-line">
                              <td className="py-1.5">
                                <Link href={`/companies/${company.slug}/creatives/${a.ad.creativeId}`} className="hover:underline">
                                  {a.hook ?? a.ad.adText}
                                </Link>
                                {a.ad.rejectionReason && <div className="text-bad">{a.ad.rejectionReason}</div>}
                              </td>
                              <td>
                                <Badge status={a.ad.status} />
                              </td>
                              <td className="text-right tabular-nums">{money(Number(a.spend))}</td>
                              <td className="text-right tabular-nums">{Number(a.impressions).toLocaleString()}</td>
                              <td className="text-right tabular-nums">{Number(a.clicks).toLocaleString()}</td>
                              <td className="text-right tabular-nums">{((Number(a.clicks) / Math.max(1, Number(a.impressions))) * 100).toFixed(2)}%</td>
                              <td className="text-right tabular-nums">{Number(a.conversions)}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </Card>
          );
        })
      ) : (
        <Empty title="No campaigns yet">Paid items in the plan become campaign proposals once their content is approved.</Empty>
      )}
    </div>
  );
}
