import Link from 'next/link';
import { and, desc, eq, ne, inArray } from 'drizzle-orm';
import { schema } from '@/db';
import { previewAssets } from '@/lib/queries';
import { AutoRefresh } from '@/components/app/live';
import { Badge, Empty } from '@/components/ui/primitives';
import { getCompany } from '../data';

export const metadata = { title: 'Content' };

const FILTERS = { all: null, review: ['in_review'], live: ['published', 'scheduled'], working: ['queued', 'generating'], failed: ['failed'] } as const;

export default async function Creatives({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ f?: string }> }) {
  const { slug } = await params;
  const { f = 'all' } = await searchParams;
  const { company, db } = await getCompany(slug);
  const filter = FILTERS[f as keyof typeof FILTERS] ?? null;
  const creatives = await db
    .select()
    .from(schema.creatives)
    .where(and(eq(schema.creatives.companyId, company.id), ne(schema.creatives.format, 'logo'), filter ? inArray(schema.creatives.status, [...filter]) : undefined))
    .orderBy(desc(schema.creatives.createdAt))
    .limit(60);
  const thumbs = await previewAssets(db, creatives.map((c) => c.id));
  const working = creatives.some((c) => c.status === 'queued' || c.status === 'generating');
  return (
    <div className="space-y-4">
      <AutoRefresh active={working} />
      <div className="flex gap-2 text-sm">
        {Object.keys(FILTERS).map((k) => (
          <Link key={k} href={`?f=${k}`} className={`rounded-full border px-3 py-1 capitalize ${k === f ? 'border-accent bg-accent/15' : 'border-line text-muted'}`}>
            {k}
          </Link>
        ))}
      </div>
      {creatives.length ? (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
          {creatives.map((c) => (
            <li key={c.id}>
              <Link href={`/companies/${company.slug}/creatives/${c.id}`} className="group block overflow-hidden rounded-xl border border-line bg-panel hover:border-accent/50">
                <div className="relative aspect-[9/16] bg-panel-2">
                  {thumbs.get(c.id) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/assets/${thumbs.get(c.id)}`} alt="" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                  ) : (
                    <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted">{c.status === 'generating' ? 'Generating…' : 'No preview'}</div>
                  )}
                  <div className="absolute top-2 left-2">
                    <Badge status={c.status} />
                  </div>
                </div>
                <div className="p-2">
                  <div className="line-clamp-2 text-xs">{c.hook ?? c.concept ?? 'Untitled'}</div>
                  <div className="mt-1 text-[10px] text-muted">{c.format.replace('_', ' ')}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No content here yet">Approve a monthly plan or add a request, and the agents start producing.</Empty>
      )}
    </div>
  );
}
