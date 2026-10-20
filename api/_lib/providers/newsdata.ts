// NewsData.io. Used only when NEWSDATA_API_KEY is set. Each call costs one credit.
import type { NewsArticle } from '../../../src/types';
import { getJson } from '../fetch.js';
import { cleanText, safeUrl, titleKey, toIso } from '../text.js';
import { UpstreamError, type NewsCountry, type Provider } from './types.js';

const BASE = 'https://newsdata.io/api/1/latest';

interface NewsDataResult {
  title?: unknown;
  link?: unknown;
  source_name?: unknown;
  source_id?: unknown;
  pubDate?: unknown;
  image_url?: unknown;
  duplicate?: unknown;
}

function apiKey(): string | undefined {
  const key = process.env.NEWSDATA_API_KEY?.trim();
  return key ? key : undefined;
}

/** NewsData gives "2026-10-20 06:15:00" in UTC. */
function pubDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  return toIso(iso);
}

async function call(params: Record<string, string>, signal: AbortSignal): Promise<NewsArticle[]> {
  const key = apiKey();
  if (!key) return [];
  const search = new URLSearchParams({ apikey: key, language: 'en', size: '10', removeduplicate: '1', ...params });
  const data = (await getJson(`${BASE}?${search}`, signal)) as { status?: unknown; results?: unknown };
  if (data.status !== 'success') throw new UpstreamError('status not success');
  if (!Array.isArray(data.results)) return [];
  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  for (const raw of data.results as NewsDataResult[]) {
    if (raw.duplicate === true) continue;
    const url = safeUrl(raw.link);
    const title = cleanText(raw.title, 300);
    if (!url || !title) continue;
    const key = titleKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push({
      title,
      url,
      source: cleanText(raw.source_name, 80) || cleanText(raw.source_id, 80) || new URL(url).hostname,
      publishedAt: pubDate(raw.pubDate),
      imageUrl: safeUrl(raw.image_url),
    });
  }
  return articles;
}

export const newsdata: Provider = {
  name: 'newsdata',
  enabled: () => apiKey() !== undefined,
  async fetchTop(country: NewsCountry, limit: number, signal: AbortSignal) {
    let articles: NewsArticle[] = [];
    if (country.iso2) {
      // An unknown country code gives an error status; the name query below covers it.
      try {
        articles = await call({ country: country.iso2.toLowerCase(), prioritydomain: 'top' }, signal);
      } catch (err) {
        if (signal.aborted) throw err;
      }
    }
    if (articles.length === 0) {
      articles = await call({ q: `"${country.name}"` }, signal);
    }
    return articles.slice(0, limit * 2);
  },
};
