// GET /api/news?country=<CountryId> -> NewsResponse
import { findCountry, getNews } from './_lib/news.js';

const SUCCESS_CACHE = 'public, s-maxage=10800, stale-while-revalidate=86400';
const FAILURE_CACHE = 'public, s-maxage=300';

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
    const news = await getNews(country);
    return json(news, 200, news.provider ? SUCCESS_CACHE : FAILURE_CACHE);
  } catch {
    console.warn(`[news] unexpected failure for ${country.id}`);
    const empty = { country: country.id, articles: [], provider: null, fetchedAt: new Date().toISOString() };
    return json(empty, 200, FAILURE_CACHE);
  }
}
