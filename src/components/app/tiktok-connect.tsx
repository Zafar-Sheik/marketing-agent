import { env } from '@/env';
import { Badge, LinkButton } from '@/components/ui/primitives';
import type { schema } from '@/db';

type Connection = typeof schema.tiktokConnections.$inferSelect | undefined;

/** Connect buttons for Ads Manager and the posting account. */
export function TikTokConnect({ companyId, connection }: { companyId: string; connection: Connection }) {
  const e = env();
  const rows = [
    {
      kind: 'ads',
      title: 'TikTok Ads Manager',
      body: 'Lets the agents create campaigns, set budgets and audiences, and read results.',
      connected: Boolean(connection?.adsAccessTokenEnc),
      detail: connection?.advertiserId ? `Advertiser ${connection.advertiserId}` : undefined,
      configured: Boolean(e.TIKTOK_ADS_APP_ID),
    },
    {
      kind: 'posting',
      title: 'TikTok account (organic posts)',
      body: 'Lets the agents publish posts on schedule and read view counts.',
      connected: Boolean(connection?.postingAccessTokenEnc),
      detail: connection?.businessOpenId ? 'Account connected' : undefined,
      configured: Boolean(e.TIKTOK_CLIENT_KEY),
    },
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rows.map((r) => (
        <div key={r.kind} className="rounded-xl border border-line p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{r.title}</span>
            {r.connected ? <Badge status={connection?.status ?? 'connected'} /> : <Badge status="draft">not connected</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">{r.body}</p>
          {r.detail && <p className="mt-1 text-xs text-muted">{r.detail}</p>}
          <div className="mt-3">
            {e.MOCK_PROVIDERS ? (
              <p className="text-xs text-muted">Simulated while MOCK_PROVIDERS=true.</p>
            ) : r.configured ? (
              <LinkButton href={`/api/tiktok/connect?company=${companyId}&kind=${r.kind}`} variant="ghost">
                {r.connected ? 'Reconnect' : 'Connect'}
              </LinkButton>
            ) : (
              <p className="text-xs text-muted">Add {r.kind === 'ads' ? 'TIKTOK_ADS_APP_ID / SECRET' : 'TIKTOK_CLIENT_KEY / SECRET'} to .env first.</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
