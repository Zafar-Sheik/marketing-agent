import Link from 'next/link';
import { cn } from '@/lib/cn';

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn('rounded-xl border border-line bg-panel p-5', className)}>{children}</section>;
}

export function CardTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-fg">{children}</h2>
      {action}
    </div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' };
const buttonStyles = {
  primary:
    'bg-[linear-gradient(110deg,#7c5cff,45%,#a48bff,55%,#7c5cff)] bg-[length:200%_100%] text-white hover:animate-shimmer shadow-lg shadow-accent/20',
  ghost: 'border border-line bg-panel-2 text-fg hover:border-accent/60',
  danger: 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
};

export function Button({ variant = 'primary', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        buttonStyles[variant],
        className,
      )}
    />
  );
}

export function LinkButton({ href, variant = 'primary', className, children }: { href: string; variant?: ButtonProps['variant']; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn('inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition', buttonStyles[variant], className)}>
      {children}
    </Link>
  );
}

const tones: Record<string, string> = {
  ok: 'bg-ok/10 text-ok border-ok/30',
  warn: 'bg-warn/10 text-warn border-warn/30',
  bad: 'bg-bad/10 text-bad border-bad/30',
  info: 'bg-accent/10 text-accent border-accent/30',
  muted: 'bg-panel-2 text-muted border-line',
};

const statusTone: Record<string, keyof typeof tones> = {
  active: 'ok', approved: 'ok', published: 'ok', succeeded: 'ok', delivered: 'ok', connected: 'ok', completed: 'muted',
  pending_approval: 'warn', in_review: 'warn', pending: 'warn', training: 'info', generating: 'info', running: 'info', queued: 'info',
  scheduled: 'info', submitted: 'info', in_production: 'info', publishing: 'info', planned: 'info',
  failed: 'bad', rejected: 'bad', expired: 'bad', changes_requested: 'warn', draft: 'muted', paused: 'muted',
};

export function Badge({ status, children }: { status?: string; children?: React.ReactNode }) {
  const tone = tones[statusTone[status ?? ''] ?? 'muted'];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize', tone)}>
      {children ?? status?.replace(/_/g, ' ')}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-8 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Swatch({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted">
      <span className="size-5 rounded-md border border-white/10" style={{ background: color }} />
      {color}
    </span>
  );
}
