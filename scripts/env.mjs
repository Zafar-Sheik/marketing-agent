// `node scripts/env.mjs setup` : create .env from .env.example with generated secrets
// `node scripts/env.mjs check`  : list keys in .env that still need a value
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const PLACEHOLDER = 'replace-me';
export const GENERATE = '__GENERATE__';

export function parseEnv(text) {
  const entries = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) entries.set(m[1], m[2]);
  }
  return entries;
}

export function fillSecrets(text) {
  return text.replace(new RegExp(`=${GENERATE}$`, 'gm'), () => `=${randomBytes(32).toString('hex')}`);
}

// Keys that are missing, empty, or still placeholders.
export function missingKeys(exampleText, envText) {
  const example = parseEnv(exampleText);
  const env = parseEnv(envText);
  return [...example.keys()].filter((key) => {
    const value = env.get(key);
    return value === undefined || value === '' || value === PLACEHOLDER || value === GENERATE;
  });
}

function main([command, dir = '.']) {
  const examplePath = `${dir}/.env.example`;
  const envPath = `${dir}/.env`;
  const example = readFileSync(examplePath, 'utf8');
  if (command === 'setup') {
    if (existsSync(envPath)) {
      console.log('.env already exists — left untouched. Run `npm run env:check` to see what is missing.');
      return 0;
    }
    writeFileSync(envPath, fillSecrets(example), { mode: 0o600 });
    console.log('Created .env with generated secrets. Now paste your API keys over each `replace-me`.');
    return 0;
  }
  if (command === 'check') {
    if (!existsSync(envPath)) {
      console.error('No .env yet — run `npm run env:setup` first.');
      return 1;
    }
    const missing = missingKeys(example, readFileSync(envPath, 'utf8'));
    if (missing.length) {
      console.error(`${missing.length} key(s) still need a value:\n  ${missing.join('\n  ')}`);
      return 1;
    }
    console.log('All environment variables are set.');
    return 0;
  }
  console.error('Usage: node scripts/env.mjs <setup|check>');
  return 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
