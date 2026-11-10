import { afterEach, describe, expect, it, vi } from 'vitest';
import { FEEDS, fetchInputs, parseFeed, parseGdacs, parseItn, parseUsgs, SOURCE_COUNT, splitGoogleTitle } from '../../api/_lib/breaking/sources.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');

describe('splitGoogleTitle', () => {
  it('removes the " - Publisher" tail', () => {
    expect(splitGoogleTitle('Quake kills 16 in Tibet - Reuters', 'Reuters')).toEqual({ title: 'Quake kills 16 in Tibet', publisher: 'Reuters' });
    expect(splitGoogleTitle('Quake kills 16 in Tibet - CBC News', '')).toEqual({ title: 'Quake kills 16 in Tibet', publisher: 'CBC News' });
    expect(splitGoogleTitle('Live - Quake - ABC News', 'ABC News - Breaking News, Latest News and Videos')).toEqual({ title: 'Live - Quake', publisher: 'ABC News' });
  });
});

describe('parseFeed', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item><title><![CDATA[Bulgaria pile-ups kill 12]]></title><link>https://example.org/a</link><pubDate>Tue, 10 Nov 2026 10:36:00 GMT</pubDate></item>
    <item><title>No link here</title><pubDate>Tue, 10 Nov 2026 10:36:00 GMT</pubDate></item>
    <item><title>Second &amp; last</title><link>https://example.org/b</link></item>
  </channel></rss>`;

  it('reads a front page in feed order with positions', () => {
    const src = FEEDS.find((f) => f.id === 'dw_world')!;
    const items = parseFeed(src, rss);
    expect(items).toEqual([
      { feed: 'dw_world', kind: 'front', edition: null, position: 1, title: 'Bulgaria pile-ups kill 12', publisher: 'DW', url: 'https://example.org/a', publishedAt: '2026-11-10T10:36:00.000Z' },
      { feed: 'dw_world', kind: 'front', edition: null, position: 3, title: 'Second & last', publisher: 'DW', url: 'https://example.org/b', publishedAt: null },
    ]);
  });

  it('reads the outlet of a Google News item from <source>', () => {
    const src = FEEDS.find((f) => f.id === 'gn_top_gb')!;
    const xml = `<rss><channel><item><title>Quake kills 16 - BBC</title><link>https://news.google.com/rss/articles/x</link><source url="https://www.bbc.co.uk">BBC</source></item></channel></rss>`;
    expect(parseFeed(src, xml)[0]).toMatchObject({ kind: 'gn', edition: 'GB', title: 'Quake kills 16', publisher: 'BBC' });
  });
});

describe('parseItn', () => {
  const wikitext = [
    '{{Main page image/ITN | image = x.jpg }}',
    "*<!--Nov 7--> '''[[2026 Kraków shooting|A mass shooting]]''' in [[Kraków]], Poland, leaves six people dead.",
    '*<!--Nov 5--> President of Paraguay [[Santiago Peña]] is impeached amid {{nowrap|a banking}} crisis.',
    '*<!--Dec 30--> An item from last year.',
    '{{In the news/footer',
    '|currentevents =',
    '*<!-- Mar 12 2026 -->[[2026 Iran war|Iran war]]',
    '*<!-- Mar 09 2022 -->[[Russo-Ukrainian war (2022–present)|Russo-Ukrainian war]]',
    '**[[Timeline of the Russo-Ukrainian war|timeline]]',
    '*[[2026 Yemen offensives|Yemen offensives]]',
    '|recentdeaths =',
    '*[[Somebody]]',
    '}}',
  ].join('\n');
  const json = { query: { pages: [{ revisions: [{ slots: { main: { content: wikitext } } }] }] } };

  it('reads the blurbs with their dates and the ongoing list', () => {
    const itn = parseItn(json, NOW)!;
    expect(itn.blurbs).toEqual([
      { text: 'A mass shooting in Kraków, Poland, leaves six people dead.', date: '2026-11-07T00:00:00.000Z' },
      { text: 'President of Paraguay Santiago Peña is impeached amid a banking crisis.', date: '2026-11-05T00:00:00.000Z' },
      { text: 'An item from last year.', date: '2025-12-30T00:00:00.000Z' },
    ]);
    expect(itn.ongoing).toEqual(['Iran war', 'Russo-Ukrainian war', 'Yemen offensives']);
  });

  it('gives null for an answer with no wikitext', () => {
    expect(parseItn({}, NOW)).toBeNull();
  });
});

describe('parseGdacs', () => {
  it('reads the episode level and every affected country', () => {
    const json = {
      features: [
        { properties: { eventtype: 'TC', name: 'Tropical Cyclone CHAMPI-26', alertlevel: 'Red', episodealertlevel: 'Green', iso3: 'GUM', affectedcountries: [{ iso3: 'PHL' }, { iso3: 'GUM' }], fromdate: '2026-10-14T12:00:00', todate: '2026-10-25T18:00:00', url: { report: 'https://www.gdacs.org/report.aspx?eventid=1' } } },
        { properties: { eventtype: 'EQ', name: 'Earthquake in China', alertlevel: 'Orange', episodealertlevel: 'Orange', iso3: 'CHN', affectedcountries: [], fromdate: '2026-10-22T14:33:40', todate: '2026-10-22T14:33:40' } },
        { properties: { eventtype: 'TS', name: 'Tsunami' } },
      ],
    };
    expect(parseGdacs(json)).toEqual([
      { source: 'gdacs', type: 'TC', level: 'green', countries: ['PHL', 'GUM'], name: 'Tropical Cyclone CHAMPI-26', from: '2026-10-14T12:00:00.000Z', to: '2026-10-25T18:00:00.000Z', url: 'https://www.gdacs.org/report.aspx?eventid=1', magnitude: null },
      { source: 'gdacs', type: 'EQ', level: 'orange', countries: ['CHN'], name: 'Earthquake in China', from: '2026-10-22T14:33:40.000Z', to: '2026-10-22T14:33:40.000Z', url: null, magnitude: null },
    ]);
  });

  it('gives no events for an empty answer (HTTP 204)', () => {
    expect(parseGdacs({})).toEqual([]);
  });
});

describe('parseUsgs', () => {
  it('reads the PAGER level and the country from the place', () => {
    const json = { features: [{ properties: { mag: 6.4, place: '30 km WSW of Lata, Solomon Islands', time: Date.parse('2026-11-09T03:34:59Z'), alert: 'green', url: 'https://earthquake.usgs.gov/x' } }] };
    expect(parseUsgs(json)).toEqual([
      { source: 'usgs', type: 'EQ', level: 'green', countries: ['SLB'], name: 'M6.4 earthquake, 30 km WSW of Lata, Solomon Islands', from: '2026-11-09T03:34:59.000Z', to: '2026-11-09T03:34:59.000Z', url: 'https://earthquake.usgs.gov/x', magnitude: 6.4 },
    ]);
  });
});

describe('fetchInputs', () => {
  afterEach(() => vi.useRealTimers());

  const RSS = `<rss><channel><item><title>Quake kills 12 in Peru</title><link>https://example.org/q</link><pubDate>Tue, 10 Nov 2026 11:00:00 GMT</pubDate></item></channel></rss>`;

  it('asks every source once, and a failed source gives no items', async () => {
    const urls: string[] = [];
    const agents: string[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      urls.push(url);
      agents.push(new Headers(init?.headers).get('user-agent') ?? '');
      if (url.includes('gdacs')) return new Response(null, { status: 204 });
      if (url.includes('usgs')) return new Response(JSON.stringify({ features: [] }), { status: 200 });
      if (url.includes('wikipedia')) return new Response('oops', { status: 503 });
      if (url.includes('bbci')) throw new TypeError('fetch failed');
      return new Response(RSS, { status: 200 });
    }) as typeof fetch;
    const { inputs, status } = await fetchInputs(NOW, { fetchImpl, userAgent: 'TestAgent/1.0', contact: 'ops@example.org' });
    expect(urls).toHaveLength(SOURCE_COUNT);
    expect(inputs.sources).toEqual({ ok: SOURCE_COUNT - 3, total: SOURCE_COUNT });
    expect(inputs.itn).toBeNull();
    expect(inputs.hazards).toEqual([]);
    expect(inputs.headlines).toHaveLength(FEEDS.length - 2);
    expect(status.find((s) => s.id === 'itn')).toMatchObject({ ok: false, status: 'http 503' });
    expect(status.find((s) => s.id === 'bbc_top')).toMatchObject({ ok: false, status: 'network error' });
    expect(status.find((s) => s.id === 'gdacs')).toMatchObject({ ok: true, status: '204', items: 0 });
    expect(agents[urls.findIndex((u) => u.includes('wikipedia'))]).toBe('TestAgent/1.0 (ops@example.org)');
    expect(agents[0]).toBe('TestAgent/1.0');
  });

  it('a page that is not a feed counts as a failure', async () => {
    const fetchImpl = (async () => new Response('<html>blocked</html>', { status: 200 })) as unknown as typeof fetch;
    const { inputs, status } = await fetchInputs(NOW, { fetchImpl });
    expect(inputs.headlines).toEqual([]);
    expect(status.find((s) => s.id === 'nyt_world')).toMatchObject({ ok: false, status: 'not rss' });
  });

  it('stops a slow source at the per-request timeout', async () => {
    const fetchImpl = ((_: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })));
      })) as unknown as typeof fetch;
    const t0 = Date.now();
    const { inputs, status } = await fetchInputs(NOW, { fetchImpl });
    expect(Date.now() - t0).toBeLessThan(4000);
    expect(inputs.sources).toEqual({ ok: 0, total: SOURCE_COUNT });
    expect(status.every((s) => s.status === 'timeout')).toBe(true);
  });
});
