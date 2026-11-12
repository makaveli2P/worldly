// The detector state between runs (the alerts of the last run, for the hold).
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
import type { BreakingState, Family, HeldAlert } from './types.js';

const KEY = 'breaking-state-v1';
const NAMESPACE = 'worldly';
export const STATE_TTL_S = 26 * 60 * 60;
const STORE_TIMEOUT_MS = 500;
const FAMILIES: readonly Family[] = ['conflict', 'attack', 'disaster', 'accident', 'politics'];
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

/** A state from the store, or null when the value is not a valid state. */
export function parseState(raw: unknown): BreakingState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || !num(r.savedAt) || !Array.isArray(r.alerts) || r.alerts.length > MAX_ALERTS) return null;
  const alerts: HeldAlert[] = [];
  for (const a of r.alerts as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object') return null;
    if (!str(a.key) || !str(a.country) || !FAMILIES.includes(a.family as Family)) return null;
    if (a.level !== 'critical' && a.level !== 'major') return null;
    if (!num(a.since) || !num(a.firstAlertAt) || !num(a.lastQualifiedAt)) return null;
    if (!list(a.itemIds, CONFIG.heldItemIds, hash) || !list(a.words, CONFIG.heldWords, str)) return null;
    alerts.push({
      key: a.key, country: a.country, family: a.family as Family, level: a.level,
      since: a.since, firstAlertAt: a.firstAlertAt, lastQualifiedAt: a.lastQualifiedAt,
      itemIds: [...a.itemIds], words: [...a.words],
    });
  }
  return { v: 1, savedAt: r.savedAt, alerts };
}

/** True when two entries are one story: the same key and a shared item hash. */
const sameStory = (a: HeldAlert, b: HeldAlert) => a.key === b.key && a.itemIds.some((id) => b.itemIds.includes(id));

/**
 * Merges the memory state and the shared state, entry by entry. Another instance can miss an alert
 * (a failed read, a slow feed), so the newer state does not replace the older state as a whole:
 * - One story in both states gives one entry: the newer level and words, the earliest first evidence and
 *   first alert, the latest qualified time, and the item hashes of both.
 * - An entry in the older state only stays when the two states are at most 15 minutes apart. The
 *   detector checks each entry again, so an entry for a story that is gone does no harm.
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
    return {
      ...n,
      since: Math.min(n.since, o.since),
      firstAlertAt: Math.min(n.firstAlertAt, o.firstAlertAt),
      lastQualifiedAt: Math.max(n.lastQualifiedAt, o.lastQualifiedAt),
      itemIds: [...new Set([...n.itemIds, ...o.itemIds])].slice(0, CONFIG.heldItemIds),
    };
  });
  if (newer.savedAt - older.savedAt <= MERGE_GAP_MS) alerts.push(...older.alerts.filter((o) => !used.has(o)));
  return { v: 1, savedAt: newer.savedAt, alerts: alerts.slice(0, MAX_ALERTS) };
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
