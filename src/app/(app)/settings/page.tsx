import { requireUser } from '@/lib/session';
import { env } from '@/env';
import { setAutopilotAction } from '@/app/actions';
import { SubmitButton } from '@/components/app/action-form';
import { SetupCheck } from '@/components/app/setup-check';
import { Card, CardTitle } from '@/components/ui/primitives';

export const metadata = { title: 'Settings' };

export default async function Settings() {
  const { workspace, role } = await requireUser();
  const e = env();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card>
        <CardTitle>Setup check</CardTitle>
        <p className="mb-4 text-sm text-muted">
          Tests every API key and service with a real (free or near-free) call and tells you exactly what to fix. Step numbers refer to{' '}
          <code>docs/04-setup-guide.md</code>.
        </p>
        <SetupCheck />
      </Card>
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
      {(e.MOCK_PROVIDERS || e.DISPATCH_MODE === 'inline') && (
        <Card>
          <CardTitle>Running modes</CardTitle>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {e.MOCK_PROVIDERS && <li>MOCK_PROVIDERS=true: every provider (including TikTok) is simulated and nothing is spent.</li>}
            {e.DISPATCH_MODE === 'inline' && <li>DISPATCH_MODE=inline: agents run inside the web server instead of n8n.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}
