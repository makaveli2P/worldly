// GET /api/news?country=<CountryId> -> NewsResponse
import { findCountry, getNewsResult } from './_lib/news.js';

// Vercel removes s-maxage and stale-while-revalidate before the browser, so the browser keeps 60 s.
// Worst case for the list a user sees: 10 min server memory + 15 min fresh + 30 min stale.
const SUCCESS_CACHE = 'public, max-age=60, s-maxage=900, stale-while-revalidate=1800, stale-if-error=86400';
const FAILURE_CACHE = 'public, s-maxage=60';

function json(body: unknown, status: number, cacheControl: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cacheControl,
      'x-content-type-options': 'nosniff',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const country = findCountry(new URL(request.url).searchParams.get('country'));
  if (!country) return json({ error: 'unknown country' }, 400, 'no-store');

  try {
    const { news, state, untranslated } = await getNewsResult(country);
    // No source answered and no earlier list exists: 503, so the CDN can serve its stale copy (stale-if-error).
    if (state === 'failed' && news.articles.length === 0) return json({ error: 'news sources unavailable' }, 503, 'no-store');
    // A list whose translation failed for a reason that can go away (timeout, 429, 5xx) gets the short cache too,
    // so the CDN asks again soon. After a 403 or 456 the list keeps the normal cache.
    return json(news, 200, state === 'ok' && news.provider && !untranslated ? SUCCESS_CACHE : FAILURE_CACHE);
  } catch {
    console.warn(`[news] unexpected failure for ${country.id}`);
    return json({ error: 'news sources unavailable' }, 503, 'no-store');
  }
}
