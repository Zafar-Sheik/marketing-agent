'use client';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import type { ActionState } from '@/app/actions';

export function ActionForm({
  action,
  children,
  submit,
  className,
}: {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children: React.ReactNode;
  submit: string;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className ?? 'flex flex-col gap-4'}>
      {children}
      {state?.error && <p className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{state.error}</p>}
      {state?.ok && <p className="rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-sm text-ok">{state.ok}</p>}
      <div>
        <SubmitButton>{submit}</SubmitButton>
      </div>
    </form>
  );
}

export function SubmitButton({ children, variant }: { children: React.ReactNode; variant?: 'primary' | 'ghost' | 'danger' }) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} variant={variant}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </Button>
  );
}
