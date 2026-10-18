'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/cn';

/** Aceternity "Card Hover Effect": a highlight glides between cards. */
export function HoverCardGrid({
  items,
  className,
}: {
  items: { href: string; title: React.ReactNode; description: React.ReactNode; footer?: React.ReactNode; key: string }[];
  className?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3', className)}>
      {items.map((item, idx) => (
        <Link key={item.key} href={item.href} className="group relative block h-full w-full p-2" onMouseEnter={() => setHovered(idx)} onMouseLeave={() => setHovered(null)}>
          <AnimatePresence>
            {hovered === idx && (
              <motion.span
                className="absolute inset-0 block h-full w-full rounded-2xl bg-accent/10"
                layoutId="hoverBackground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: 0.15 } }}
                exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.2 } }}
              />
            )}
          </AnimatePresence>
          <div className="relative z-10 h-full overflow-hidden rounded-xl border border-line bg-panel p-5 group-hover:border-accent/40">
            <div className="font-semibold text-fg">{item.title}</div>
            <div className="mt-2 text-sm leading-6 text-muted">{item.description}</div>
            {item.footer && <div className="mt-4">{item.footer}</div>}
          </div>
        </Link>
      ))}
    </div>
  );
}
