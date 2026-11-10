// GET /api/breaking -> BreakingResponse
import type { BreakingResponse } from '../src/types';
import { getBreaking } from './_lib/breaking/index.js';

const SUCCESS_CACHE = 'public, s-maxage=300, stale-while-revalidate=900, stale-if-error=3600';
const DEGRADED_CACHE = 'public, s-maxage=60';

function json(body: BreakingResponse, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function GET(): Promise<Response> {
  try {
    const { response, degraded } = await getBreaking();
    return json(response, degraded ? DEGRADED_CACHE : SUCCESS_CACHE);
  } catch {
    console.warn('[breaking] unexpected failure');
    return json({ alerts: [], generatedAt: new Date().toISOString(), sources: null }, DEGRADED_CACHE);
  }
}
