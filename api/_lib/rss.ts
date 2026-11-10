// A small RSS 2.0 item parser. It reads only the fields the news list needs.
import { decodeEntities } from './text.js';

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
  /** The url attribute of <source>: the publisher's origin in Google News feeds. Empty when absent. */
  sourceUrl: string;
  /** 1-based position in the feed. Google feeds are in importance order, not in date order. */
  rank: number;
  /**
   * The outlets that Google lists for the same story in <description> (up to 5), in order.
   * Empty for a feed with no such list.
   */
  outlets: string[];
}

function tag(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!match) return '';
  const body = match[1].trim();
  const cdata = body.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : body;
}

/** Outlet names in a Google News <description>: each one is in <font color="#6f6f6f">. */
function descriptionOutlets(description: string): string[] {
  if (!description) return [];
  const html = decodeEntities(description);
  const out: string[] = [];
  for (const m of html.matchAll(/<font color="#6f6f6f">([^<]*)<\/font>/gi)) {
    const name = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
    if (name) out.push(name);
  }
  return out;
}

export function parseRssItems(xml: string, max = 50): RssItem[] {
  const items: RssItem[] = [];
  const itemPattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) && items.length < max) {
    const body = match[1];
    const sourceUrl = body.match(/<source\s[^>]*url="([^"]*)"/i)?.[1] ?? '';
    items.push({
      title: tag(body, 'title'),
      link: tag(body, 'link'),
      pubDate: tag(body, 'pubDate'),
      source: tag(body, 'source'),
      sourceUrl: decodeEntities(sourceUrl),
      rank: items.length + 1,
      outlets: descriptionOutlets(tag(body, 'description')),
    });
  }
  return items;
}
