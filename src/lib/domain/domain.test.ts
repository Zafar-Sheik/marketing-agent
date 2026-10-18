import { describe, it, expect } from 'vitest';
import { calculatePlacementBudget, fitPlannedSpend, assertWithinMonthCap, BudgetCapError, allocateByObjective } from './budget';
import { splitByShares, parseMoneyToCents } from './money';
import { applyGuardrails } from './guardrails';
import { toTikTokTargeting, ageGroupsForRange, SensitiveTargetingError, type AudienceSegment } from './targeting';
import { chunkText, slugify, normalizeHex, contrastRatio, readableTextOn } from './text';
import { monthStart, daysInMonth, weekStart, daysRemainingInMonth, monthEnd, nextMonth, parseIsoDate } from './dates';

describe('money', () => {
  it('splits exactly to the cent', () => {
    const r = splitByShares(1001, { a: 1, b: 1, c: 1 });
    expect(Object.values(r).reduce((s, v) => s + v, 0)).toBe(1001);
    expect(Math.max(...Object.values(r)) - Math.min(...Object.values(r))).toBeLessThanOrEqual(1);
  });
  it('ignores zero/negative weights', () => {
    expect(splitByShares(100, { a: 0, b: 3, c: -1 })).toEqual({ a: 0, b: 100, c: 0 });
  });
  it('parses user amounts', () => {
    expect(parseMoneyToCents('R15,000.50')).toBe(1_500_050);
    expect(() => parseMoneyToCents('abc')).toThrow();
  });
  it('allocates monthly budget by objective', () => {
    const r = allocateByObjective(1_500_000, { awareness: 0.4, traffic: 0.35, conversions: 0.25 });
    expect(r).toEqual({ awareness: 600_000, traffic: 525_000, conversions: 375_000 });
  });
});

describe('placement budget', () => {
  it('paces the planned spend over the flight', () => {
    const r = calculatePlacementBudget({ monthBudgetCents: 100_000, committedCents: 0, plannedSpendCents: 30_000, flightDays: 10 });
    expect(r).toEqual({ ok: true, budgetCents: 30_000, dailyBudgetCents: 3_000, flightDays: 10, cappedByRemaining: false });
  });
  it('never exceeds what is left of the month', () => {
    const r = calculatePlacementBudget({ monthBudgetCents: 100_000, committedCents: 90_000, plannedSpendCents: 30_000, flightDays: 5 });
    expect(r.ok && r.budgetCents).toBe(10_000);
    expect(r.ok && r.cappedByRemaining).toBe(true);
  });
  it('shortens the flight instead of going under the daily minimum', () => {
    const r = calculatePlacementBudget({ monthBudgetCents: 10_000, committedCents: 0, plannedSpendCents: 10_000, flightDays: 30, minDailyCents: 2_000 });
    expect(r).toMatchObject({ ok: true, flightDays: 5, dailyBudgetCents: 2_000 });
  });
  it('refuses when the month is spent', () => {
    const r = calculatePlacementBudget({ monthBudgetCents: 10_000, committedCents: 10_000, plannedSpendCents: 5_000, flightDays: 3 });
    expect(r.ok).toBe(false);
  });
  it('refuses when below one day of minimum', () => {
    const r = calculatePlacementBudget({ monthBudgetCents: 1_000, committedCents: 0, plannedSpendCents: 1_000, flightDays: 3, minDailyCents: 2_000 });
    expect(r.ok).toBe(false);
  });
  it('scales an overspent plan to the cap and zeroes organic spend', () => {
    const items = [
      { isPaid: true, plannedSpendCents: 60_000 },
      { isPaid: true, plannedSpendCents: 60_000 },
      { isPaid: false, plannedSpendCents: 5_000 },
    ];
    const fitted = fitPlannedSpend(items, 100_000);
    expect(fitted.map((i) => i.plannedSpendCents)).toEqual([50_000, 50_000, 0]);
  });
  it('enforces the month cap', () => {
    expect(() => assertWithinMonthCap(100, [60, 50])).toThrow(BudgetCapError);
    expect(() => assertWithinMonthCap(100, [60, 40])).not.toThrow();
  });
});

describe('guardrails', () => {
  const ctx = { currentDailyBudgets: { g1: 1_000, g2: 1_000 }, maxChangePct: 30, remainingMonthCents: 100_000, daysLeft: 10, autopilot: false };
  it('auto-applies small changes and decreases, asks for big increases', () => {
    const r = applyGuardrails(
      [
        { type: 'set_daily_budget', adGroupId: 'g1', dailyBudgetCents: 1_200, reason: 'winner' },
        { type: 'set_daily_budget', adGroupId: 'g2', dailyBudgetCents: 500, reason: 'loser' },
        { type: 'pause_ad', adId: 'a1', reason: 'CTR too low' },
      ],
      ctx,
    );
    expect(r.autoApply).toHaveLength(3);
    const big = applyGuardrails([{ type: 'set_daily_budget', adGroupId: 'g1', dailyBudgetCents: 2_000, reason: 'x' }], ctx);
    expect(big.needsApproval).toHaveLength(1);
  });
  it('rejects anything that would overspend the month, even on autopilot', () => {
    const r = applyGuardrails([{ type: 'set_daily_budget', adGroupId: 'g1', dailyBudgetCents: 20_000, reason: 'x' }], { ...ctx, autopilot: true });
    expect(r.rejected).toHaveLength(1);
  });
  it('needs approval to re-enable ads unless autopilot', () => {
    expect(applyGuardrails([{ type: 'enable_ad', adId: 'a', reason: '' }], ctx).needsApproval).toHaveLength(1);
    expect(applyGuardrails([{ type: 'enable_ad', adId: 'a', reason: '' }], { ...ctx, autopilot: true }).autoApply).toHaveLength(1);
  });
});

describe('targeting', () => {
  const base: AudienceSegment = {
    name: 'Young urban foodies',
    ageGroups: ['AGE_18_24', 'AGE_25_34'],
    genders: ['GENDER_FEMALE'],
    locationIds: ['953987'],
    languages: ['en'],
    interestCategoryIds: ['14'],
    actionCategoryIds: ['77'],
    hashtagIds: [],
    interestLabels: ['Food & drink', 'Restaurants'],
    rationale: 'Top engagement',
  };
  it('builds the TikTok payload', () => {
    const t = toTikTokTargeting(base);
    expect(t).toMatchObject({ location_ids: ['953987'], age_groups: ['AGE_18_24', 'AGE_25_34'], gender: 'GENDER_FEMALE', interest_category_ids: ['14'] });
    expect(t.actions?.[0]).toMatchObject({ action_scene: 'VIDEO_RELATED', action_category_ids: ['77'] });
  });
  it('collapses mixed genders to unlimited', () => {
    expect(toTikTokTargeting({ ...base, genders: ['GENDER_MALE', 'GENDER_FEMALE'] }).gender).toBe('GENDER_UNLIMITED');
  });
  it('refuses religion and other sensitive targeting', () => {
    expect(() => toTikTokTargeting({ ...base, interestLabels: ['Muslim community'] })).toThrow(SensitiveTargetingError);
    expect(() => toTikTokTargeting({ ...base, name: 'Religious families' })).toThrow(SensitiveTargetingError);
  });
  it('does not false-positive on similar words', () => {
    expect(() => toTikTokTargeting({ ...base, interestLabels: ['Motor racing', 'Embrace change'] })).not.toThrow();
  });
  it('rejects minors and malformed ids', () => {
    expect(() => toTikTokTargeting({ ...base, ageGroups: ['AGE_13_17' as never] })).toThrow();
    expect(() => toTikTokTargeting({ ...base, locationIds: ['Cape Town'] })).toThrow();
    expect(ageGroupsForRange(13, 30)).toEqual(['AGE_18_24', 'AGE_25_34']);
    expect(ageGroupsForRange(40, 70)).toEqual(['AGE_35_44', 'AGE_45_54', 'AGE_55_100']);
  });
});

describe('text', () => {
  it('chunks long text with overlap and keeps every word', () => {
    const text = Array.from({ length: 300 }, (_, i) => `Sentence number ${i} about the brand.`).join(' ');
    const chunks = chunkText(text, 1000, 200);
    expect(chunks.length).toBeGreaterThan(5);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    for (let i = 0; i < 300; i++) expect(chunks.some((c) => c.includes(`number ${i} `))).toBe(true);
  });
  it('slugifies', () => {
    expect(slugify('Café Olé & Co!')).toBe('cafe-ole-co');
    expect(slugify('***')).toBe('company');
  });
  it('normalises colours and picks readable text', () => {
    expect(normalizeHex('0f7')).toBe('#00FF77');
    expect(() => normalizeHex('teal')).toThrow();
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(readableTextOn('#0F766E')).toBe('#FFFFFF');
    expect(readableTextOn('#FDE68A')).toBe('#0B0B0F');
  });
});

describe('dates', () => {
  it('handles months and weeks', () => {
    expect(monthStart('2026-11-18')).toBe('2026-11-01');
    expect(daysInMonth('2028-02-10')).toBe(29);
    expect(monthEnd('2026-02-01')).toBe('2026-02-28');
    expect(nextMonth('2026-12-01')).toBe('2027-01-01');
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // Sunday -> Monday before
    expect(daysRemainingInMonth('2026-11-30')).toBe(1);
    expect(() => parseIsoDate('2026-02-30')).toThrow();
  });
});

describe('TikTok upload chunking', async () => {
  const { uploadChunks } = await import('@/lib/tiktok/posting');
  it('sends small and medium files in one chunk', () => {
    expect(uploadChunks(3_000_000)).toEqual({ chunkSize: 3_000_000, chunks: [{ start: 0, end: 2_999_999 }] });
    expect(uploadChunks(64_000_000).chunks).toHaveLength(1);
  });
  it('splits large files into 10 MB chunks and merges the remainder into the last', () => {
    const size = 150_000_123;
    const { chunkSize, chunks } = uploadChunks(size);
    expect(chunkSize).toBe(10_000_000);
    expect(chunks).toHaveLength(15);
    expect(chunks.at(-1)).toEqual({ start: 140_000_000, end: size - 1 });
    // Contiguous, complete, and every chunk within TikTok's 5-128 MB bounds.
    chunks.forEach((c, i) => i && expect(c.start).toBe(chunks[i - 1].end + 1));
    expect(chunks.every((c) => c.end - c.start + 1 >= 5_000_000 && c.end - c.start + 1 <= 128_000_000)).toBe(true);
  });
});
