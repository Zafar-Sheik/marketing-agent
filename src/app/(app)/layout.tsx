import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import { Bot, CheckSquare, LayoutDashboard, LogOut, Plus, Settings } from 'lucide-react';
import { schema } from '@/db';
import { requireUser } from '@/lib/session';
import { signOutAction } from '@/app/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, user, workspace } = await requireUser();
  const companies = await db
    .select({ name: schema.companies.name, slug: schema.companies.slug, status: schema.companies.status })
    .from(schema.companies)
    .where(eq(schema.companies.workspaceId, workspace.id))
    .orderBy(schema.companies.name);
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(schema.approvals)
    .innerJoin(schema.companies, eq(schema.companies.id, schema.approvals.companyId))
    .where(and(eq(schema.companies.workspaceId, workspace.id), eq(schema.approvals.decision, 'pending')));

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-panel/60 p-4 md:flex">
        <Link href="/dashboard" className="mb-6 flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent/20">
            <Bot className="size-4 text-accent" />
          </span>
          Marketing Agent
        </Link>
        <nav className="flex flex-col gap-1 text-sm">
          <NavLink href="/dashboard" icon={<LayoutDashboard className="size-4" />}>
            Dashboard
          </NavLink>
          <NavLink href="/approvals" icon={<CheckSquare className="size-4" />}>
            Approvals
            {pending > 0 && <span className="ml-auto rounded-full bg-warn/20 px-2 text-xs text-warn">{pending}</span>}
          </NavLink>
          <NavLink href="/settings" icon={<Settings className="size-4" />}>
            Settings
          </NavLink>
        </nav>
        <div className="mt-6 mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-muted">
          Clients
          <Link href="/companies/new" className="rounded p-1 hover:bg-panel-2 hover:text-fg" aria-label="New client">
            <Plus className="size-3.5" />
          </Link>
        </div>
        <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto text-sm">
          {companies.map((c) => (
            <Link key={c.slug} href={`/companies/${c.slug}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted hover:bg-panel-2 hover:text-fg">
              <span className={`size-1.5 rounded-full ${c.status === 'active' ? 'bg-ok' : c.status === 'training' ? 'bg-accent' : 'bg-muted'}`} />
              <span className="truncate">{c.name}</span>
            </Link>
          ))}
          {!companies.length && <p className="px-2 text-xs text-muted">No clients yet.</p>}
        </nav>
        <div className="mt-4 border-t border-line pt-4 text-xs text-muted">
          <div className="truncate">{user.email}</div>
          <div className="truncate">{workspace.name}</div>
          <form action={signOutAction}>
            <button className="mt-2 flex items-center gap-1 hover:text-fg">
              <LogOut className="size-3.5" /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between border-b border-line px-4 py-3 md:hidden">
          <Link href="/dashboard" className="font-semibold">
            Marketing Agent
          </Link>
          <Link href="/approvals" className="text-sm text-muted">
            Approvals {pending > 0 && `(${pending})`}
          </Link>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8 md:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-muted hover:bg-panel-2 hover:text-fg">
      {icon}
      {children}
    </Link>
  );
}
