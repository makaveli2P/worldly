// NewsData.io. Used only when NEWSDATA_API_KEY is set. Each call costs one credit.
import type { NewsArticle } from '../../../src/types';
import { getJson } from '../fetch.js';
import { cleanText, isPressRelease, namesCountry, safeUrl, titleKey, toIso } from '../text.js';
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

// Proper names for publishers whose NewsData source_name is a raw id or misspelt ("Brietbart", "Skynew").
// Keys are the source_id, the source_name or the host name, lowercase with no punctuation.
const PUBLISHERS: Record<string, string> = {
  bbc: 'BBC',
  bbcnews: 'BBC News',
  ndtv: 'NDTV',
  upi: 'UPI',
  rt: 'RT',
  sky: 'Sky News',
  skynew: 'Sky News',
  skynews: 'Sky News',
  breitbart: 'Breitbart',
  brietbart: 'Breitbart',
  usatoday: 'USA Today',
  scientificamerican: 'Scientific American',
  livescience: 'Live Science',
  cookislandsnews: 'Cook Islands News',
  neweralive: 'New Era',
  fbcnews: 'FBC News',
  cnn: 'CNN',
  cnbc: 'CNBC',
  abcnews: 'ABC News',
  nbcnews: 'NBC News',
  cbsnews: 'CBS News',
  ctvnews: 'CTV News',
  cbc: 'CBC',
  npr: 'NPR',
  ap: 'AP',
  apnews: 'AP',
  afp: 'AFP',
  dw: 'DW',
  ft: 'Financial Times',
  wsj: 'The Wall Street Journal',
  nytimes: 'The New York Times',
  washingtonpost: 'The Washington Post',
  theguardian: 'The Guardian',
  aljazeera: 'Al Jazeera',
  yahoo: 'Yahoo News',
  foxnews: 'Fox News',
  newsweek: 'Newsweek',
  euronews: 'Euronews',
  scmp: 'South China Morning Post',
  japantimes: 'The Japan Times',
  timesofindia: 'The Times of India',
  hindustantimes: 'Hindustan Times',
  indiatoday: 'India Today',
  abc: 'ABC',
  abcau: 'ABC News (Australia)',
  rnz: 'RNZ',
  nzherald: 'NZ Herald',
};

const SHORT_WORDS = new Set(['fox', 'sun', 'age', 'hill', 'mint', 'axe', 'cut', 'big']);

const pubKey = (s: string) => s.toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9]/g, '');

/** A proper publisher name: the map first, then source_name, with short acronyms in capitals ("Upi" -> "UPI"). */
function publisherName(sourceId: string, sourceName: string, url: string): string {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // Keep the empty host.
  }
  const hostKey = host.replace(/\.(?:com|co|net|org|news|in|uk|au|ca|nz|jp)(?:\.[a-z]{2})?$/, '');
  for (const k of [sourceId, sourceName, hostKey, host.split('.').slice(-2, -1)[0] ?? '']) {
    const name = k ? PUBLISHERS[pubKey(k)] : undefined;
    if (name) return name;
  }
  const name = sourceName || sourceId || host;
  // A single short word is an acronym: "Upi", "Rt". Real short words stay as they are.
  return /^[A-Za-z]{2,3}$/.test(name) && !SHORT_WORDS.has(name.toLowerCase()) ? name.toUpperCase() : name;
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

async function call(country: NewsCountry, params: Record<string, string>, signal: AbortSignal): Promise<NewsArticle[]> {
  const key = apiKey();
  if (!key) return [];
  // One line per call, so credit use shows in the logs. The key and the URL stay out.
  console.info(`[news] newsdata call: ${Object.keys(params).sort().join('+')}`);
  const search = new URLSearchParams({ apikey: key, language: 'en', size: '10', removeduplicate: '1', ...params });
  const data = (await getJson(`${BASE}?${search}`, signal)) as { status?: unknown; results?: unknown };
  if (data.status !== 'success') throw new UpstreamError('status not success');
  if (!Array.isArray(data.results)) return [];
  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  for (const raw of data.results as NewsDataResult[]) {
    if (raw.duplicate === true) continue;
    const url = safeUrl(raw.link);
    let title = cleanText(raw.title, 300);
    if (!url || !title) continue;
    let source = publisherName(cleanText(raw.source_id, 80), cleanText(raw.source_name, 80), url);
    // NewsData also indexes Google News, whose titles end in " - Publisher".
    const dash = title.lastIndexOf(' - ');
    if (/^google news$/i.test(source) && dash > 0) {
      source = cleanText(title.slice(dash + 3), 80) || source;
      title = title.slice(0, dash).trim();
    }
    if (isPressRelease(url, source) || !namesCountry(title, country.name)) continue;
    const key = titleKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push({
      title,
      url,
      source,
      publishedAt: pubDate(raw.pubDate),
      imageUrl: safeUrl(raw.image_url),
    });
  }
  return articles;
}

// Fewer stories than this from the first call starts a second call (one more credit).
const MIN_FROM_FIRST_CALL = 3;

/**
 * Two calls at most, both with the country name in the title (qInTitle):
 * 1. Only the top 10% of domains (prioritydomain=top).
 * 2. When call 1 gives fewer than 3 stories: all domains.
 * The country filter is not used. It matches the publisher's country, not the subject,
 * so `country=cn` gave stories about other topics from Asian outlets.
 */
export const newsdata: Provider = {
  name: 'newsdata',
  enabled: () => apiKey() !== undefined,
  async fetchTop(country: NewsCountry, limit: number, signal: AbortSignal) {
    const qInTitle = `"${country.name}"`;
    let articles = await call(country, { qInTitle, prioritydomain: 'top' }, signal);
    if (articles.length < MIN_FROM_FIRST_CALL) {
      try {
        const more = await call(country, { qInTitle }, signal);
        articles = [...articles, ...more];
      } catch (err) {
        if (articles.length === 0) throw err;
      }
    }
    return articles.slice(0, limit * 3);
  },
};
