// The detector state between runs: the live alerts of the last run, the stories that ended in the last
// 48 h, and the days on which alerts started (for the life rules of detect.ts).
//
// The state lives in module memory on a warm instance. On Vercel, the server also keeps a copy in the
// Vercel Runtime Cache, so a cold instance or another instance continues from the same state. The Runtime
// Cache is regional and can drop an entry at any time.
//
// The Vercel client does not throw. When a read or a write fails, it logs the error with console.error
// and gives null (a read) or nothing (a write). So a failed read and a missing entry look the same here:
// `readState()` gives null for both, and the caller must treat null as "unknown", not as "no alerts".
// The client logs the error object, with the address of the cache endpoint but with no headers and no
// state. This module logs a short reason only for a store that throws (not the Vercel client) and
// for an invalid entry. It never logs the state.
import { getCache, waitUntil } from '@vercel/functions';
import { CONFIG } from './detect.js';
import type { BreakingState, EndedAlert, Family, HeldAlert } from './types.js';

const KEY = 'breaking-state-v1';
const NAMESPACE = 'worldly';
export const STATE_TTL_S = 26 * 60 * 60;
const STORE_TIMEOUT_MS = 500;
const FAMILIES: readonly Family[] = ['conflict', 'attack', 'disaster', 'accident', 'politics', 'business'];
// Two states this close in time see the same news. An alert that only one of them has stays in the merge.
export const MERGE_GAP_MS = 15 * 60 * 1000;
const MAX_ALERTS = 20;

/** A shared key-value store. On Vercel, this is the Runtime Cache. */
export interface StateStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, options: { ttl: number }): Promise<void>;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 100;
const list = (v: unknown, max: number, ok: (x: unknown) => boolean): v is string[] => Array.isArray(v) && v.length <= max && v.every(ok);
const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v);

const tier = (v: unknown): v is number => num(v) && v >= 0 && v <= 3;
const count = (v: unknown): v is number => num(v) && v >= 0;
// "PSE|conflict|20261112", "X-kosovo|attack|20261112"
const START = new RegExp(`^[A-Za-z-]{3,30}\\|(?:${FAMILIES.join('|')})\\|\\d{8}$`);

/**
 * One live entry, or null when it is not valid. A new field that is absent (a state from before the
 * life rules) gets its default: the wave starts at the first alert, and the peak tier comes from the level.
 */
function parseAlertEntry(a: Record<string, unknown>): HeldAlert | null {
  if (!a || typeof a !== 'object') return null;
  if (!str(a.key) || !str(a.country) || !FAMILIES.includes(a.family as Family)) return null;
  if (a.level !== 'critical' && a.level !== 'major') return null;
  if (!num(a.since) || !num(a.firstAlertAt) || !num(a.lastQualifiedAt)) return null;
  if (!list(a.itemIds, CONFIG.heldItemIds, hash) || !list(a.words, CONFIG.heldWords, str)) return null;
  const opt = (v: unknown, ok: (x: unknown) => boolean) => v === undefined || ok(v);
  if (!opt(a.waveAt, num) || !opt(a.waves, count) || !opt(a.peakTier, tier) || !opt(a.peakDeaths, count)) return null;
  if (!opt(a.waveIds, (v) => list(v, CONFIG.waveItemIds, hash)) || !opt(a.pickId, (v) => v === null || hash(v))) return null;
  return {
    key: a.key, country: a.country, family: a.family as Family, level: a.level,
    since: a.since, firstAlertAt: a.firstAlertAt, lastQualifiedAt: a.lastQualifiedAt,
    itemIds: [...a.itemIds], words: [...a.words],
    waveAt: (a.waveAt as number | undefined) ?? a.firstAlertAt,
    waves: (a.waves as number | undefined) ?? 1,
    peakTier: (a.peakTier as number | undefined) ?? (a.level === 'critical' ? 3 : 2),
    peakDeaths: (a.peakDeaths as number | undefined) ?? 0,
    waveIds: a.waveIds ? [...(a.waveIds as string[])] : [...a.itemIds].slice(0, CONFIG.waveItemIds),
    pickId: (a.pickId as string | null | undefined) ?? null,
  };
}

/** One ended entry, or null when it is not valid. */
function parseEndedEntry(x: Record<string, unknown>): EndedAlert | null {
  if (!x || typeof x !== 'object') return null;
  if (!str(x.key) || !str(x.country) || !FAMILIES.includes(x.family as Family)) return null;
  for (const f of ['since', 'firstAlertAt', 'waveAt', 'endedAt'] as const) if (!num(x[f])) return null;
  if (!count(x.waves) || !tier(x.peakTier) || !count(x.peakDeaths)) return null;
  if (!list(x.itemIds, CONFIG.heldItemIds, hash) || !list(x.words, CONFIG.heldWords, str)) return null;
  return {
    key: x.key, country: x.country, family: x.family as Family, since: x.since as number, firstAlertAt: x.firstAlertAt as number,
    waveAt: x.waveAt as number, waves: x.waves, endedAt: x.endedAt as number, peakTier: x.peakTier, peakDeaths: x.peakDeaths,
    itemIds: [...x.itemIds], words: [...x.words],
  };
}

/** A state from the store, or null when the value is not a valid state. */
export function parseState(raw: unknown): BreakingState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !num(r.savedAt) || !Array.isArray(r.alerts) || r.alerts.length > MAX_ALERTS) return null;
  const alerts: HeldAlert[] = [];
  for (const a of r.alerts as Record<string, unknown>[]) {
    const entry = parseAlertEntry(a);
    if (!entry) return null;
    alerts.push(entry);
  }
  const state: BreakingState = { v: 1, savedAt: r.savedAt, alerts };
  if (r.ended !== undefined) {
    if (!Array.isArray(r.ended) || r.ended.length > CONFIG.maxEnded) return null;
    const ended: EndedAlert[] = [];
    for (const x of r.ended as Record<string, unknown>[]) {
      const entry = parseEndedEntry(x);
      if (!entry) return null;
      ended.push(entry);
    }
    if (ended.length) state.ended = ended;
  }
  if (r.starts !== undefined) {
    if (!list(r.starts, CONFIG.maxStarts, (v) => typeof v === 'string' && START.test(v))) return null;
    if (r.starts.length) state.starts = [...r.starts];
  }
  return state;
}

/** True when two entries are one story: the same key and a shared item hash. */
const sameStory = (a: StoryEntry, b: StoryEntry) => a.key === b.key && a.itemIds.some((id) => b.itemIds.includes(id));
type StoryEntry = Pick<HeldAlert, 'key' | 'itemIds'>;

/**
 * Merges the memory state and the shared state, entry by entry. Another instance can miss an alert
 * (a failed read, a slow feed), so the newer state does not replace the older state as a whole:
 * - One story in both states gives one entry: the newer level and words, the earliest first evidence and
 *   first alert, the latest qualified time, wave and peak, and the item hashes of both.
 * - An entry in the older state only stays when the two states are at most 15 minutes apart. The
 *   detector checks each entry again, so an entry for a story that is gone does no harm.
 * - Ended stories: the union, one entry per story with the latest end. A live entry of a story in
 *   either state wins over an ended entry of that story.
 * - Start days: the union.
 */
export function mergeStates(a: BreakingState | null, b: BreakingState | null): BreakingState | null {
  if (!a) return b;
  if (!b) return a;
  const [older, newer] = a.savedAt <= b.savedAt ? [a, b] : [b, a];
  const used = new Set<HeldAlert>();
  const alerts = newer.alerts.map((n): HeldAlert => {
    const o = older.alerts.find((x) => !used.has(x) && sameStory(n, x));
    if (!o) return n;
    used.add(o);
    const wave = n.waveAt >= o.waveAt ? n : o;
    return {
      ...n,
      since: Math.min(n.since, o.since),
      firstAlertAt: Math.min(n.firstAlertAt, o.firstAlertAt),
      lastQualifiedAt: Math.max(n.lastQualifiedAt, o.lastQualifiedAt),
      itemIds: [...new Set([...n.itemIds, ...o.itemIds])].slice(0, CONFIG.heldItemIds),
      waveAt: wave.waveAt,
      waves: Math.max(n.waves, o.waves),
      waveIds: wave.waveIds,
      peakTier: Math.max(n.peakTier, o.peakTier),
      peakDeaths: Math.max(n.peakDeaths, o.peakDeaths),
    };
  });
  if (newer.savedAt - older.savedAt <= MERGE_GAP_MS) alerts.push(...older.alerts.filter((o) => !used.has(o)));
  const ended: EndedAlert[] = [];
  for (const x of [...(newer.ended ?? []), ...(older.ended ?? [])]) {
    if (alerts.some((l) => sameStory(l, x))) continue;
    const i = ended.findIndex((y) => sameStory(y, x));
    if (i < 0) ended.push(x);
    else if (x.endedAt > ended[i].endedAt) ended[i] = x;
  }
  const starts = [...new Set([...(older.starts ?? []), ...(newer.starts ?? [])])]
    .sort((p, q) => (p.slice(-8) === q.slice(-8) ? (p < q ? -1 : 1) : p.slice(-8) < q.slice(-8) ? -1 : 1))
    .slice(-CONFIG.maxStarts);
  const state: BreakingState = { v: 1, savedAt: newer.savedAt, alerts: alerts.slice(0, MAX_ALERTS) };
  if (ended.length) state.ended = ended.sort((p, q) => q.endedAt - p.endedAt).slice(0, CONFIG.maxEnded);
  if (starts.length) state.starts = starts;
  return state;
}

/** The Runtime Cache on Vercel (the platform sets VERCEL=1). Elsewhere null: memory only. */
export function defaultStore(): StateStore | null {
  if (!process.env.VERCEL) return null;
  try {
    const cache = getCache({ namespace: NAMESPACE });
    return { get: (key) => cache.get(key), set: (key, value, options) => cache.set(key, value, { ttl: options.ttl, name: key }) };
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), STORE_TIMEOUT_MS);
  });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

const why = (err: unknown) => (err instanceof Error && err.message === 'timeout' ? 'timeout' : 'error');

/**
 * Reads the shared state. Returns null when there is no store, no entry, an invalid entry or a failure.
 * The Vercel client gives null for a failure too, so null means "unknown".
 */
export async function readState(store: StateStore | null): Promise<BreakingState | null> {
  if (!store) return null;
  try {
    const raw = await withTimeout(store.get(KEY));
    if (raw === null || raw === undefined) return null;
    const state = parseState(raw);
    if (!state) console.warn('[breaking] state read: invalid entry');
    return state;
  } catch (err) {
    // Only a store that throws comes here. The Vercel client gives null and logs the error itself.
    console.warn(`[breaking] state read: ${why(err)}`);
    return null;
  }
}

/** Writes the shared state after the response, with a TTL of 26 h. */
export function writeState(store: StateStore | null, state: BreakingState): void {
  if (!store) return;
  const job = withTimeout(store.set(KEY, state, { ttl: STATE_TTL_S })).catch((err: unknown) => {
    // Only a store that throws comes here. The Vercel client logs the error itself.
    console.warn(`[breaking] state write: ${why(err)}`);
  });
  try {
    waitUntil(job);
  } catch {
    // Outside Vercel the write still runs.
  }
}
