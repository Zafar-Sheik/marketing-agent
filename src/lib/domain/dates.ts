/** All dates are handled as UTC calendar dates in `YYYY-MM-DD` form. */
export type IsoDate = string;

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function parseIsoDate(s: IsoDate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${s}`);
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || toIsoDate(d) !== s) throw new Error(`Invalid date: ${s}`);
  return d;
}

export function monthStart(d: Date | IsoDate): IsoDate {
  const date = typeof d === 'string' ? parseIsoDate(d) : d;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function daysInMonth(month: IsoDate): number {
  const d = parseIsoDate(monthStart(month));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function monthEnd(month: IsoDate): IsoDate {
  return `${monthStart(month).slice(0, 8)}${String(daysInMonth(month)).padStart(2, '0')}`;
}

export function isInMonth(date: Date | IsoDate, month: IsoDate): boolean {
  return monthStart(date) === monthStart(month);
}

/** Days left in the month including `today`. */
export function daysRemainingInMonth(today: Date | IsoDate): number {
  const iso = typeof today === 'string' ? today : toIsoDate(today);
  return daysInMonth(iso) - Number(iso.slice(8, 10)) + 1;
}

/** Monday of the ISO week containing `d`. */
export function weekStart(d: Date | IsoDate): IsoDate {
  const date = typeof d === 'string' ? parseIsoDate(d) : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - dow);
  return toIsoDate(date);
}

export function addDays(d: IsoDate, days: number): IsoDate {
  const date = parseIsoDate(d);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

export function nextMonth(month: IsoDate): IsoDate {
  return monthStart(addDays(monthEnd(month), 1));
}

export function formatMonth(month: IsoDate): string {
  return parseIsoDate(monthStart(month)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
