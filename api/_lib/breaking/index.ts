// GET /api/breaking: fetch the sources, run the detector, keep the result in memory for a short time.
//
// Between runs the module keeps two things in memory: the detector state (for the hold) and the last
// good answer of each source (for a source that fails). The state also goes to the shared store
// (see state.ts). The last good answers stay in memory only: they are too large for a cheap write each run.
import type { BreakingResponse } from '../../../src/types';
import { detect } from './detect.js';
import { fetchInputs, type LastGood } from './sources.js';
import { defaultStore, mergeStates, readState, writeState } from './state.js';
import type { BreakingState } from './types.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEGRADED_TTL_MS = 60 * 1000;

export interface BreakingResult {
  response: BreakingResponse;
  degraded: boolean; // fewer than half of the sources answered
}

/** True when fewer than half of the sources answered. */
export function isDegraded(sources: BreakingResponse['sources']): boolean {
  return !sources || sources.ok * 2 < sources.total;
}

let cached: { expires: number; value: Promise<BreakingResult> } | null = null;
let memoryState: BreakingState | null = null;
const lastGood = new Map<string, LastGood>();

async function run(): Promise<BreakingResult> {
  const now = Date.now();
  const store = defaultStore();
  // Read the shared state while the sources load.
  const shared = readState(store);
  const { inputs, status } = await fetchInputs(now, {
    userAgent: process.env.BREAKING_USER_AGENT,
    contact: process.env.BREAKING_CONTACT,
    lastGood,
  });
  const failed = status.filter((s) => !s.ok);
  // Log only the source id and a short reason. Never a URL or a body.
  if (failed.length) {
    const reused = failed.filter((s) => s.reused).length;
    console.warn(`[breaking] ${failed.length}/${status.length} sources failed (${reused} reused last good): ${failed.map((s) => `${s.id}:${s.status}`).join(' ')}`);
  }
  const sharedState = await shared;
  // A cold instance has no memory state. When its read also gives null (a miss or a failure), it does
  // not know the alerts of the other instances.
  const blind = memoryState === null && sharedState === null;
  const previous = mergeStates(memoryState, sharedState);
  const { response, state } = detect(inputs, previous);
  const degraded = isDegraded(response.sources);
  // A degraded run sees too few sources to end a story. It keeps the last state.
  if (!degraded) {
    memoryState = state;
    // A blind run with no alerts does not write: its state can remove the alerts of the other
    // instances, and it adds nothing. (With no entry in the store, an empty state changes nothing.)
    // A blind run with alerts writes, so that a new alert reaches the other instances.
    if (!blind || state.alerts.length) writeState(store, state);
  } else if (previous) {
    memoryState = previous;
  }
  return { response, degraded };
}

/** Returns the cached result when fresh. Parallel calls share one upstream run. */
export function getBreaking(): Promise<BreakingResult> {
  const now = Date.now();
  if (cached && cached.expires > now) return cached.value;
  const value = run();
  const entry = { expires: now + CACHE_TTL_MS, value };
  cached = entry;
  value.then(
    (result) => {
      if (result.degraded) entry.expires = Date.now() + DEGRADED_TTL_MS;
    },
    () => {
      if (cached === entry) cached = null;
    },
  );
  return value;
}
