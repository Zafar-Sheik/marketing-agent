'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const TABS = [
  ['', 'Overview'],
  ['/plan', 'Plan'],
  ['/requests', 'Requests'],
  ['/creatives', 'Content'],
  ['/ads', 'Ads'],
  ['/logos', 'Logos'],
  ['/reports', 'Reports'],
  ['/brand', 'Brand'],
  ['/settings', 'Settings'],
] as const;

export function CompanyTabs({ slug }: { slug: string }) {
  const path = usePathname();
  const base = `/companies/${slug}`;
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-line text-sm">
      {TABS.map(([href, label]) => {
        const full = base + href;
        const active = href === '' ? path === base : path.startsWith(full);
        return (
          <Link key={href} href={full} className={cn('whitespace-nowrap border-b-2 px-3 py-2', active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
