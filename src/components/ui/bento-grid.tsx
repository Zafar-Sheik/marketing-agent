import { cn } from '@/lib/cn';

/** Aceternity "Bento Grid". */
export function BentoGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('mx-auto grid grid-cols-1 gap-4 md:auto-rows-[13rem] md:grid-cols-3', className)}>{children}</div>;
}

export function BentoGridItem({
  className,
  title,
  description,
  header,
  icon,
}: {
  className?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  header?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'group/bento row-span-1 flex flex-col justify-between gap-3 rounded-xl border border-line bg-panel p-4 transition duration-200 hover:border-accent/50 hover:shadow-xl hover:shadow-accent/5',
        className,
      )}
    >
      {header}
      <div className="transition duration-200 group-hover/bento:translate-x-1">
        {icon}
        <div className="mt-2 mb-1 font-semibold text-fg">{title}</div>
        <div className="text-xs leading-5 text-muted">{description}</div>
      </div>
    </div>
  );
}
