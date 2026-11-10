// Upstream sources of the breaking-news detector: outlet front pages, Google News editions,
// Wikipedia "In the news", GDACS and USGS. All requests run in parallel with a short timeout.
import { parseRssItems } from '../rss.js';
import { cleanText, safeUrl, toIso } from '../text.js';
import { primaryCountries } from './match.js';
import type { BreakingInputs, FeedKind, Hazard, HazardLevel, HazardType, Headline, Itn } from './types.js';

export interface FeedSource {
  id: string;
  kind: FeedKind;
  publisher: string | null; // null for Google News: each item names its outlet
  edition: string | null;
  url: string;
}

const GN_EDITIONS = ['US', 'GB', 'IN', 'AU', 'CA', 'ZA', 'SG'];

/** 16 outlet front pages (12 outlets) and 8 Google News editions (tested 2026-11-10). */
export const FEEDS: FeedSource[] = [
  { id: 'bbc_top', kind: 'front', publisher: 'BBC News', edition: null, url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { id: 'bbc_world', kind: 'front', publisher: 'BBC News', edition: null, url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 'aljazeera', kind: 'front', publisher: 'Al Jazeera', edition: null, url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'guardian_world', kind: 'front', publisher: 'The Guardian', edition: null, url: 'https://www.theguardian.com/world/rss' },
  { id: 'france24', kind: 'front', publisher: 'France 24', edition: null, url: 'https://www.france24.com/en/rss' },
  { id: 'dw_world', kind: 'front', publisher: 'DW', edition: null, url: 'https://rss.dw.com/xml/rss-en-world' },
  { id: 'npr_top', kind: 'front', publisher: 'NPR', edition: null, url: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 'npr_world', kind: 'front', publisher: 'NPR', edition: null, url: 'https://feeds.npr.org/1004/rss.xml' },
  { id: 'sky_home', kind: 'front', publisher: 'Sky News', edition: null, url: 'https://feeds.skynews.com/feeds/rss/home.xml' },
  { id: 'sky_world', kind: 'front', publisher: 'Sky News', edition: null, url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
  { id: 'abc_au_top', kind: 'front', publisher: 'ABC News (Australia)', edition: null, url: 'https://www.abc.net.au/news/feed/45910/rss.xml' },
  { id: 'cbc_top', kind: 'front', publisher: 'CBC News', edition: null, url: 'https://www.cbc.ca/webfeed/rss/rss-topstories' },
  { id: 'cbc_world', kind: 'front', publisher: 'CBC News', edition: null, url: 'https://www.cbc.ca/webfeed/rss/rss-world' },
  { id: 'toi_world', kind: 'front', publisher: 'The Times of India', edition: null, url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms' },
  { id: 'nyt_world', kind: 'front', publisher: 'The New York Times', edition: null, url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
  // euronews.com/rss answers 406 to a server; the FeedBurner copy works (tested 2026-11-10).
  { id: 'euronews', kind: 'front', publisher: 'Euronews', edition: null, url: 'https://feeds.feedburner.com/euronews/en/home/' },
  { id: 'gn_world', kind: 'gn', publisher: null, edition: 'WORLD', url: 'https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en' },
  ...GN_EDITIONS.map((cc): FeedSource => ({
    id: `gn_top_${cc.toLowerCase()}`,
    kind: 'gn',
    publisher: null,
    edition: cc,
    url: `https://news.google.com/rss?hl=en-${cc}&gl=${cc}&ceid=${cc}:en`,
  })),
];

export const ITN_URL =
  'https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content|timestamp&rvslots=main&titles=Template:In_the_news&format=json&formatversion=2';
export const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson';

/** GDACS orange and red events of the last 4 days. Never add "TS" to the list: it removes events. */
export function gdacsUrl(now: number): string {
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=orange;red&eventlist=EQ;TC;FL;VO&fromDate=${day(now - 4 * 864e5)}&toDate=${day(now + 864e5)}`;
}

export const SOURCE_COUNT = FEEDS.length + 3;
export const REQUEST_TIMEOUT_MS = 2500;
export const TOTAL_BUDGET_MS = 6000;
const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; Worldly/0.2)';

// ---------------------------------------------------------------- parsing

/** Google News appends " - Publisher" to each title. Returns the title and the publisher. */
export function splitGoogleTitle(rawTitle: string, rawSource: string): { title: string; publisher: string } {
  let title = rawTitle;
  let source = rawSource;
  // "ABC News - Breaking News, Latest News and Videos" becomes "ABC News".
  if (source.includes(' - ') && !title.toLowerCase().endsWith(` - ${source.toLowerCase()}`)) source = source.slice(0, source.indexOf(' - ')).trim();
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
  return { title, publisher: source || 'Google News' };
}

/** RSS items of one feed, in feed order, with the position (1 = top). */
export function parseFeed(src: FeedSource, xml: string, max = 40): Headline[] {
  const out: Headline[] = [];
  parseRssItems(xml, max).forEach((item, i) => {
    let title = cleanText(item.title, 400);
    const url = safeUrl(item.link);
    if (!title || !url) return;
    let publisher = src.publisher ?? '';
    if (src.kind === 'gn') ({ title, publisher } = splitGoogleTitle(title, cleanText(item.source, 120)));
    out.push({ feed: src.id, kind: src.kind, edition: src.edition, position: i + 1, title, publisher, url, publishedAt: toIso(cleanText(item.pubDate, 80)) });
  });
  return out;
}

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** Template:In_the_news wikitext: the blurbs with their date comment, and the "Ongoing" list. */
export function parseItn(json: unknown, now: number): Itn | null {
  const rev = (json as { query?: { pages?: { revisions?: { slots?: { main?: { content?: string } } }[] }[] } })?.query?.pages?.[0]?.revisions?.[0];
  const wikitext = rev?.slots?.main?.content;
  if (typeof wikitext !== 'string' || !wikitext) return null;
  const plain = (s: string) =>
    s
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\{\{nowrap\|([^}]*)\}\}/gi, '$1')
      .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
      .replace(/'''?|''/g, '')
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const year = new Date(now).getUTCFullYear();
  const [main, rest = ''] = wikitext.split('{{In the news/footer');
  const blurbs = [];
  for (const line of main.split('\n')) {
    const m = line.match(/^\*\s*<!--\s*([A-Z][a-z]{2})\w*\s+(\d{1,2})\s*-->(.*)$/);
    if (!m || MONTHS[m[1]] === undefined) continue;
    // The comment has no year: a date more than a day in the future is from last year.
    let date = Date.UTC(year, MONTHS[m[1]], Number(m[2]));
    if (date > now + 864e5) date = Date.UTC(year - 1, MONTHS[m[1]], Number(m[2]));
    blurbs.push({ text: plain(m[3]), date: new Date(date).toISOString() });
  }
  const ongoingBlock = rest.split('|recentdeaths')[0];
  const ongoing = [...ongoingBlock.matchAll(/^\*(?!\*)\s*(?:<!--[^>]*-->)?\s*\[\[([^|\]]*)(?:\|([^\]]*))?\]\]/gm)].map((m) => m[2] || m[1]);
  return { blurbs, ongoing };
}

const LEVELS = new Set(['green', 'yellow', 'orange', 'red']);
const asLevel = (v: unknown): HazardLevel | null => {
  const s = String(v ?? '').toLowerCase();
  return LEVELS.has(s) ? (s as HazardLevel) : null;
};

interface GdacsProps {
  eventtype?: string;
  episodealertlevel?: string;
  alertlevel?: string;
  iso3?: string;
  affectedcountries?: { iso3?: string }[];
  name?: string;
  fromdate?: string;
  todate?: string;
  url?: { report?: string };
}

/** GDACS events. The level is the current episode level, and the countries are all affected countries. */
export function parseGdacs(json: unknown): Hazard[] {
  const features = (json as { features?: { properties?: GdacsProps }[] })?.features ?? [];
  const out: Hazard[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    if (!['EQ', 'TC', 'FL', 'VO'].includes(p.eventtype ?? '')) continue;
    const affected = (p.affectedcountries ?? []).map((c) => c.iso3).filter((x): x is string => !!x);
    const countries = affected.length ? affected : p.iso3 ? [p.iso3] : [];
    const zone = (d?: string) => (d ? (/[zZ]|[+-]\d\d:?\d\d$/.test(d) ? d : `${d}Z`) : '');
    out.push({
      source: 'gdacs',
      type: p.eventtype as HazardType,
      level: asLevel(p.episodealertlevel ?? p.alertlevel),
      countries,
      name: cleanText(p.name, 120),
      from: toIso(zone(p.fromdate)) ?? '',
      to: toIso(zone(p.todate)) ?? '',
      url: safeUrl(p.url?.report),
      magnitude: null,
    });
  }
  return out;
}

interface UsgsProps {
  mag?: number;
  place?: string;
  time?: number;
  alert?: string | null;
  url?: string;
}

/** USGS significant earthquakes of the week. The country comes from the place text. */
export function parseUsgs(json: unknown): Hazard[] {
  const features = (json as { features?: { properties?: UsgsProps }[] })?.features ?? [];
  const out: Hazard[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    if (typeof p.time !== 'number') continue;
    const place = cleanText(p.place, 160);
    const at = new Date(p.time).toISOString();
    out.push({
      source: 'usgs',
      type: 'EQ',
      level: asLevel(p.alert),
      countries: primaryCountries(place.replace(/^.*?\bof\s+(?:the\s+)?/, '')),
      name: `M${p.mag} earthquake, ${place}`,
      from: at,
      to: at,
      url: safeUrl(p.url),
      magnitude: typeof p.mag === 'number' ? p.mag : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- fetching

export interface SourceStatus {
  id: string;
  ok: boolean;
  status: string; // "200", "http 404", "timeout"
  ms: number;
  items: number;
}

export interface FetchOptions {
  userAgent?: string;
  contact?: string; // added to the Wikipedia User-Agent (Wikimedia asks for contact details)
  fetchImpl?: typeof fetch;
}

async function getText(url: string, parent: AbortSignal, userAgent: string, fetchImpl: typeof fetch): Promise<{ text: string; status: string; ms: number }> {
  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.any([parent, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      redirect: 'follow',
      headers: { 'user-agent': userAgent, accept: 'application/rss+xml, application/xml;q=0.9, application/json;q=0.9, */*;q=0.5' },
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    throw Object.assign(new Error(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error'), { ms: Date.now() - t0 });
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw Object.assign(new Error(`http ${response.status}`), { ms: Date.now() - t0 });
  }
  // GDACS answers 204 with no body when no event matches.
  const text = response.status === 204 ? '' : await response.text();
  return { text, status: String(response.status), ms: Date.now() - t0 };
}

const parseJson = (text: string): unknown => (text ? JSON.parse(text) : {});

/** Fetches every source in parallel and parses the answers. A failed source gives no items. */
export async function fetchInputs(now: number, options: FetchOptions = {}): Promise<{ inputs: BreakingInputs; status: SourceStatus[] }> {
  const userAgent = options.userAgent || DEFAULT_USER_AGENT;
  const wikiAgent = options.contact ? `${userAgent} (${options.contact})` : userAgent;
  const fetchImpl = options.fetchImpl ?? fetch;
  const budget = AbortSignal.timeout(TOTAL_BUDGET_MS);

  const jobs: { id: string; url: string; agent: string; parse: (text: string) => { value: unknown; items: number } }[] = [
    ...FEEDS.map((src) => ({
      id: src.id,
      url: src.url,
      agent: userAgent,
      parse: (text: string) => {
        if (!/<(?:rss|rdf:RDF|feed)[\s>]/i.test(text)) throw new Error('not rss');
        const items = parseFeed(src, text);
        return { value: items, items: items.length };
      },
    })),
    {
      id: 'itn',
      url: ITN_URL,
      agent: wikiAgent,
      parse: (text: string) => {
        const itn = parseItn(parseJson(text), now);
        if (!itn) throw new Error('no itn');
        return { value: itn, items: itn.blurbs.length };
      },
    },
    { id: 'gdacs', url: gdacsUrl(now), agent: userAgent, parse: (text: string) => { const v = parseGdacs(parseJson(text)); return { value: v, items: v.length }; } },
    { id: 'usgs', url: USGS_URL, agent: userAgent, parse: (text: string) => { const v = parseUsgs(parseJson(text)); return { value: v, items: v.length }; } },
  ];

  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      const r = await getText(job.url, budget, job.agent, fetchImpl);
      try {
        return { ...job.parse(r.text), status: r.status, ms: r.ms };
      } catch (err) {
        throw Object.assign(new Error(err instanceof Error ? err.message : 'parse error'), { ms: r.ms });
      }
    }),
  );

  const headlines: Headline[] = [];
  const hazards: Hazard[] = [];
  let itn: Itn | null = null;
  const status: SourceStatus[] = [];
  settled.forEach((s, i) => {
    const id = jobs[i].id;
    if (s.status === 'rejected') {
      const err = s.reason as Error & { ms?: number };
      status.push({ id, ok: false, status: err?.message ?? 'error', ms: err?.ms ?? 0, items: 0 });
      return;
    }
    status.push({ id, ok: true, status: s.value.status, ms: s.value.ms, items: s.value.items });
    if (id === 'itn') itn = s.value.value as Itn;
    else if (id === 'gdacs' || id === 'usgs') hazards.push(...(s.value.value as Hazard[]));
    else headlines.push(...(s.value.value as Headline[]));
  });
  const ok = status.filter((s) => s.ok).length;
  return { inputs: { headlines, itn, hazards, now, sources: { ok, total: jobs.length } }, status };
}
