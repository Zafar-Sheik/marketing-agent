import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { route } from '@/lib/http';
import { providers } from '@/lib/providers';
import { HttpError, requireUser } from '@/lib/session';

/** Short-lived redirect to an asset the signed-in workspace owns. */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { db, workspace } = await requireUser();
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.id, id), eq(schema.assets.workspaceId, workspace.id)));
  if (!asset) throw new HttpError(404, 'Not found');
  return NextResponse.redirect(await providers().storage.presignGet(asset.s3Key, 600), 302);
});
