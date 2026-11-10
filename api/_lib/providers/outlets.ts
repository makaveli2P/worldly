// Front-page RSS feeds of international outlets. No key. One fetch serves every country for 10 minutes.
// Each outlet's own terms apply (see README "Data sources and terms").
import { publisherHost } from '../domain.js';
import { getText } from '../fetch.js';
import { parseRssItems } from '../rss.js';
import { cleanText, safeUrl, toIso } from '../text.js';
import type { Candidate } from './types.js';

export interface OutletFeed {
  source: string;
  domain: string;
  url: string;
}

// Tested 2026-11-10: each feed answered 200 with RSS 2.0 items. NHK has no working English feed.
export const OUTLET_FEEDS: readonly OutletFeed[] = [
  { source: 'BBC News', domain: 'bbc.com', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { source: 'BBC News', domain: 'bbc.com', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { source: 'Al Jazeera', domain: 'aljazeera.com', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { source: 'The Guardian', domain: 'theguardian.com', url: 'https://www.theguardian.com/world/rss' },
  { source: 'France 24', domain: 'france24.com', url: 'https://www.france24.com/en/rss' },
  { source: 'DW', domain: 'dw.com', url: 'https://rss.dw.com/xml/rss-en-world' },
  { source: 'NPR', domain: 'npr.org', url: 'https://feeds.npr.org/1004/rss.xml' },
  { source: 'Sky News', domain: 'news.sky.com', url: 'https://feeds.skynews.com/feeds/rss/world.xml' },
  { source: 'ABC News (Australia)', domain: 'abc.net.au', url: 'https://www.abc.net.au/news/feed/45910/rss.xml' },
  { source: 'CBC News', domain: 'cbc.ca', url: 'https://www.cbc.ca/webfeed/rss/rss-world' },
  { source: 'The Times of India', domain: 'timesofindia.indiatimes.com', url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms' },
  { source: 'The New York Times', domain: 'nytimes.com', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml' },
];

const TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;

interface Bundle {
  expires: number;
  value: Promise<Candidate[]>;
}

let bundle: Bundle | null = null;

/** Parses one outlet feed. The outlet is the publisher of every item. */
export function outletCandidates(xml: string, feed: OutletFeed): Candidate[] {
  const out: Candidate[] = [];
  for (const item of parseRssItems(xml, 100)) {
    const url = safeUrl(item.link.trim());
    const title = cleanText(item.title, 300);
    if (!url || !title) continue;
    out.push({
      title,
      url,
      source: feed.source,
      domain: publisherHost(url) ?? feed.domain,
      publishedAt: toIso(item.pubDate),
      imageUrl: null,
      feed: 'outlet',
      rank: null,
      outlets: [feed.source],
      lang: null,
    });
  }
  return out;
}

async function fetchAll(timeoutMs: number): Promise<Candidate[]> {
  const results = await Promise.allSettled(
    OUTLET_FEEDS.map(async (f) => outletCandidates(await getText(f.url, AbortSignal.timeout(timeoutMs), timeoutMs), f)),
  );
  const ok = results.filter((r): r is PromiseFulfilledResult<Candidate[]> => r.status === 'fulfilled');
  const failed = results.length - ok.length;
  if (failed > 0) console.warn(`[news] outlet feeds: ${failed} of ${results.length} failed`);
  return ok.flatMap((r) => r.value);
}

/**
 * Every item of every outlet feed. The fetch runs at most once per 10 minutes, and parallel calls share it.
 * The fetch does not depend on the caller's signal, so one aborted request does not spoil it for the others.
 */
export function outletItems(timeoutMs: number): Promise<Candidate[]> {
  const now = Date.now();
  if (bundle && bundle.expires > now) return bundle.value;
  const entry: Bundle = { expires: now + TTL_MS, value: fetchAll(timeoutMs) };
  bundle = entry;
  entry.value.then(
    (items) => {
      if (items.length === 0) entry.expires = Date.now() + FAILURE_TTL_MS;
    },
    () => {
      entry.expires = 0;
    },
  );
  return entry.value;
}
