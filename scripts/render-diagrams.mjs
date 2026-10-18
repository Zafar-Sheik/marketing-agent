// Extracts every ```mermaid block from docs/*.md and renders it with the real
// Mermaid engine (headless Chromium). `--check` renders to a temp dir and only
// reports; without it, SVGs are written to docs/diagrams/ for viewers that
// don't render Mermaid natively.
import { readdir, readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '@mermaid-js/mermaid-cli';

const root = new URL('..', import.meta.url).pathname;
const docsDir = join(root, 'docs');
const check = process.argv.includes('--check');
const outDir = check ? await mkdtemp(join(tmpdir(), 'diagrams-')) : join(docsDir, 'diagrams');
await mkdir(outDir, { recursive: true });

const chromium = ['/opt/pw-browsers/chromium', process.env.PUPPETEER_EXECUTABLE_PATH]
  .filter(Boolean)
  .map((p) => (p.endsWith('chromium') && existsSync(join(p, 'chrome-linux/chrome')) ? join(p, 'chrome-linux/chrome') : p))
  .find((p) => existsSync(p));
const puppeteerConfig = { args: ['--no-sandbox'], ...(chromium ? { executablePath: chromium } : {}) };

export function extractMermaid(markdown) {
  return [...markdown.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
}

const files = (await readdir(docsDir)).filter((f) => f.endsWith('.md')).sort();
let ok = 0;
const failures = [];
for (const file of files) {
  const blocks = extractMermaid(await readFile(join(docsDir, file), 'utf8'));
  for (const [i, src] of blocks.entries()) {
    const name = `${basename(file, '.md')}-${i + 1}`;
    const input = join(outDir, `${name}.mmd`);
    await writeFile(input, src);
    try {
      await run(input, join(outDir, `${name}.svg`), { puppeteerConfig, quiet: true });
      if (!check) await rm(input);
      ok++;
      console.log(`  ok  ${name}`);
    } catch (err) {
      failures.push(name);
      console.error(`  FAIL ${name}\n${String(err.message ?? err).split('\n').slice(0, 8).join('\n')}`);
    }
  }
}
if (check) await rm(outDir, { recursive: true, force: true });
console.log(`\n${ok} diagram(s) rendered, ${failures.length} failed.`);
if (failures.length || ok === 0) process.exit(1);
