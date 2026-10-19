'use client';
import { useActionState } from 'react';
import { CheckCircle2, CircleDashed, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { runSetupChecksAction } from '@/app/actions';
import { Button } from '@/components/ui/primitives';

const ICONS = {
  ok: <CheckCircle2 className="size-5 shrink-0 text-ok" />,
  warn: <AlertTriangle className="size-5 shrink-0 text-warn" />,
  fail: <XCircle className="size-5 shrink-0 text-bad" />,
  skip: <CircleDashed className="size-5 shrink-0 text-muted" />,
};

/** One button that tests every key with a real call and says what to fix. */
export function SetupCheck() {
  const [state, run, pending] = useActionState(runSetupChecksAction, undefined);
  const results = state?.results ?? [];
  const counts = { ok: 0, warn: 0, fail: 0, skip: 0 };
  results.forEach((r) => counts[r.status]++);
  return (
    <div className="space-y-4">
      <form action={run} className="flex flex-wrap items-center gap-3">
        <Button disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {pending ? 'Testing every connection…' : results.length ? 'Run again' : 'Run setup check'}
        </Button>
        {results.length > 0 && (
          <span className="text-sm text-muted">
            {counts.ok} working · {counts.warn} to review · {counts.fail} broken · {counts.skip} not set up yet
          </span>
        )}
      </form>
      {state?.error && <p className="text-sm text-bad">{state.error}</p>}
      {results.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {results.map((r) => (
            <li key={r.id} className="flex gap-3 p-3 text-sm">
              {ICONS[r.status]}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-muted">Setup guide {r.guide}</span>
                </div>
                <p className="text-muted">{r.message}</p>
                {r.fix && r.status !== 'ok' && <p className="mt-1">→ {r.fix}</p>}
                {r.fix && r.status === 'ok' && <p className="mt-1 text-xs text-muted">{r.fix}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
