// Number, date and list formatting for the panels.

const LOCALE = 'en';

const compactLong = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  compactDisplay: 'long',
  maximumFractionDigits: 2,
});
const compactMoney = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  compactDisplay: 'long',
  maximumSignificantDigits: 3,
});
const grouped = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });
const relative = new Intl.RelativeTimeFormat(LOCALE, { style: 'narrow', numeric: 'always' });
const shortDate = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });

/** 1428627663 -> "1.43 billion"; small numbers keep their digits ("38,000"). */
export function compactNumber(n: number): string {
  return n < 1_000_000 ? grouped.format(n) : compactLong.format(n);
}

/** 3.9e12 -> "$3.9 trillion"; under a million -> "$2,697". */
export function compactUsd(n: number): string {
  return n < 1_000_000 ? `$${grouped.format(n)}` : `$${compactMoney.format(n)}`;
}

/** 2697.4 -> "$2,697" */
export function usd(n: number): string {
  return `$${grouped.format(n)}`;
}

/** 3287263 -> "3,287,263 km²" */
export function area(n: number): string {
  // Vatican City is 0.44 km²: keep the decimals below 10 km², so it does not read "0 km²".
  return `${n < 10 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : grouped.format(n)} km²`;
}

export function decimal1(n: number): string {
  return oneDecimal.format(n);
}

export function hdi(n: number): string {
  return n.toFixed(3);
}

/** ISO date -> "3h ago", "2d ago"; older than a week -> "12 Mar". */
export function relativeTime(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const sec = Math.round((t - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 60) return 'just now';
  if (abs < 3600) return relative.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(sec / 3600), 'hour');
  if (abs < 7 * 86400) return relative.format(Math.round(sec / 86400), 'day');
  return shortDate.format(t);
}

/** Up to three zones verbatim; more collapse to "UTC−05:00 – UTC+12:00 (12 zones)". */
export function timezones(zones: string[]): string | null {
  if (zones.length === 0) return null;
  const pretty = zones.map((z) => z.replace('-', '−'));
  if (pretty.length <= 3) return pretty.join(', ');
  return `${pretty[0]} – ${pretty[pretty.length - 1]} (${pretty.length} zones)`;
}

/** "federal parliamentary republic" -> "Federal parliamentary republic" */
export function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
