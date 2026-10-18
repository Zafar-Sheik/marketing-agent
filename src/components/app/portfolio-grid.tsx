import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';

export async function PortfolioGrid({ db, companyId }: { db: Db; companyId: string }) {
  const items = await db
    .select({ item: schema.portfolioItems, asset: schema.assets })
    .from(schema.portfolioItems)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.portfolioItems.assetId))
    .where(eq(schema.portfolioItems.companyId, companyId))
    .orderBy(schema.portfolioItems.createdAt);
  if (!items.length) return null;
  return (
    <ul className="mt-4 grid grid-cols-3 gap-3 md:grid-cols-6">
      {items.map(({ item, asset }) => (
        <li key={item.id} className="overflow-hidden rounded-lg border border-line bg-panel-2" title={item.aiDescription ?? item.title ?? ''}>
          {asset.mimeType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/assets/${asset.id}`} alt={item.title ?? ''} className="aspect-square w-full object-cover" />
          ) : (
            <div className="flex aspect-square items-center justify-center p-2 text-center text-xs text-muted">{asset.mimeType}</div>
          )}
          <div className="truncate px-2 py-1 text-xs text-muted">{item.title}</div>
        </li>
      ))}
    </ul>
  );
}
