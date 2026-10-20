// Google News RSS. No key. The feed terms allow personal, non-commercial use.
import type { NewsArticle } from '../../../src/types';
import { getText } from '../fetch.js';
import { parseRssItems } from '../rss.js';
import { cleanText, mentions, safeUrl, toIso } from '../text.js';
import { UpstreamError, type NewsCountry, type Provider } from './types.js';

// Countries with an English Google News edition (tested 2026-10).
// Other codes silently fall back to the US edition, so they use the search feed.
const ENGLISH_EDITIONS = new Set([
  'AU', 'BW', 'CA', 'ET', 'GB', 'GH', 'IE', 'IL', 'IN', 'KE', 'MY', 'NA', 'NG',
  'NZ', 'PH', 'PK', 'SG', 'TZ', 'UG', 'US', 'ZA', 'ZW',
]);

// The NATION topic holds domestic stories. The plain edition feed mixes in world news.
function editionUrl(cc: string): string {
  return `https://news.google.com/rss/headlines/section/topic/NATION?hl=en-${cc}&gl=${cc}&ceid=${cc}:en`;
}

function searchUrl(name: string): string {
  const q = encodeURIComponent(`"${name}"`);
  return `https://news.google.com/rss/search?q=${q}+when:3d&hl=en-US&gl=US&ceid=US:en`;
}

function toArticles(xml: string): NewsArticle[] {
  const articles: NewsArticle[] = [];
  for (const item of parseRssItems(xml)) {
    const url = safeUrl(item.link);
    let title = cleanText(item.title, 400);
    const fullSource = cleanText(item.source, 400);
    if (!url || !title) continue;
    // Google appends " - Publisher" to every title. The publisher name can hold " - " itself.
    let source = fullSource;
    if (source && title.toLowerCase().endsWith(` - ${source.toLowerCase()}`)) {
      title = title.slice(0, title.length - source.length - 3).trim();
    } else {
      const dash = title.lastIndexOf(' - ');
      if (dash > 0) {
        const tail = title.slice(dash + 3).trim();
        if (!source) source = tail;
        if (tail.toLowerCase() === source.toLowerCase()) title = title.slice(0, dash).trim();
      }
    }
    // "ABC News - Breaking News, Latest News and Videos" becomes "ABC News".
    if (source.includes(' - ')) source = source.slice(0, source.indexOf(' - ')).trim();
    source = cleanText(source, 80);
    articles.push({
      title: cleanText(title, 300),
      url,
      source: source || 'Google News',
      publishedAt: toIso(item.pubDate),
      imageUrl: null,
    });
  }
  return articles;
}

/**
 * The search feed matches the article body too, so some items do not concern the country.
 * When at least 3 titles name the country, those come first and the rest only fill gaps.
 */
function preferNamed(articles: NewsArticle[], name: string): NewsArticle[] {
  const named = articles.filter((a) => mentions(a.title, name));
  if (named.length < 3) return articles;
  return [...named, ...articles.filter((a) => !named.includes(a))];
}

export const google: Provider = {
  name: 'google',
  enabled: () => true,
  async fetchTop(country: NewsCountry, limit: number, signal: AbortSignal) {
    const cc = country.iso2?.toUpperCase();
    if (cc && ENGLISH_EDITIONS.has(cc)) {
      const articles = toArticles(await getText(editionUrl(cc), signal));
      if (articles.length > 0) return articles.slice(0, limit * 2);
    }
    const xml = await getText(searchUrl(country.name), signal);
    if (!/<rss[\s>]/i.test(xml)) throw new UpstreamError('not rss');
    return preferNamed(toArticles(xml), country.name).slice(0, limit * 2);
  },
};
