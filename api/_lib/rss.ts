// A small RSS 2.0 item parser. It reads only the fields the news list needs.

export interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

function tag(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  if (!match) return '';
  const body = match[1].trim();
  const cdata = body.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return cdata ? cdata[1] : body;
}

export function parseRssItems(xml: string, max = 50): RssItem[] {
  const items: RssItem[] = [];
  const itemPattern = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml)) && items.length < max) {
    const body = match[1];
    items.push({
      title: tag(body, 'title'),
      link: tag(body, 'link'),
      pubDate: tag(body, 'pubDate'),
      source: tag(body, 'source'),
    });
  }
  return items;
}
