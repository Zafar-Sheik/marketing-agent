import { and, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { ApprovalSubject } from '@/db/schema';

type Decision = 'approved' | 'rejected' | 'changes_requested';

/**
 * Open an approval for something that spends money or goes public. With workspace
 * autopilot on, it is approved immediately (and still recorded).
 */
export async function requestApproval(
  db: Db,
  input: { companyId: string; subjectType: ApprovalSubject; subjectId: string; comment?: string },
) {
  const [existing] = await db
    .select()
    .from(schema.approvals)
    .where(
      and(
        eq(schema.approvals.subjectType, input.subjectType),
        eq(schema.approvals.subjectId, input.subjectId),
        eq(schema.approvals.decision, 'pending'),
      ),
    );
  if (existing) return existing;
  const [approval] = await db.insert(schema.approvals).values(input).returning();
  const [row] = await db
    .select({ autopilot: schema.workspaces.autopilot })
    .from(schema.companies)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.companies.workspaceId))
    .where(eq(schema.companies.id, input.companyId));
  if (row?.autopilot) {
    await decide(db, approval.id, null, 'approved', 'Auto-approved (autopilot).');
  }
  return approval;
}

/** Record a decision and move the subject to its next stage. */
export async function decide(db: Db, approvalId: string, userId: string | null, decision: Decision, comment?: string) {
  const [approval] = await db.select().from(schema.approvals).where(eq(schema.approvals.id, approvalId));
  if (!approval) throw new Error('Approval not found');
  if (approval.decision !== 'pending') throw new Error('This approval was already decided.');
  await db
    .update(schema.approvals)
    .set({ decision, comment, decidedBy: userId, decidedAt: new Date() })
    .where(eq(schema.approvals.id, approvalId));

  const { onPlanDecision, onCreativeDecision, onCampaignDecision } = await import('./transitions');
  switch (approval.subjectType) {
    case 'marketing_plan':
      return onPlanDecision(db, approval.subjectId, userId, decision, comment);
    case 'creative':
      return onCreativeDecision(db, approval.subjectId, decision, comment);
    case 'ad_campaign':
      return onCampaignDecision(db, approval.subjectId, decision, comment);
    case 'logo_request':
      return;
  }
}
