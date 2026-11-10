// NewsData.io. Used only when NEWSDATA_API_KEY is set, and only as a fallback. Each call costs one credit.
// The free plan delays data by 12 hours, so a result stays in memory for 6 hours.
import { publisherHost } from '../domain.js';
import { getJson } from '../fetch.js';
import { cleanText, isPressRelease, namesCountry, safeUrl, tidySource, tidyTitle, titleKey, toIso } from '../text.js';
import { UpstreamError, type Candidate, type NewsCountry } from './types.js';

const BASE = 'https://newsdata.io/api/1/latest';

interface NewsDataResult {
  title?: unknown;
  link?: unknown;
  source_name?: unknown;
  source_id?: unknown;
  pubDate?: unknown;
  image_url?: unknown;
  duplicate?: unknown;
  source_url?: unknown;
  source_priority?: unknown;
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

/** True when NEWSDATA_API_KEY is set. */
export function newsdataEnabled(): boolean {
  return apiKey() !== undefined;
}

/**
 * One call with the country name in the title (qInTitle), English, the top 10% of domains,
 * and no sport, entertainment or lifestyle. The `country` filter is not used: it matches the
 * publisher's country, not the subject.
 */
async function call(country: NewsCountry, signal: AbortSignal, timeoutMs: number): Promise<Candidate[]> {
  const key = apiKey();
  if (!key) return [];
  // With NEWS_DEBUG=1, one line per call, so credit use shows in the logs. The key and the URL stay out.
  if (process.env.NEWS_DEBUG === '1') console.info(`[news] newsdata call for ${country.id}`);
  const search = new URLSearchParams({
    apikey: key,
    qInTitle: `"${country.name}"`,
    language: 'en',
    prioritydomain: 'top',
    excludecategory: 'sports,entertainment,lifestyle',
    removeduplicate: '1',
    size: '10',
  });
  const data = (await getJson(`${BASE}?${search}`, signal, timeoutMs)) as { status?: unknown; results?: unknown };
  if (data.status !== 'success') throw new UpstreamError('status not success');
  if (!Array.isArray(data.results)) return [];
  const seen = new Set<string>();
  const articles: Candidate[] = [];
  for (const raw of data.results as NewsDataResult[]) {
    if (raw.duplicate === true) continue;
    const url = safeUrl(raw.link);
    let title = cleanText(raw.title, 300);
    if (!url || !title) continue;
    let source = tidySource(publisherName(cleanText(raw.source_id, 80), cleanText(raw.source_name, 80), url));
    // NewsData also indexes Google News, whose titles end in " - Publisher".
    const dash = title.lastIndexOf(' - ');
    if (/^google news$/i.test(source) && dash > 0) {
      source = cleanText(title.slice(dash + 3), 80) || source;
      title = title.slice(0, dash).trim();
    }
    title = tidyTitle(title, source);
    if (isPressRelease(url, source) || !namesCountry(title, country.name)) continue;
    const key = titleKey(title);
    if (seen.has(key)) continue;
    seen.add(key);
    const priority = typeof raw.source_priority === 'number' ? raw.source_priority : undefined;
    articles.push({
      title,
      url,
      source,
      // source_url can be https://news.google.com for an item that NewsData took from Google News.
      domain: publisherHost(raw.source_url, url),
      publishedAt: pubDate(raw.pubDate),
      imageUrl: safeUrl(raw.image_url),
      feed: 'newsdata',
      rank: null,
      outlets: [source],
      lang: null,
      ...(priority !== undefined ? { priority } : {}),
    });
  }
  return articles;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { expires: number; value: Promise<Candidate[]> }>();

/** The NewsData result in memory for a country, when it is fresh. Costs no credit. */
export function newsdataCached(country: NewsCountry): Promise<Candidate[]> | null {
  const hit = cache.get(country.id);
  return hit && hit.expires > Date.now() ? hit.value : null;
}

/**
 * NewsData stories for a country. A result stays in memory for 6 hours, because the data is 12 hours late.
 * The call has its own timeout and does not depend on the caller, so a caller that stops waiting
 * does not waste the credit: the next request for the country gets the result from memory.
 */
export function newsdata(country: NewsCountry, timeoutMs: number): Promise<Candidate[]> {
  if (!newsdataEnabled()) return Promise.resolve([]);
  const now = Date.now();
  const hit = cache.get(country.id);
  if (hit && hit.expires > now) return hit.value;
  const entry = { expires: now + CACHE_TTL_MS, value: call(country, AbortSignal.timeout(timeoutMs), timeoutMs) };
  cache.set(country.id, entry);
  entry.value.catch(() => {
    entry.expires = Date.now() + FAILURE_TTL_MS;
  });
  if (cache.size > 300) {
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  }
  return entry.value;
}
