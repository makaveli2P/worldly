// GET /api/breaking: fetch the sources, run the detector, keep the result in memory for a short time.
import type { BreakingResponse } from '../../../src/types';
import { detect } from './detect.js';
import { fetchInputs } from './sources.js';

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

async function run(): Promise<BreakingResult> {
  const now = Date.now();
  const { inputs, status } = await fetchInputs(now, {
    userAgent: process.env.BREAKING_USER_AGENT,
    contact: process.env.BREAKING_CONTACT,
  });
  const failed = status.filter((s) => !s.ok);
  // Log only the source id and a short reason. Never a URL or a body.
  if (failed.length) console.warn(`[breaking] ${failed.length}/${status.length} sources failed: ${failed.map((s) => `${s.id}:${s.status}`).join(' ')}`);
  const { response } = detect(inputs);
  return { response, degraded: isDegraded(response.sources) };
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
