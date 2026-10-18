import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { pendingApprovals } from '@/lib/queries';
import { ApprovalList } from '@/components/app/approval-list';
import { Empty } from '@/components/ui/primitives';

export const metadata = { title: 'Approvals' };

export default async function Approvals() {
  const { db, workspace } = await requireUser();
  const items = await pendingApprovals(db, workspace.id);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approvals</h1>
        <p className="text-sm text-muted">Everything that would spend money or go public waits here. Turn on autopilot in <Link href="/settings" className="underline">settings</Link> to let agents approve within guardrails.</p>
      </div>
      {items.length ? <ApprovalList items={items} showCompany /> : <Empty title="You’re all caught up">New plans, content and ad spend will appear here for review.</Empty>}
    </div>
  );
}
