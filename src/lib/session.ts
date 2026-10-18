import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { db, schema } from '@/db';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Signed-in user with their workspace; redirects to sign-in on pages. */
export async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/signin');
  const d = await db();
  const [row] = await d
    .select({ user: schema.users, workspace: schema.workspaces, role: schema.workspaceMembers.role })
    .from(schema.workspaceMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.workspaceMembers.userId))
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.workspaceMembers.workspaceId))
    .where(eq(schema.workspaceMembers.userId, userId))
    .limit(1);
  if (!row) redirect('/signin');
  return { ...row, db: d };
}

/** A company the signed-in user's workspace owns, by slug or id. */
export async function requireCompany(slugOrId: string) {
  const ctx = await requireUser();
  const isId = /^[0-9a-f-]{36}$/.test(slugOrId);
  const [company] = await ctx.db
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.workspaceId, ctx.workspace.id), isId ? eq(schema.companies.id, slugOrId) : eq(schema.companies.slug, slugOrId)));
  if (!company) throw new HttpError(404, 'Company not found');
  return { ...ctx, company };
}

export function canEdit(role: string) {
  return role === 'owner' || role === 'admin' || role === 'editor';
}
