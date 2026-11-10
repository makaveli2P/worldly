// Pure logic of the breaking-news UI: response checks, order, dismiss and announce sets,
// the live-region message, the title badge and the poll delay. No DOM here, so tests run in Node.

import type { BreakingAlert, BreakingKind, BreakingLevel, CountryId } from '../types';

/** Markers and chip rows the UI shows at most. The server sends at most 3. */
export const MAX_ALERTS = 5;
export const POLL_MS = 5 * 60_000;
export const POLL_BACKOFF_MS = 15 * 60_000;
/** After this many failed polls in a row, the feed polls at POLL_BACKOFF_MS. */
export const BACKOFF_AFTER = 3;
/** On a return to the tab, the feed polls at once when the last poll is older than this. */
export const REFRESH_ON_SHOW_MS = 60_000;
/** The UI drops an alert when its newest evidence is older than this, also when the server still sends it. */
export const MAX_AGE_MS = 24 * 60 * 60_000;

export const DISMISSED_KEY = 'worldly:breaking-dismissed';
export const ANNOUNCED_KEY = 'worldly:breaking-announced';

const LEVELS: readonly BreakingLevel[] = ['critical', 'major'];
const KINDS: readonly BreakingKind[] = ['conflict', 'attack', 'disaster', 'accident', 'politics'];
const BASES = ['news', 'itn', 'gdacs', 'usgs'] as const;

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** One alert from the wire, or null when a required field is missing or has the wrong type. */
export function parseAlert(raw: unknown): BreakingAlert | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (!isStr(a.key) || !isStr(a.country) || !isStr(a.headline) || !isStr(a.url)) return null;
  if (!LEVELS.includes(a.level as BreakingLevel)) return null;
  if (!/^https?:\/\//i.test(a.url)) return null;
  const since = isStr(a.since) && !Number.isNaN(Date.parse(a.since)) ? a.since : null;
  const updatedAt = isStr(a.updatedAt) && !Number.isNaN(Date.parse(a.updatedAt)) ? a.updatedAt : since;
  if (!since || !updatedAt) return null;
  return {
    key: a.key,
    country: a.country,
    level: a.level as BreakingLevel,
    kind: KINDS.includes(a.kind as BreakingKind) ? (a.kind as BreakingKind) : 'politics',
    headline: a.headline.replace(/\s+/g, ' ').trim().slice(0, 200),
    url: a.url,
    source: isStr(a.source) ? a.source : '',
    since,
    updatedAt,
    outlets: typeof a.outlets === 'number' && Number.isFinite(a.outlets) ? a.outlets : 1,
    basis: Array.isArray(a.basis) ? a.basis.filter((b): b is (typeof BASES)[number] => BASES.includes(b)) : [],
  };
}

/** The alerts of a GET /api/breaking body, or null when the body is not a BreakingResponse. */
export function parseBreakingResponse(body: unknown): BreakingAlert[] | null {
  if (!body || typeof body !== 'object') return null;
  const alerts = (body as { alerts?: unknown }).alerts;
  if (!Array.isArray(alerts)) return null;
  const out: BreakingAlert[] = [];
  for (const raw of alerts) {
    const a = parseAlert(raw);
    if (a) out.push(a);
  }
  return out;
}

const rank = (l: BreakingLevel) => (l === 'critical' ? 0 : 1);

/** Critical first, then the newest evidence first. Returns a new array. */
export function sortAlerts(alerts: readonly BreakingAlert[]): BreakingAlert[] {
  return [...alerts].sort((a, b) => rank(a.level) - rank(b.level) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * The alerts the UI shows: known countries only (ids go through `resolve`), no dismissed keys,
 * no evidence older than MAX_AGE_MS, one alert per country (the most severe), sorted, at most MAX_ALERTS.
 */
export function visibleAlerts(
  alerts: readonly BreakingAlert[],
  dismissed: ReadonlySet<string>,
  resolve: (id: string) => CountryId | null,
  now = Date.now(),
): BreakingAlert[] {
  const out: BreakingAlert[] = [];
  const seen = new Set<CountryId>();
  for (const a of sortAlerts(alerts)) {
    if (dismissed.has(a.key)) continue;
    if (now - Date.parse(a.updatedAt) > MAX_AGE_MS) continue;
    const id = resolve(a.country);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id === a.country ? a : { ...a, country: id });
    if (out.length >= MAX_ALERTS) break;
  }
  return out;
}

/**
 * True when two lists show the same thing in the chip: the same alerts in the same order, with the
 * same level, country, headline and link. The age is not compared: the age tick updates it in place.
 */
export function sameView(a: readonly BreakingAlert[], b: readonly BreakingAlert[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.key === y.key &&
        x.level === y.level &&
        x.country === y.country &&
        x.headline === y.headline &&
        x.url === y.url &&
        x.source === y.source &&
        x.since === y.since
      );
    })
  );
}

/** Keys in `alerts` that are not in `known`, in the order of `alerts`. */
export function newKeys(alerts: readonly BreakingAlert[], known: ReadonlySet<string>): string[] {
  return alerts.filter((a) => !known.has(a.key)).map((a) => a.key);
}

/** The polite live-region text for alerts that are new. Empty string when nothing is new. */
export function announcement(fresh: readonly BreakingAlert[], nameOf: (id: CountryId) => string | null): string {
  if (fresh.length === 0) return '';
  const name = (a: BreakingAlert) => nameOf(a.country) ?? a.country;
  if (fresh.length === 1) {
    const a = fresh[0];
    const head = a.headline.replace(/[.!?…]+$/, '');
    return `Breaking news in ${name(a)}: ${head}.`;
  }
  const names = fresh.map(name);
  const list = names.length === 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Breaking news in ${fresh.length} countries: ${list}.`;
}

/** Age for screen readers: "just now", "1 minute ago", "3 hours ago", "2 days ago". Null for a bad date. */
export function ageWords(iso: string, now: number): string | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60_000));
  const unit = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'} ago`;
  if (min < 1) return 'just now';
  if (min < 60) return unit(min, 'minute');
  if (min < 24 * 60) return unit(Math.round(min / 60), 'hour');
  return unit(Math.round(min / 1440), 'day');
}

const BADGE = /^\(\d+\) /;

/** "Japan · Worldly" -> "(2) Japan · Worldly". A badge that is there already is replaced. */
export function withBadge(title: string, n: number): string {
  const base = stripBadge(title);
  return n > 0 ? `(${n}) ${base}` : base;
}

export function stripBadge(title: string): string {
  return title.replace(BADGE, '');
}

/**
 * Delay before the next poll: 5 minutes ±10 %. It is 15 minutes after BACKOFF_AFTER failures in a row,
 * and while the page is hidden (one slow poll, so that the title badge can show a new alert).
 */
export function nextPollDelay(failures: number, random: number, hidden = false): number {
  const base = hidden || failures >= BACKOFF_AFTER ? POLL_BACKOFF_MS : POLL_MS;
  return Math.round(base * (0.9 + 0.2 * Math.min(1, Math.max(0, random))));
}

/** A string set kept in sessionStorage as a JSON array. Every access is in try/catch: storage can be blocked. */
export class SessionSet {
  private readonly values: Set<string>;

  constructor(
    private readonly key: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null,
    private readonly limit = 200,
  ) {
    this.values = new Set(this.read());
  }

  has(v: string): boolean {
    return this.values.has(v);
  }

  add(...vs: string[]): void {
    let changed = false;
    for (const v of vs) {
      if (this.values.has(v)) continue;
      this.values.add(v);
      changed = true;
    }
    if (!changed) return;
    // Keep the newest entries only, so the stored list cannot grow without end.
    while (this.values.size > this.limit) this.values.delete(this.values.values().next().value as string);
    try {
      this.storage?.setItem(this.key, JSON.stringify([...this.values]));
    } catch {
      // Blocked storage: the set lasts for this page only.
    }
  }

  asSet(): ReadonlySet<string> {
    return this.values;
  }

  private read(): string[] {
    try {
      const raw = this.storage?.getItem(this.key);
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }
}

/** sessionStorage, or null where the accessor throws (blocked cookies, sandboxed frames). */
export function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
