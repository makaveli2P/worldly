// Builds the news list for one country: provider chain, dedupe and an in-memory cache.
import type { NewsArticle, NewsProvider, NewsResponse } from '../../src/types';
import countries from './countries.json' with { type: 'json' };
import { gdelt } from './providers/gdelt.js';
import { googleEdition, googleSearch } from './providers/google.js';
import { newsdata } from './providers/newsdata.js';
import type { NewsCountry, Provider } from './providers/types.js';
import { isJunk, isPressRelease, jaccard, listsCountry, publisherKey, sameStory, titleKey, titleTokens } from './text.js';

export const MAX_ARTICLES = 5;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
// One provider may make two calls (NewsData: top domains, then all domains).
const PROVIDER_BUDGET_MS = 8000;
/** A title this similar (token Jaccard) to an earlier title is the same story. */
export const NEAR_DUPLICATE = 0.6;
export const MAX_PER_PUBLISHER = 2;

// Each provider tops up the list until it holds MAX_ARTICLES stories.
// googleEdition gives nothing for a country without an English edition, at no cost.
const PROVIDERS: Provider[] = [googleEdition, newsdata, googleSearch, gdelt];

const COUNTRIES = countries as Record<string, { name: string; iso2: string | null }>;
/** Lowercase id -> id, so "deu" and "x-kosovo" resolve. */
const ID_BY_LOWER = new Map(Object.keys(COUNTRIES).map((id) => [id.toLowerCase(), id]));

/** Returns the country for a known id, else null. Accepts any case. */
export function findCountry(raw: string | null): NewsCountry | null {
  if (!raw || raw.length > 64) return null;
  const id = Object.hasOwn(COUNTRIES, raw) ? raw : ID_BY_LOWER.get(raw.toLowerCase());
  if (!id) return null;
  const entry = COUNTRIES[id];
  return { id, name: entry.name, iso2: entry.iso2 };
}

interface CacheEntry {
  expires: number;
  value: Promise<NewsResponse>;
}

const cache = new Map<string, CacheEntry>();

/**
 * Adds the stories that pass the filters to `kept`, in order, until it holds `max`.
 * Drops junk, press releases, repeated URLs, near-duplicate titles,
 * and a third story from one publisher. Returns the number added.
 */
export function addDistinct(kept: NewsArticle[], found: NewsArticle[], max = MAX_ARTICLES, countryName = ''): number {
  const ignore = titleTokens(countryName);
  const urlKey = (url: string) => url.replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  const urls = new Set(kept.map((a) => urlKey(a.url)));
  const keys = new Set(kept.map((a) => titleKey(a.title)));
  const tokens = kept.map((a) => titleTokens(a.title));
  const perPublisher = new Map<string, number>();
  for (const a of kept) perPublisher.set(publisherKey(a.source), (perPublisher.get(publisherKey(a.source)) ?? 0) + 1);

  let added = 0;
  for (const article of found) {
    if (kept.length >= max) break;
    const tKey = titleKey(article.title);
    const uKey = urlKey(article.url);
    if (!tKey || keys.has(tKey) || urls.has(uKey)) continue;
    if (isJunk(article.title, article.source) || isPressRelease(article.url, article.source)) continue;
    const pKey = publisherKey(article.source);
    if ((perPublisher.get(pKey) ?? 0) >= MAX_PER_PUBLISHER) continue;
    const words = titleTokens(article.title);
    if (tokens.some((t) => jaccard(t, words) >= NEAR_DUPLICATE || sameStory(t, words, ignore))) continue;

    kept.push(article);
    keys.add(tKey);
    urls.add(uKey);
    tokens.push(words);
    perPublisher.set(pKey, (perPublisher.get(pKey) ?? 0) + 1);
    added += 1;
  }
  return added;
}

async function runChain(country: NewsCountry): Promise<NewsResponse> {
  const articles: NewsArticle[] = [];
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
    // A title that names the country only in a list of places goes after the others.
    const named = found.filter((a) => !listsCountry(a.title, country.name));
    const listed = found.filter((a) => listsCountry(a.title, country.name));
    const added = addDistinct(articles, [...named, ...listed], MAX_ARTICLES, country.name);
    if (added > 0) count.set(p.name, (count.get(p.name) ?? 0) + added);
  }

  // Newest first, so the ages in the numbered list go in order. Stories with no date go last.
  const time = (a: NewsArticle) => (a.publishedAt ? Date.parse(a.publishedAt) : -Infinity);
  articles.sort((a, b) => time(b) - time(a));

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
