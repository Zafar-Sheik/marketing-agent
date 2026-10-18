'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MultiStepLoader } from '@/components/ui/multi-step-loader';

/** Re-render the server page every few seconds while agents are working. */
export function AutoRefresh({ active, seconds = 4 }: { active: boolean; seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [active, seconds, router]);
  return null;
}

/** Live progress of one agent run, mapped onto human-readable steps. */
export function RunProgress({ runId, steps }: { runId: string; steps: { key: string; label: string }[] }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: string; step: string | null; error: string | null }>({ status: 'queued', step: null, error: null });
  useEffect(() => {
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/runs/${runId}`);
      if (res.ok) {
        const s = await res.json();
        setState(s);
        if (s.status === 'succeeded' || s.status === 'failed') {
          router.refresh();
          return;
        }
      }
      if (!stop) setTimeout(poll, 2500);
    }
    void poll();
    return () => {
      stop = true;
    };
  }, [runId, router]);
  const index = state.status === 'succeeded' ? steps.length : Math.max(0, steps.findIndex((s) => s.key === state.step));
  return (
    <div>
      <MultiStepLoader steps={steps} current={index} failed={state.status === 'failed'} />
      {state.error && <p className="mt-3 text-sm text-bad">{state.error}</p>}
    </div>
  );
}
