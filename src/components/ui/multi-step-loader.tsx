'use client';
import { motion } from 'motion/react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';

/** Aceternity "Multi Step Loader", driven by real run progress. */
export function MultiStepLoader({ steps, current, failed }: { steps: { key: string; label: string }[]; current: number; failed?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {steps.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <motion.div
            key={s.key}
            className="flex items-center gap-3 text-sm"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: done || active ? 1 : 0.4, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            {done ? (
              <CheckCircle2 className="size-5 text-ok" />
            ) : active && !failed ? (
              <Loader2 className="size-5 animate-spin text-accent" />
            ) : (
              <Circle className={failed && active ? 'size-5 text-bad' : 'size-5 text-muted'} />
            )}
            <span className={active ? 'text-fg' : 'text-muted'}>{s.label}</span>
          </motion.div>
        );
      })}
    </div>
  );
}
