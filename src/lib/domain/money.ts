export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100);
}

/** Parse "15,000.50" / "15000" into cents. */
export function parseMoneyToCents(input: string | number): number {
  const digits = typeof input === 'number' ? String(input) : input.replace(/[^0-9.]/g, '');
  const n = Number(digits);
  if (!/\d/.test(digits) || !Number.isFinite(n) || n < 0) throw new Error(`Invalid amount: ${input}`);
  return Math.round(n * 100);
}

/**
 * Split `totalCents` by `shares` (any positive weights) so parts are whole cents and
 * add up exactly to the total (largest-remainder method).
 */
export function splitByShares<K extends string>(totalCents: number, shares: Record<K, number>): Record<K, number> {
  const entries = Object.entries(shares) as [K, number][];
  const positive = entries.filter(([, w]) => w > 0);
  const weight = positive.reduce((s, [, w]) => s + w, 0);
  const result = Object.fromEntries(entries.map(([k]) => [k, 0])) as Record<K, number>;
  if (weight === 0 || totalCents <= 0) return result;
  const raw = positive.map(([k, w]) => ({ k, exact: (totalCents * w) / weight }));
  let assigned = 0;
  for (const r of raw) {
    result[r.k] = Math.floor(r.exact);
    assigned += result[r.k];
  }
  raw
    .sort((a, b) => (b.exact % 1) - (a.exact % 1))
    .slice(0, totalCents - assigned)
    .forEach((r) => (result[r.k] += 1));
  return result;
}
