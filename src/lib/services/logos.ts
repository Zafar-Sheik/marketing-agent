import { and, eq, ne } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { createNewBrandVersion } from './companies';
import { creativeFiles } from '@/lib/assets';

/** Choose a logo concept: it becomes the brand logo in a new brand profile version. */
export async function selectLogo(db: Db, logoRequestId: string, creativeId: string, companyId?: string) {
  const [request] = await db
    .select()
    .from(schema.logoRequests)
    .where(and(eq(schema.logoRequests.id, logoRequestId), companyId ? eq(schema.logoRequests.companyId, companyId) : undefined));
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

  const profile = await createNewBrandVersion(db, request.companyId, { logoAssetId: file.asset.id });
  return profile;
}
