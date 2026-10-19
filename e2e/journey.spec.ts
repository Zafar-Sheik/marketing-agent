import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

/**
 * The whole operator journey in a real browser against the real app
 * (offline providers): onboard a client, train, plan, approve, produce,
 * publish, buy ads, design a logo and get the monthly report.
 */
test.describe.configure({ mode: 'serial' });

let page: Page;
const shots = path.join('e2e', 'screenshots');
const shot = (name: string) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });

test.beforeAll(async ({ browser }) => {
  mkdirSync(shots, { recursive: true });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
});

test('signs in with the development login', async () => {
  await page.goto('/');
  await shot('01-landing');
  await page.getByRole('link', { name: 'Get started' }).click();
  await page.getByLabel(/Email/).fill('owner@agency.test');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('setup check tests every connection and explains what to fix', async () => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Run setup check' }).click();
  await expect(page.getByText(/\d+ working · \d+ to review · \d+ broken · \d+ not set up yet/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Anthropic (Claude)')).toBeVisible();
  await expect(page.getByText('ANTHROPIC_API_KEY is not set yet.')).toBeVisible();
  await shot('01b-setup-check');
});

test('creates a client through the wizard', async () => {
  await page.getByRole('link', { name: 'New client' }).first().click();
  await page.locator('input[name=name]').fill('Kauai Cafe');
  await page.locator('input[name=industry]').fill('Food & Beverage');
  await page.locator('input[name=websiteUrl]').fill('kauai.test');
  await page.locator('textarea[name=description]').fill('Healthy smoothies and wraps across South Africa.');
  await page.locator('input[name=country]').fill('ZA');
  await page.getByRole('button', { name: /Next: Brand identity/ }).click();
  await page.getByRole('button', { name: /Next: Voice/ }).click();
  await page.locator('input[name=toneOfVoice]').fill('Warm, playful, never pushy');
  await page.getByRole('button', { name: /Next: Budget/ }).click();
  await page.locator('input[name=currency]').fill('ZAR');
  await page.locator('input[name=budget]').fill('15000');
  await shot('02-new-client');
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(/\/companies\/kauai-cafe\/onboarding/);
});

test('uploads past work and trains the brand', async () => {
  const file = path.join('e2e', '.tmp-portfolio.png');
  writeFileSync(file, png());
  await page.locator('input[type=file]').first().setInputFiles(file);
  await expect(page.locator('ul img').first()).toBeVisible();
  await shot('03-onboarding');
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(page).toHaveURL(/\/companies\/kauai-cafe$/);
  await expect(page.getByText('Set this month’s goals')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('link', { name: 'Brand', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Brand bible v2/ })).toBeVisible();
  await expect(page.getByText('#0F766E').first()).toBeVisible();
  await shot('04-brand');
});

test('sets goals, gets research and a plan, and approves it', async () => {
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await page.locator('textarea[name=prompt]').fill('Launch the summer menu and grow followers by 20%. Push the Friday smoothie deal.');
  await page.locator('textarea[name=kpis]').fill('followers: 20%');
  await page.getByRole('button', { name: 'Research & plan' }).click();
  await expect(page.getByText('Approve this plan?')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Market research')).toBeVisible();
  await expect(page.getByText('Calendar')).toBeVisible();
  await shot('05-plan');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText('Approve this plan?')).toBeHidden();
});

test('content is produced and brand-checked, then approved', async () => {
  await page.getByRole('link', { name: 'Content', exact: true }).click();
  await expect(page.getByText('in review').first()).toBeVisible({ timeout: 60_000 });
  await shot('06-content');
  await page.locator('a[href*="/creatives/"]').first().click();
  await expect(page.getByText('Ready for your review')).toBeVisible();
  await expect(page.getByText('Storyboard')).toBeVisible();
  await shot('07-creative');
  // Approve everything waiting from the inbox.
  await page.getByRole('link', { name: /Approvals/ }).first().click();
  await approveAll('Approve');
});

test('paid content becomes a spend proposal, launches after approval', async () => {
  await page.goto('/approvals');
  await expect(page.getByText('ad spend').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Audience:/).first()).toBeVisible();
  await shot('08-spend-approval');
  await approveAll('Approve spend');
  await page.goto('/companies/kauai-cafe/ads');
  // Every ad passes (mock) TikTok review and goes live; nothing is left in review.
  await eventually(async () => {
    await expect(page.locator('table').getByText('active', { exact: true })).toHaveCount(2, { timeout: 2_000 });
  });
  await expect(page.locator('table').getByText('in review', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sync & optimise now' }).click();
  await expect(page.getByText(/Last run/)).toBeVisible();
  await shot('09-ads');
});

test('organic posts are published', async () => {
  await page.goto('/companies/kauai-cafe/creatives?f=live');
  await eventually(async () => {
    expect(await page.locator('a[href*="/creatives/"]').getByText('published', { exact: true }).count()).toBeGreaterThanOrEqual(4);
  });
  await shot('09b-published');
});

test('designs logos and adopts one', async () => {
  await page.goto('/companies/kauai-cafe/logos');
  await page.locator('textarea[name=prompt]').fill('Modern premium wordmark that works as a TikTok avatar');
  await page.locator('input[name=count]').fill('3');
  await page.getByRole('button', { name: 'Design concepts' }).click();
  await expect(page.getByRole('button', { name: 'Use this logo' })).toHaveCount(3, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Use this logo' }).first().click();
  await expect(page.getByText('Selected · now the brand logo')).toBeVisible();
  await shot('10-logos');
});

test('produces the monthly report PDF', async () => {
  await page.goto('/companies/kauai-cafe/reports');
  await page.getByRole('button', { name: 'Generate report' }).click();
  await eventually(() => expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible({ timeout: 2_000 }));
  const href = await page.getByRole('link', { name: 'Download PDF' }).getAttribute('href');
  const res = await page.request.get(href!);
  expect(res.ok()).toBe(true);
  expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF');
  await shot('11-reports');
  await page.goto('/dashboard');
  await shot('12-dashboard');
});

/** Retry an assertion, reloading the page between attempts (agents work in the background). */
async function eventually(check: () => Promise<void>, timeoutMs = 90_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await check();
    } catch (e) {
      if (Date.now() > end) throw e;
      await page.waitForTimeout(2_000);
      await page.reload();
    }
  }
}

/** Approve everything with this button, including items that arrive while we work, until the inbox stays empty. */
async function approveAll(label: string) {
  let quiet = 0;
  for (let i = 0; i < 80 && quiet < 3; i++) {
    const button = page.getByRole('button', { name: label, exact: true }).first();
    if (await button.isVisible().catch(() => false)) {
      quiet = 0;
      await button.click({ timeout: 60_000 });
      // Wait for the server action to finish (its form button is disabled while pending).
      await expect(page.locator('button[disabled]')).toHaveCount(0, { timeout: 60_000 });
    } else {
      quiet++;
      await page.waitForTimeout(2_000);
      await page.reload();
    }
  }
}

function png() {
  const w = 64;
  const h = 64;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([15, 118, 110], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const chunk = (t: string, d: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(d.length);
    const body = Buffer.concat([Buffer.from(t), d]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
