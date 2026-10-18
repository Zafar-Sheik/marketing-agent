import { decideAction } from '@/app/actions';
import { SubmitButton } from './action-form';

/** Approve / request changes / reject for one pending approval. */
export function ApprovalButtons({ approvalId, allowChanges = true, approveLabel = 'Approve' }: { approvalId: string; allowChanges?: boolean; approveLabel?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <form action={decideAction.bind(null, approvalId, 'approved')}>
          <SubmitButton>{approveLabel}</SubmitButton>
        </form>
        <form action={decideAction.bind(null, approvalId, 'rejected')}>
          <SubmitButton variant="danger">Reject</SubmitButton>
        </form>
      </div>
      {allowChanges && (
        <form action={decideAction.bind(null, approvalId, 'changes_requested')} className="flex gap-2">
          <input name="comment" required placeholder="What should change?" className="field" />
          <SubmitButton variant="ghost">Request changes</SubmitButton>
        </form>
      )}
    </div>
  );
}
