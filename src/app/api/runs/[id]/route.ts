import { and, eq } from 'drizzle-orm';
import { schema } from '@/db';
import { route } from '@/lib/http';
import { HttpError, requireUser } from '@/lib/session';

/** Progress of an agent run for loaders in the UI. */
export const GET = route(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { db, workspace } = await requireUser();
  const [row] = await db
    .select({ run: schema.agentRuns })
    .from(schema.agentRuns)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.agentRuns.companyId))
    .where(and(eq(schema.agentRuns.id, id), eq(schema.companies.workspaceId, workspace.id)));
  if (!row) throw new HttpError(404, 'Not found');
  const out = (row.run.output ?? {}) as { step?: string | null; log?: string[] };
  return { status: row.run.status, step: out.step ?? null, error: row.run.error, log: (out.log ?? []).slice(-5) };
});
