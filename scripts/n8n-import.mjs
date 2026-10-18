// Create or update the n8n workflows from n8n/*.json and activate them.
// Needs N8N_BASE_URL and N8N_API_KEY (n8n > Settings > n8n API).
import { readFileSync, readdirSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
const base = (process.env.N8N_BASE_URL ?? 'http://localhost:5678').replace(/\/$/, '');
const key = process.env.N8N_API_KEY;
if (!key || key === 'replace-me') {
  console.error('Set N8N_API_KEY in .env (n8n > Settings > n8n API > Create an API key).');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(`${base}/api/v1${path}`, {
    method,
    headers: { 'X-N8N-API-KEY': key, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

// --cloud imports the n8n Cloud copies, which read settings from n8n Variables.
const dir = process.argv.includes('--cloud') ? 'n8n/cloud' : 'n8n';
const existing = (await api('GET', '/workflows?limit=250')).data ?? [];
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const { name, nodes, connections, settings } = JSON.parse(readFileSync(`${dir}/${file}`, 'utf8'));
  const found = existing.find((w) => w.name === name);
  const payload = { name, nodes, connections, settings };
  const wf = found ? await api('PUT', `/workflows/${found.id}`, payload) : await api('POST', '/workflows', payload);
  // n8n 2.x publishes; 1.x activates.
  await api('POST', `/workflows/${wf.id}/publish`).catch(() => api('POST', `/workflows/${wf.id}/activate`));
  console.log(`${found ? 'updated' : 'created'} and activated: ${name}`);
}
console.log('\nSet DISPATCH_MODE=n8n in .env so the app hands jobs to n8n.');
