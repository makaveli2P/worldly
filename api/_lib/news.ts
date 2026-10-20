// Builds the news list for one country: provider chain, dedupe and an in-memory cache.
import type { NewsArticle, NewsProvider, NewsResponse } from '../../src/types';
import countries from './countries.json' with { type: 'json' };
import { gdelt } from './providers/gdelt.js';
import { google } from './providers/google.js';
import { newsdata } from './providers/newsdata.js';
import type { NewsCountry, Provider } from './providers/types.js';
import { isJunk, titleKey } from './text.js';

export const MAX_ARTICLES = 5;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
// One provider may make two calls (NewsData: country, then name).
const PROVIDER_BUDGET_MS = 8000;

const PROVIDERS: Provider[] = [newsdata, google, gdelt];

const COUNTRIES = countries as Record<string, { name: string; iso2: string | null }>;

/** Returns the country for a known id, else null. Accepts any case for ISO ids. */
export function findCountry(raw: string | null): NewsCountry | null {
  if (!raw || raw.length > 64) return null;
  const id = Object.hasOwn(COUNTRIES, raw) ? raw : raw.toUpperCase();
  if (!Object.hasOwn(COUNTRIES, id)) return null;
  const entry = COUNTRIES[id];
  return { id, name: entry.name, iso2: entry.iso2 };
}

interface CacheEntry {
  expires: number;
  value: Promise<NewsResponse>;
}

const cache = new Map<string, CacheEntry>();

async function runChain(country: NewsCountry): Promise<NewsResponse> {
  const articles: NewsArticle[] = [];
  const seen = new Set<string>();
  const count = new Map<NewsProvider, number>();

  for (const p of PROVIDERS) {
    if (articles.length >= MAX_ARTICLES) break;
    if (!p.enabled()) continue;
    let found: NewsArticle[];
    try {
      found = await p.fetchTop(country, MAX_ARTICLES, AbortSignal.timeout(PROVIDER_BUDGET_MS));
    } catch (err) {
      // Log only the provider and a short reason. Never the URL or the body.
      const reason = err instanceof Error && err.name === 'UpstreamError' ? err.message : 'error';
      console.warn(`[news] ${p.name} failed for ${country.id}: ${reason}`);
      continue;
    }
    for (const article of found) {
      if (articles.length >= MAX_ARTICLES) break;
      const tKey = titleKey(article.title);
      const uKey = article.url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
      if (!tKey || seen.has(tKey) || seen.has(uKey) || isJunk(article.title, article.source)) continue;
      seen.add(tKey);
      seen.add(uKey);
      articles.push(article);
      count.set(p.name, (count.get(p.name) ?? 0) + 1);
    }
  }

  // Label the response with the provider that gave most of the stories. On a tie the earlier one wins.
  let provider: NewsProvider | null = null;
  for (const [name, n] of count) if (provider === null || n > count.get(provider)!) provider = name;

  return { country: country.id, articles, provider, fetchedAt: new Date().toISOString() };
}

/** Returns cached news when fresh. Parallel calls for one country share one upstream run. */
export function getNews(country: NewsCountry): Promise<NewsResponse> {
  const now = Date.now();
  const hit = cache.get(country.id);
  if (hit && hit.expires > now) return hit.value;

  const value = runChain(country);
  const entry: CacheEntry = { expires: now + CACHE_TTL_MS, value };
  cache.set(country.id, entry);
  value.then(
    (result) => {
      if (result.provider === null) entry.expires = Date.now() + FAILURE_TTL_MS;
    },
    () => cache.delete(country.id),
  );

  if (cache.size > CACHE_MAX_ENTRIES) {
    for (const [key, old] of cache) {
      if (old.expires <= now || cache.size > CACHE_MAX_ENTRIES) cache.delete(key);
      if (cache.size <= CACHE_MAX_ENTRIES) break;
    }
  }
  return value;
}
