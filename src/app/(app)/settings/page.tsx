import { requireUser } from '@/lib/session';
import { env } from '@/env';
import { setAutopilotAction } from '@/app/actions';
import { SubmitButton } from '@/components/app/action-form';
import { Card, CardTitle } from '@/components/ui/primitives';

export const metadata = { title: 'Settings' };

const KEYS = [
  ['Anthropic (strategy, copy, QA)', 'ANTHROPIC_API_KEY'],
  ['OpenAI (embeddings, images)', 'OPENAI_API_KEY'],
  ['Runway (video)', 'RUNWAY_API_KEY'],
  ['ElevenLabs (voice)', 'ELEVENLABS_API_KEY'],
  ['Creatomate (editing)', 'CREATOMATE_API_KEY'],
  ['Tavily (research)', 'TAVILY_API_KEY'],
  ['TikTok Ads (Marketing API)', 'TIKTOK_ADS_APP_ID'],
  ['TikTok posting (Content Posting API)', 'TIKTOK_CLIENT_KEY'],
  ['AWS S3', 'AWS_ACCESS_KEY_ID'],
  ['Resend (email)', 'RESEND_API_KEY'],
  ['n8n', 'N8N_WEBHOOK_SECRET'],
] as const;

export default async function Settings() {
  const { workspace, role } = await requireUser();
  const e = env();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardTitle>Autopilot</CardTitle>
        <form action={setAutopilotAction} className="space-y-4">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="autopilot" defaultChecked={workspace.autopilot} disabled={role !== 'owner' && role !== 'admin'} className="mt-1 size-4 accent-[#7c5cff]" />
            <span>
              Let agents approve their own plans, content and ad spend.
              <span className="block text-muted">
                Guardrails still apply: spend never exceeds each client’s monthly budget, daily budget increases above {e.MAX_DAILY_BUDGET_CHANGE_PCT}% still need you, and content scoring under {Math.round(e.BRAND_SCORE_THRESHOLD * 100)}% on brand review is remade.
              </span>
            </span>
          </label>
          <SubmitButton variant="ghost">Save</SubmitButton>
        </form>
      </Card>
      <Card>
        <CardTitle>Integrations</CardTitle>
        <p className="mb-4 text-sm text-muted">
          Keys live in <code>.env</code>. Run <code>npm run env:check</code> to list what is missing.
          {e.MOCK_PROVIDERS && ' MOCK_PROVIDERS is on: every provider (including TikTok) is simulated and nothing is spent.'}
          {e.DISPATCH_MODE === 'inline' && ' DISPATCH_MODE=inline: agents run inside the web server instead of n8n.'}
        </p>
        <ul className="grid gap-2 text-sm md:grid-cols-2">
          {KEYS.map(([label, key]) => (
            <li key={key} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
              <span>{label}</span>
              <span className={e[key] ? 'text-ok' : 'text-muted'}>{e[key] ? 'configured' : 'missing'}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
