import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowRight, BarChart3, Bot, Clapperboard, Megaphone, Palette, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { auth } from '@/auth';
import { Spotlight } from '@/components/ui/spotlight';
import { BentoGrid, BentoGridItem } from '@/components/ui/bento-grid';
import { LinkButton } from '@/components/ui/primitives';

export const dynamic = 'force-dynamic';

const STEPS = [
  { icon: Palette, title: 'Learns every brand', description: 'Colours, voice, past work and website become a brand bible every agent follows.', points: ['Brand colours & fonts', 'Tone of voice', 'Portfolio captions'] },
  { icon: Search, title: 'Researches the market', description: 'Trends, sounds, competitors and audiences, with sources, every month.', points: ['TikTok trends', 'Competitor moves', 'Audience segments'] },
  { icon: Sparkles, title: 'Plans the month', description: 'Strategy, content pillars and a dated calendar inside the budget. Revised on your feedback.', points: ['Content calendar', 'Budget split', 'Your weekly asks'] },
  { icon: Clapperboard, title: 'Makes the content', description: 'Scripts, scenes, video, voice-over and on-brand edits, checked against the brand before you see them.', points: ['Short videos', 'Carousels', 'Logos on request'] },
  { icon: Megaphone, title: 'Buys and posts', description: 'Budget and audience set in TikTok Ads Manager, organic posts published on schedule.', points: ['Ads created paused', 'Hard monthly cap', 'Daily optimisation'] },
  { icon: BarChart3, title: 'Reports back', description: 'A monthly PDF documenting every advert, logo, result and next step, emailed to you.', points: ['KPIs vs targets', 'Per-advert notes', 'Recommendations'] },
];

export default async function Landing() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');
  return (
    <main className="relative min-h-screen overflow-hidden grid-bg">
      <Spotlight className="-top-40 left-0 md:-top-20 md:left-60" fill="#7c5cff" />
      <header className="relative z-20 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent/20">
            <Bot className="size-4 text-accent" />
          </span>
          Marketing Agent
        </Link>
        <LinkButton href="/signin" variant="ghost">
          Sign in
        </LinkButton>
      </header>
      <div className="relative z-10 mx-auto max-w-6xl px-6 pt-16 pb-20">
        <p className="mb-4 inline-flex rounded-full border border-line bg-panel/80 px-3 py-1 text-xs text-muted">AI marketing team for TikTok</p>
        <h1 className="max-w-3xl bg-gradient-to-b from-white to-white/60 bg-clip-text text-5xl font-bold tracking-tight text-transparent md:text-7xl">
          Your clients’ TikTok, run end to end.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-muted">
          Add a client, tell it this month’s goals. It researches, plans, designs, edits, buys media and reports, and asks before it spends.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <LinkButton href="/signin">
            Get started <ArrowRight className="size-4" />
          </LinkButton>
          <span className="flex items-center gap-2 text-sm text-muted">
            <ShieldCheck className="size-4 text-ok" /> Nothing spends money or goes public without your approval
          </span>
        </div>
        <BentoGrid className="mt-20 md:auto-rows-auto">
          {STEPS.map(({ icon: Icon, title, description, points }, i) => (
            <BentoGridItem
              key={title}
              title={title}
              description={description}
              header={
                <div className="flex items-start justify-between">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-accent/15">
                    <Icon className="size-5 text-accent" />
                  </span>
                  <span className="font-mono text-xs text-muted">0{i + 1}</span>
                </div>
              }
              icon={
                <ul className="mb-3 flex flex-wrap gap-1.5">
                  {points.map((p) => (
                    <li key={p} className="rounded-full border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-muted">
                      {p}
                    </li>
                  ))}
                </ul>
              }
            />
          ))}
        </BentoGrid>
      </div>
    </main>
  );
}
