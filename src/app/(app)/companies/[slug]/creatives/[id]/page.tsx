import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { creativeFiles } from '@/lib/assets';
import { RUN_STEPS } from '@/lib/run-labels';
import { regenerateAction, retryCreativeAction } from '@/app/actions';
import { ApprovalButtons } from '@/components/app/approval-buttons';
import { SubmitButton } from '@/components/app/action-form';
import { AutoRefresh, RunProgress } from '@/components/app/live';
import { Badge, Card, CardTitle } from '@/components/ui/primitives';
import { getCompany } from '../../data';

export const metadata = { title: 'Content' };

export default async function CreativePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const { company, db } = await getCompany(slug);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [creative] = await db.select().from(schema.creatives).where(and(eq(schema.creatives.id, id), eq(schema.creatives.companyId, company.id)));
  if (!creative) notFound();
  const files = await creativeFiles(db, creative.id);
  const latest = (role: string) => {
    const all = files.filter((f) => f.role === role);
    const version = all.at(-1)?.asset.s3Key.match(/\/v(\d+)\//)?.[1];
    return all.filter((f) => !version || f.asset.s3Key.includes(`/v${version}/`));
  };
  const final = latest('final').at(-1);
  const slides = latest('slide');
  const frames = latest('frame');
  const [run] = await db.select().from(schema.agentRuns).where(and(eq(schema.agentRuns.subjectId, creative.id), eq(schema.agentRuns.workflow, 'creative-production'))).orderBy(desc(schema.agentRuns.createdAt)).limit(1);
  const [approval] = await db.select().from(schema.approvals).where(and(eq(schema.approvals.subjectId, creative.id), eq(schema.approvals.decision, 'pending')));
  const children = await db.select({ id: schema.creatives.id, status: schema.creatives.status, createdAt: schema.creatives.createdAt }).from(schema.creatives).where(eq(schema.creatives.parentCreativeId, creative.id));
  const [post] = await db.select().from(schema.organicPosts).where(eq(schema.organicPosts.creativeId, creative.id)).orderBy(desc(schema.organicPosts.createdAt)).limit(1);
  const [ad] = await db.select().from(schema.ads).where(eq(schema.ads.creativeId, creative.id)).limit(1);
  const working = creative.status === 'queued' || creative.status === 'generating';
  const base = `/companies/${company.slug}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <AutoRefresh active={working} />
      <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-line bg-black">
          {final?.asset.mimeType.startsWith('video/') ? (
            <video src={`/api/assets/${final.asset.id}`} controls playsInline className="aspect-[9/16] w-full" poster={frames[0] ? `/api/assets/${frames[0].asset.id}` : undefined} />
          ) : final || slides[0] || frames[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/assets/${(final ?? slides[0] ?? frames[0]).asset.id}`} alt="" className="aspect-[9/16] w-full object-cover" />
          ) : (
            <div className="flex aspect-[9/16] items-center justify-center text-sm text-muted">{working ? 'Generating…' : 'No media'}</div>
          )}
        </div>
        {slides.length > 1 && (
          <div className="grid grid-cols-4 gap-2">
            {slides.map((s) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={s.asset.id} src={`/api/assets/${s.asset.id}`} alt="" className="aspect-[9/16] rounded-md border border-line object-cover" />
            ))}
          </div>
        )}
        {post?.shareUrl && (
          <a href={post.shareUrl} target="_blank" rel="noreferrer" className="block text-sm text-accent hover:underline">
            View on TikTok ↗
          </a>
        )}
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge status={creative.status} />
          <span className="text-sm text-muted">{creative.format.replace('_', ' ')}</span>
          {creative.brandScore != null && <span className="text-sm text-muted">· brand score {Math.round(creative.brandScore * 100)}%</span>}
          {creative.parentCreativeId && (
            <Link href={`${base}/creatives/${creative.parentCreativeId}`} className="text-sm text-accent hover:underline">
              · previous version
            </Link>
          )}
          {children.map((c) => (
            <Link key={c.id} href={`${base}/creatives/${c.id}`} className="text-sm text-accent hover:underline">
              · newer version ({c.status.replace('_', ' ')})
            </Link>
          ))}
        </div>

        {working && run && (
          <Card>
            <CardTitle>In production</CardTitle>
            <RunProgress runId={run.id} steps={[...RUN_STEPS['creative-production']]} />
          </Card>
        )}

        {approval && (
          <Card className="border-warn/40">
            <CardTitle>Ready for your review</CardTitle>
            <ApprovalButtons approvalId={approval.id} />
          </Card>
        )}

        {creative.status === 'failed' && (
          <Card className="border-bad/40">
            <CardTitle>Production failed</CardTitle>
            <p className="mb-3 text-sm text-bad">{creative.feedback ?? run?.error}</p>
            <form action={retryCreativeAction.bind(null, creative.id)}>
              <SubmitButton variant="ghost">Retry</SubmitButton>
            </form>
          </Card>
        )}

        <Card>
          <CardTitle>{creative.hook ?? creative.concept ?? 'Concept'}</CardTitle>
          <dl className="space-y-3 text-sm">
            <Row label="Concept">{creative.concept}</Row>
            <Row label="Script">{creative.script}</Row>
            <Row label="Caption">
              {creative.caption} <span className="text-accent">{creative.hashtags.join(' ')}</span>
            </Row>
            <Row label="Call to action">{creative.callToAction}</Row>
            <Row label="Why">{creative.rationale}</Row>
            {creative.feedback && creative.status !== 'failed' && <Row label="Notes">{creative.feedback}</Row>}
          </dl>
        </Card>

        {creative.storyboard.length > 0 && (
          <Card>
            <CardTitle>Storyboard</CardTitle>
            <ol className="space-y-3 text-sm">
              {creative.storyboard.map((s, i) => (
                <li key={s.scene} className="flex gap-3">
                  {frames[i] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/assets/${frames[i].asset.id}`} alt="" className="h-24 w-14 shrink-0 rounded border border-line object-cover" />
                  )}
                  <div>
                    <div className="font-medium">
                      Scene {s.scene} · {s.durationMs / 1000}s {s.onScreenText && <span className="text-muted">“{s.onScreenText}”</span>}
                    </div>
                    <div className="text-muted">{s.visual}</div>
                    {s.voiceover && <div>VO: {s.voiceover}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}

        {(ad || post) && (
          <Card>
            <CardTitle>Distribution</CardTitle>
            {ad && (
              <p className="text-sm">
                Paid ad <Badge status={ad.status} /> {ad.rejectionReason && <span className="text-bad">TikTok: {ad.rejectionReason}</span>}{' '}
                <Link href={`${base}/ads`} className="text-accent hover:underline">
                  see campaign
                </Link>
              </p>
            )}
            {post && (
              <p className="text-sm">
                Organic post <Badge status={post.status} /> {post.status === 'scheduled' && `for ${post.scheduledFor.toLocaleString()}`}
                {post.privacyLevel === 'SELF_ONLY' && <span className="ml-1 text-warn">(private: your TikTok app is not audited yet)</span>}
                {post.error && <span className="text-bad"> {post.error}</span>}
              </p>
            )}
          </Card>
        )}

        {!working && creative.status !== 'failed' && (
          <Card>
            <CardTitle>Make a new version</CardTitle>
            <form action={regenerateAction.bind(null, creative.id)} className="flex gap-2">
              <input name="feedback" required placeholder="Warmer colours, faster cuts, mention free delivery…" className="field" />
              <SubmitButton variant="ghost">Regenerate</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className="grid gap-1 md:grid-cols-[120px_1fr]">
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap">{children}</dd>
    </div>
  );
}
