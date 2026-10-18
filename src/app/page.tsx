import { redirect } from 'next/navigation';
import { BarChart3, Clapperboard, Megaphone, Palette, Search, Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { Spotlight } from '@/components/ui/spotlight';
import { BentoGrid, BentoGridItem } from '@/components/ui/bento-grid';
import { LinkButton } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

const FEATURES = [
  { icon: Palette, title: 'Learns every brand', description: 'Colours, voice, portfolio and website become a brand bible every agent follows.' },
  { icon: Search, title: 'Researches the market', description: 'Trends, sounds, competitors and audiences, cited, every month.' },
  { icon: Sparkles, title: 'Plans the month', description: 'Pillars, calendar and budget split from your goals, revised on your feedback.' },
  { icon: Clapperboard, title: 'Makes the content', description: 'Scripts, key frames, video, voice-over and branded edits, brand-checked before you see them.' },
  { icon: Megaphone, title: 'Buys and posts', description: 'Budgets and audiences in TikTok Ads Manager, organic posts on schedule, guarded by approvals.' },
  { icon: BarChart3, title: 'Reports back', description: 'Daily optimisation and a monthly PDF documenting every advert, logo and finding.' },
];

export default async function Landing() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');
  return (
    <main className="relative min-h-screen overflow-hidden grid-bg">
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="#7c5cff" />
      <div className="relative z-10 mx-auto max-w-6xl px-6 pt-28 pb-20">
        <p className="mb-4 inline-flex rounded-full border border-line bg-panel/80 px-3 py-1 text-xs text-muted">AI marketing team for TikTok</p>
        <h1 className="max-w-3xl bg-gradient-to-b from-white to-white/60 bg-clip-text text-5xl font-bold tracking-tight text-transparent md:text-7xl">
          Your clients’ TikTok, run end to end.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Add a client, tell it this month’s goals. It researches, plans, designs, edits, buys media and reports — and asks before it spends.
        </p>
        <div className="mt-8 flex gap-3">
          <LinkButton href="/signin">Get started</LinkButton>
          <LinkButton href="https://github.com/zafar-sheik/marketing-agent" variant="ghost">
            Docs
          </LinkButton>
        </div>
        <BentoGrid className="mt-20">
          {FEATURES.map(({ icon: Icon, title, description }, i) => (
            <BentoGridItem
              key={title}
              className={i === 0 || i === 3 ? 'md:col-span-2' : ''}
              title={title}
              description={description}
              icon={<Icon className="size-5 text-accent" />}
              header={<div className="h-full min-h-16 rounded-lg bg-gradient-to-br from-accent/20 via-panel-2 to-accent-2/10" />}
            />
          ))}
        </BentoGrid>
      </div>
    </main>
  );
}
