import { and, eq, ne, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { currentBrand } from '@/lib/agents/context';
import { creativeFiles } from '@/lib/assets';

/** Choose a logo concept: it becomes the brand logo in a new brand profile version. */
export async function selectLogo(db: Db, logoRequestId: string, creativeId: string) {
  const [request] = await db.select().from(schema.logoRequests).where(eq(schema.logoRequests.id, logoRequestId));
  const [creative] = await db
    .select()
    .from(schema.creatives)
    .where(and(eq(schema.creatives.id, creativeId), eq(schema.creatives.logoRequestId, logoRequestId)));
  if (!request || !creative) throw new Error('Logo concept not found for this request.');
  const file = (await creativeFiles(db, creativeId)).find((f) => f.role === 'logo_png');
  if (!file) throw new Error('This concept has no image yet.');

  await db.update(schema.logoRequests).set({ selectedCreativeId: creativeId, status: 'delivered' }).where(eq(schema.logoRequests.id, logoRequestId));
  await db.update(schema.creatives).set({ status: 'approved' }).where(eq(schema.creatives.id, creativeId));
  await db
    .update(schema.creatives)
    .set({ status: 'rejected' })
    .where(and(eq(schema.creatives.logoRequestId, logoRequestId), ne(schema.creatives.id, creativeId)));

  const brand = await currentBrand(db, request.companyId);
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${schema.brandProfiles.version}), 0)` })
    .from(schema.brandProfiles)
    .where(eq(schema.brandProfiles.companyId, request.companyId));
  if (brand) await db.update(schema.brandProfiles).set({ isCurrent: false }).where(eq(schema.brandProfiles.id, brand.id));
  const { id: _id, createdAt: _c, version: _v, ...rest } = brand ?? ({} as NonNullable<typeof brand>);
  const [profile] = await db
    .insert(schema.brandProfiles)
    .values({ ...rest, companyId: request.companyId, version: Number(max) + 1, isCurrent: true, logoAssetId: file.asset.id })
    .returning();
  return profile;
}
