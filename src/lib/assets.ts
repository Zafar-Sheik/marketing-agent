import { eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { schema } from '@/db';
import type { Providers } from '@/lib/providers';
import { sha256Hex } from '@/lib/crypto';

type Kind = (typeof schema.assetKind.enumValues)[number];

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
};

export function extFor(mime: string) {
  return EXT[mime] ?? 'bin';
}

export function kindFor(mime: string): Kind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('font/') || /woff|ttf|otf/.test(mime)) return 'font';
  return 'document';
}

/** Upload bytes to S3 and register them in `assets`. */
export async function storeAsset(
  db: Db,
  p: Providers,
  input: { companyId: string; key: string; bytes: Buffer; mimeType: string; kind?: Kind; width?: number; height?: number; durationMs?: number },
) {
  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, input.companyId));
  const key = input.key.includes('.') ? input.key : `${input.key}.${extFor(input.mimeType)}`;
  await p.storage.put(key, input.bytes, input.mimeType);
  const [asset] = await db
    .insert(schema.assets)
    .values({
      workspaceId: company.workspaceId,
      companyId: input.companyId,
      kind: input.kind ?? kindFor(input.mimeType),
      s3Bucket: p.storage.bucket,
      s3Key: key,
      mimeType: input.mimeType,
      bytes: input.bytes.length,
      sha256: sha256Hex(input.bytes),
      width: input.width,
      height: input.height,
      durationMs: input.durationMs,
    })
    .onConflictDoUpdate({
      target: [schema.assets.s3Bucket, schema.assets.s3Key],
      set: { bytes: input.bytes.length, sha256: sha256Hex(input.bytes), mimeType: input.mimeType },
    })
    .returning();
  return asset;
}

export async function attachToCreative(
  db: Db,
  creativeId: string,
  assetId: string,
  role: string,
  provider?: string,
  providerJobId?: string,
) {
  await db
    .insert(schema.creativeAssets)
    .values({ creativeId, assetId, role, provider, providerJobId })
    .onConflictDoNothing();
}

export async function creativeFiles(db: Db, creativeId: string) {
  return db
    .select({ role: schema.creativeAssets.role, asset: schema.assets })
    .from(schema.creativeAssets)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.creativeAssets.assetId))
    .where(eq(schema.creativeAssets.creativeId, creativeId))
    .orderBy(schema.creativeAssets.createdAt);
}
