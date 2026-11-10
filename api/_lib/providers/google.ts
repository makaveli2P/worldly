// Google News RSS. No key. The feed terms allow personal, non-commercial use (see README "Data sources and terms").
import { isPlatform, publisherHost } from '../domain.js';
import type { Edition } from '../editions.js';
import { getTextAt } from '../fetch.js';
import { parseRssItems } from '../rss.js';
import { cleanText, guessLang, safeUrl, tidySource, tidyTitle, toIso } from '../text.js';
import { UpstreamError, type Candidate, type Feed } from './types.js';

const BASE = 'https://news.google.com/rss';
const query = (e: Edition) => `hl=${e.hl}&gl=${e.gl}&ceid=${e.ceid}`;

// The NATION section URL answers 302 to /rss/topics/<id>. The redirect costs 0.2-1.2 s and the
// direct URL 0.1 s, so keep the final URL for each edition.
const resolvedNation = new Map<string, string>();

/** Google appends " - Publisher" to every title. Removes it, and returns the clean title and publisher. */
export function splitTitle(rawTitle: string, rawSource: string): { title: string; source: string } {
  let title = cleanText(rawTitle, 400);
  let source = cleanText(rawSource, 400);
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
  source = tidySource(source);
  return { title: tidyTitle(cleanText(title, 300), source), source: cleanText(source, 80) };
}

/**
 * Parses a Google News feed into candidates. Keeps the feed order as the rank.
 * `lang` is the language of the edition; for an English feed, each title gets a language guess,
 * so that a Somali or Spanish title in the English search carries its language tag.
 * Posts from social and aggregator platforms (Facebook, NewsBreak, ...) are dropped.
 */
export function toCandidates(xml: string, feed: Feed, lang: string | null): Candidate[] {
  const out: Candidate[] = [];
  for (const item of parseRssItems(xml, 100)) {
    const url = safeUrl(item.link);
    const { title, source } = splitTitle(item.title, item.source);
    if (!url || !title) continue;
    // The link is a news.google.com redirect. The <source url> attribute names the publisher.
    const domain = publisherHost(item.sourceUrl, url);
    if (isPlatform(domain, source)) continue;
    const outlets = item.outlets.map((o) => tidySource(cleanText(o, 80))).filter(Boolean);
    out.push({
      title,
      url,
      source: source || 'Google News',
      domain,
      publishedAt: toIso(item.pubDate),
      imageUrl: null,
      feed,
      rank: feed === 'search' ? null : item.rank,
      outlets: outlets.length > 0 ? outlets : source ? [source] : [],
      lang: lang ?? guessLang(title),
    });
  }
  return out;
}

function checkRss(xml: string): void {
  if (!/<rss[\s>]/i.test(xml)) throw new UpstreamError('not rss');
}

const langOf = (e: Edition) => (e.lang === 'en' ? null : e.lang);

/** The national stories of one edition (NATION topic), in Google's order. */
export async function nation(edition: Edition, signal: AbortSignal, timeoutMs: number): Promise<Candidate[]> {
  const key = edition.ceid;
  const url = resolvedNation.get(key) ?? `${BASE}/headlines/section/topic/NATION?${query(edition)}`;
  let res: { text: string; url: string };
  try {
    res = await getTextAt(url, signal, timeoutMs);
    checkRss(res.text);
  } catch (err) {
    // The kept topic URL can go stale. Start from the section URL next time.
    resolvedNation.delete(key);
    throw err;
  }
  // A silent fallback to another edition shows in the final URL.
  let finalCeid: string | null = null;
  try {
    finalCeid = new URL(res.url).searchParams.get('ceid');
  } catch {
    // Keep null: no check is possible.
  }
  if (finalCeid && finalCeid !== edition.ceid) throw new UpstreamError('edition fallback');
  if (res.url.includes('/rss/topics/')) resolvedNation.set(key, res.url);
  return toCandidates(res.text, 'nation', langOf(edition));
}

/** The front page of one edition (Top stories). Only a "front page" signal. */
export async function top(edition: Edition, signal: AbortSignal, timeoutMs: number): Promise<Candidate[]> {
  const res = await getTextAt(`${BASE}?${query(edition)}`, signal, timeoutMs);
  checkRss(res.text);
  return toCandidates(res.text, 'top', langOf(edition));
}

/**
 * English search in the last `days` days (US edition). Up to 100 items. `query` is the whole search
 * expression, for example `"Germany"` or `"Georgia" (Tbilisi OR Georgian)`.
 */
export async function search(query: string, days: number, signal: AbortSignal, timeoutMs: number): Promise<Candidate[]> {
  const q = encodeURIComponent(query);
  const res = await getTextAt(`${BASE}/search?q=${q}+when:${days}d&hl=en-US&gl=US&ceid=US:en`, signal, timeoutMs);
  checkRss(res.text);
  return toCandidates(res.text, 'search', null);
}
