import { describe, expect, it } from 'vitest';
import { editionsFor } from '../../api/_lib/editions.js';
import { toCandidates } from '../../api/_lib/providers/google.js';
import { outletCandidates } from '../../api/_lib/providers/outlets.js';
import { parseRssItems } from '../../api/_lib/rss.js';

// The shape of a Google News NATION item (description holds the outlet list, HTML-escaped).
const GOOGLE = `<?xml version="1.0"?><rss version="2.0"><channel>
<item><title>Rail strike halts trains - BBC</title><link>https://news.google.com/rss/articles/abc?oc=5</link>
<pubDate>Mon, 10 Nov 2026 10:00:00 GMT</pubDate>
<description>&lt;ol&gt;&lt;li&gt;&lt;a href="https://news.google.com/a"&gt;Rail strike halts trains&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;BBC&lt;/font&gt;&lt;/li&gt;&lt;li&gt;&lt;a href="https://news.google.com/b"&gt;Trains stop&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;The Guardian&lt;/font&gt;&lt;/li&gt;&lt;/ol&gt;</description>
<source url="https://www.bbc.co.uk">BBC</source></item>
<item><title>Budget passes after long night - Reuters</title><link>https://news.google.com/rss/articles/def</link>
<pubDate>Mon, 10 Nov 2026 09:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
</channel></rss>`;

describe('parseRssItems', () => {
  it('keeps the rank, the outlet list and the <source url>', () => {
    const [a, b] = parseRssItems(GOOGLE);
    expect(a.rank).toBe(1);
    expect(b.rank).toBe(2);
    expect(a.outlets).toEqual(['BBC', 'The Guardian']);
    expect(a.sourceUrl).toBe('https://www.bbc.co.uk');
    expect(b.outlets).toEqual([]);
  });
});

describe('Google candidates', () => {
  it('takes the domain from <source url>, never from the news.google.com link', () => {
    const [a, b] = toCandidates(GOOGLE, 'nation', null);
    expect(a.title).toBe('Rail strike halts trains');
    expect(a.source).toBe('BBC');
    expect(a.domain).toBe('bbc.co.uk');
    expect(a.rank).toBe(1);
    expect(b.domain).toBe('reuters.com');
    expect(b.outlets).toEqual(['Reuters']);
  });

  it('gives search items no rank', () => {
    expect(toCandidates(GOOGLE, 'search', null)[0].rank).toBeNull();
  });
});

describe('outlet feed candidates', () => {
  it('uses the article host as the domain', () => {
    const xml = `<rss><channel><item><title><![CDATA[Fiji floods leave hundreds homeless]]></title>
<link>https://www.abc.net.au/news/2026-11-10/fiji-floods/1</link><pubDate>Mon, 10 Nov 2026 08:00:00 +1100</pubDate></item></channel></rss>`;
    const [c] = outletCandidates(xml, { source: 'ABC News (Australia)', domain: 'abc.net.au', url: 'https://x' });
    expect(c.domain).toBe('abc.net.au');
    expect(c.feed).toBe('outlet');
    expect(c.publishedAt).toBe('2026-11-09T21:00:00.000Z');
  });
});

describe('editions', () => {
  it('gives the English edition first, the native edition only without one', () => {
    expect(editionsFor('ID').english?.ceid).toBe('ID:en');
    expect(editionsFor('ID').native).toBeNull();
    expect(editionsFor('DE').english).toBeNull();
    expect(editionsFor('DE').native?.ceid).toBe('DE:de');
    expect(editionsFor('BR').native?.ceid).toBe('BR:pt-419');
    expect(editionsFor('FJ')).toEqual({ english: null, native: null });
    expect(editionsFor(null)).toEqual({ english: null, native: null });
  });
});
