import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@/db';
import { route } from '@/lib/http';
import { providers } from '@/lib/providers';
import { HttpError, requireCompany } from '@/lib/session';
import { kindFor } from '@/lib/assets';
import { createNewBrandVersion } from '@/lib/services/companies';

const body = z.object({
  companyId: z.string().uuid(),
  key: z.string(),
  purpose: z.enum(['portfolio', 'logo', 'font']),
  title: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});

/** Verify the object landed in S3, then register it. */
export const POST = route(async (req: Request) => {
  const input = body.parse(await req.json());
  const { company, user, db } = await requireCompany(input.companyId);
  if (!input.key.startsWith(`companies/${company.id}/${input.purpose}/`)) throw new HttpError(400, 'Key does not belong to this company.');
  const p = providers();
  const head = await p.storage.head(input.key);
  if (!head) throw new HttpError(400, 'Upload not found in storage. Try again.');
  const [asset] = await db
    .insert(schema.assets)
    .values({
      workspaceId: company.workspaceId,
      companyId: company.id,
      kind: input.purpose === 'logo' ? 'logo' : input.purpose === 'font' ? 'font' : kindFor(head.mimeType),
      s3Bucket: p.storage.bucket,
      s3Key: input.key,
      mimeType: head.mimeType,
      bytes: head.bytes,
      uploadedBy: user.id,
    })
    .onConflictDoNothing()
    .returning();
  if (!asset) {
    const [existing] = await db.select().from(schema.assets).where(eq(schema.assets.s3Key, input.key));
    return { assetId: existing.id };
  }
  if (input.purpose === 'portfolio') {
    await db.insert(schema.portfolioItems).values({ companyId: company.id, assetId: asset.id, title: input.title, notes: input.notes });
  }
  if (input.purpose === 'logo') {
    await createNewBrandVersion(db, company.id, { logoAssetId: asset.id });
  }
  return { assetId: asset.id };
});
