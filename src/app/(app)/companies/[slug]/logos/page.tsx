import { desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import { logoRequestAction, selectLogoAction } from '@/app/actions';
import { previewAssets } from '@/lib/queries';
import { ActionForm, SubmitButton } from '@/components/app/action-form';
import { AutoRefresh } from '@/components/app/live';
import { Badge, Card, CardTitle } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Logos' };

const STYLES = ['Wordmark', 'Lettermark', 'Emblem', 'Abstract mark', 'Mascot', 'Minimal line'];

export default async function Logos({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, db } = await getCompany(slug);
  const requests = await db.select().from(schema.logoRequests).where(eq(schema.logoRequests.companyId, company.id)).orderBy(desc(schema.logoRequests.createdAt));
  const concepts = await db
    .select()
    .from(schema.creatives)
    .where(inArray(schema.creatives.logoRequestId, requests.map((r) => r.id).concat(['00000000-0000-0000-0000-000000000000'])))
    .orderBy(schema.creatives.createdAt);
  const images = await previewAssets(db, concepts.map((c) => c.id));
  const working = requests.some((r) => r.status === 'submitted' || r.status === 'in_production');
  return (
    <div className="space-y-6">
      <AutoRefresh active={working} />
      <Card>
        <CardTitle>Design a logo</CardTitle>
        <ActionForm action={logoRequestAction.bind(null, company.id)} submit="Design concepts">
          <label>
            <span className="label">Brief</span>
            <textarea name="prompt" required rows={3} className="field" placeholder="Modern and premium, works as a TikTok avatar, uses our teal. Hint at fresh fruit without being literal." />
          </label>
          <div className="flex flex-wrap gap-3 text-sm">
            {STYLES.map((s) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="checkbox" name="styles" value={s} className="accent-[#7c5cff]" /> {s}
              </label>
            ))}
          </div>
          <label className="w-40">
            <span className="label">Concepts</span>
            <input type="number" name="count" min={1} max={8} defaultValue={4} className="field" />
          </label>
        </ActionForm>
      </Card>
      {requests.map((r) => (
        <Card key={r.id}>
          <CardTitle action={<Badge status={r.status} />}>{r.prompt}</CardTitle>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {concepts
              .filter((c) => c.logoRequestId === r.id)
              .map((c) => (
                <li key={c.id} className={`rounded-xl border p-3 ${r.selectedCreativeId === c.id ? 'border-ok' : 'border-line'}`}>
                  {images.get(c.id) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/assets/${images.get(c.id)}`} alt={c.concept ?? ''} className="aspect-square w-full rounded-lg bg-white object-contain p-3" />
                  )}
                  <div className="mt-2 text-sm font-medium">{c.concept}</div>
                  <p className="line-clamp-4 text-xs text-muted">{c.rationale}</p>
                  {r.selectedCreativeId === c.id ? (
                    <p className="mt-2 text-xs text-ok">Selected · now the brand logo</p>
                  ) : (
                    <form action={selectLogoAction.bind(null, company.id, r.id, c.id)} className="mt-2">
                      <SubmitButton variant="ghost">Use this logo</SubmitButton>
                    </form>
                  )}
                </li>
              ))}
          </ul>
          {working && r.status !== 'delivered' && <p className="text-sm text-muted">Designing…</p>}
        </Card>
      ))}
    </div>
  );
}
