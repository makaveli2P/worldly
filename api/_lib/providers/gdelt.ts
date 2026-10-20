// GDELT DOC 2.0. No key. It allows one request per 5 s and often answers 429.
import type { NewsArticle } from '../../../src/types';
import { getJson } from '../fetch.js';
import { cleanText, safeUrl } from '../text.js';
import { UpstreamError, type NewsCountry, type Provider } from './types.js';

// GDELT is a last resort. Keep its wait short, and stop asking for a while after a 429.
const TIMEOUT_MS = 2000;
const COOLDOWN_MS = 2 * 60 * 1000;
let blockedUntil = 0;

interface GdeltArticle {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  socialimage?: unknown;
  domain?: unknown;
}

/** "20261020T061500Z" -> "2026-10-20T06:15:00.000Z" */
function seenDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const time = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export const gdelt: Provider = {
  name: 'gdelt',
  enabled: () => true,
  async fetchTop(country: NewsCountry, limit: number, signal: AbortSignal) {
    const query = encodeURIComponent(`"${country.name}" sourcelang:english`);
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${query}&mode=artlist&maxrecords=${Math.min(25, limit * 2)}&format=json&sort=hybridrel&timespan=2d`;
    if (Date.now() < blockedUntil) throw new UpstreamError('cooling down');
    let data: unknown;
    try {
      data = await getJson(url, signal, TIMEOUT_MS);
    } catch (err) {
      if (err instanceof UpstreamError && (err.message === 'http 429' || err.message === 'timeout')) {
        blockedUntil = Date.now() + COOLDOWN_MS;
      }
      throw err;
    }
    const list = (data as { articles?: unknown }).articles;
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new UpstreamError('unexpected shape');
    const articles: NewsArticle[] = [];
    for (const raw of list as GdeltArticle[]) {
      const link = safeUrl(raw.url);
      const title = cleanText(raw.title, 300);
      if (!link || !title) continue;
      articles.push({
        title,
        url: link,
        source: cleanText(raw.domain, 80) || new URL(link).hostname.replace(/^www\./, ''),
        publishedAt: seenDate(raw.seendate),
        imageUrl: safeUrl(raw.socialimage),
      });
    }
    return articles;
  },
};
