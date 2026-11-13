// The article of the chip (pickArticle): a good, current representative of the story. The response
// takes the headline, the link, the source and the date from this one article (articleOf).
import { describe, expect, it } from 'vitest';
import { articleOf, detect, makeItem, pickArticle, type Item } from '../../api/_lib/breaking/detect.js';
import type { BreakingState, Headline } from '../../api/_lib/breaking/types.js';

const NOW = Date.parse('2026-11-10T16:00:00Z');
const HOUR = 3.6e6;

// [feed, kind, edition, position, publisher, title, hours ago (null: undated), url?]
type Row = [string, 'front' | 'gn', string | null, number, string, string, number | null, string?];

const headline = ([feed, kind, edition, position, publisher, title, hoursAgo, url]: Row): Headline => ({
  feed, kind, edition, position, publisher, title,
  url: url ?? (kind === 'gn' ? `https://news.google.com/rss/articles/${feed}-${position}` : `https://example.org/${feed}/${position}`),
  publishedAt: hoursAgo === null ? null : new Date(NOW - hoursAgo * HOUR).toISOString(),
});
const items = (rows: Row[]): Item[] =>
  rows.map((r) => {
    const i = makeItem(headline(r), NOW);
    if (!i) throw new Error(`not flagged: ${r[5]}`);
    return { ...i, places: new Set<string>() };
  });
/** The pick for a story with this agreed tier and toll. */
const pick = (rows: Row[], tierEff = 2, deaths = 12, prev: string | null = null) => pickArticle({ items: items(rows), tierEff, deaths }, prev);
const who = (rows: Row[], tierEff = 2, deaths = 12) => {
  const p = pick(rows, tierEff, deaths);
  return `${p.h.publisher} ${p.h.feed}#${p.h.position}`;
};

const T = 'Motorway pile-up kills 12 in Bulgaria';

describe('pickArticle()', () => {
  it('P1: a trusted direct front lead wins inside 1.5 h of the newest; outside, the newer item wins', () => {
    const gn: Row = ['gn_top_gb', 'gn', 'GB', 4, 'Daily Express', '12 killed in Bulgaria motorway pile-up', 0.5];
    expect(who([['bbc_world', 'front', null, 1, 'BBC News', T, 1.2], gn])).toBe('BBC News bbc_world#1');
    expect(who([['bbc_world', 'front', null, 1, 'BBC News', T, 3.0], gn])).toBe('Daily Express gn_top_gb#4');
  });

  it('P2 (trap): a newer aftermath headline (tier 1) is never the article, also in a lead position', () => {
    const report: Row = ['gn_top_us', 'gn', 'US', 7, 'ABC7 New York', 'Building collapse in Brooklyn kills 8', 4];
    const grief: Row = ['gn_top_gb', 'gn', 'GB', 3, 'The Independent', 'Neighbours grieve after deadly Brooklyn building collapse', 0.2];
    expect(who([report, grief], 2, 8)).toBe('ABC7 New York gn_top_us#7');
  });

  it('P3 (trap): a live blog is the article only when nothing else exists', () => {
    const blog: Row = ['bbc_world', 'front', null, 1, 'BBC News', 'Live: Bulgaria motorway pile-up kills 12', 0.1, 'https://www.bbc.co.uk/news/live/c123'];
    const report: Row = ['dw_world', 'front', null, 2, 'DW', '12 killed in Bulgaria motorway pile-up', 0.8];
    expect(who([blog, report])).toBe('DW dw_world#2');
    expect(who([blog])).toBe('BBC News bbc_world#1');
  });

  it('P4 (trap): an aggregator is not the article when an outlet has it', () => {
    const rows: Row[] = [
      ['gn_top_us', 'gn', 'US', 2, 'Yahoo News', T, 0.2],
      ['gn_top_ca', 'gn', 'CA', 5, 'MSN', '12 killed in Bulgaria motorway pile-up', 0.3],
      ['gn_world', 'gn', 'WORLD', 3, 'Reuters', 'Bulgaria motorway pile-up kills 12, police say', 1.0],
    ];
    expect(who(rows)).toBe('Reuters gn_world#3');
  });

  it('P11 (trap): a video clip is not the article when a written report exists', () => {
    // live-2026-11-10T1630Z-wide: the chip linked an Al Jazeera video newsfeed page.
    const video: Row = ['aljazeera', 'front', null, 1, 'Al Jazeera', 'At least 12 people killed in Bulgaria motorway pile-up', 0.2,
      'https://www.aljazeera.com/video/newsfeed/2026/11/10/at-least-12-people-killed-in-bulgaria-motorway-pile-up'];
    const report: Row = ['sky_world', 'front', null, 2, 'Sky News', 'At least 12 killed in Bulgaria motorway pile-ups', 1.5];
    expect(who([video, report])).toBe('Sky News sky_world#2');
    const watch: Row = ['bbc_world', 'front', null, 1, 'BBC News', 'Watch: Bulgaria motorway pile-up kills 12', 0.1];
    const bbcAv: Row = ['bbc_world', 'front', null, 2, 'BBC News', 'Bulgaria motorway pile-up kills 12 in fog', 0.1, 'https://www.bbc.co.uk/news/av/world-europe-123'];
    expect(who([watch, bbcAv, report])).toBe('Sky News sky_world#2');
    expect(who([video])).toBe('Al Jazeera aljazeera#1');
  });

  it('P5 (trap): a fresh item deep in its feed loses to a placed item', () => {
    expect(who([['aljazeera', 'front', null, 22, 'Al Jazeera', T, 0.3], ['sky_world', 'front', null, 2, 'Sky News', T, 2]])).toBe('Sky News sky_world#2');
  });

  it('P6: the agreed toll beats an older toll in a newer headline', () => {
    const rows: Row[] = [
      ['sky_world', 'front', null, 1, 'Sky News', 'At least 8 dead in Bulgaria motorway pile-up', 0.5],
      ['dw_world', 'front', null, 1, 'DW', '12 killed in Bulgaria motorway pile-up', 1.2],
    ];
    expect(who(rows, 2, 12)).toBe('DW dw_world#1');
  });

  it('P8: of two copies of one title, the direct link wins over the Google News redirect', () => {
    const title = 'Bulgaria motorway pile-up kills 12 people near the capital Sofia';
    const p = pick([['gn_top_ca', 'gn', 'CA', 11, 'CBC News', title, 0.5], ['cbc_world', 'front', null, 2, 'CBC News', title, 0.5, 'https://www.cbc.ca/news/world/bulgaria-1']]);
    expect(p.h.url).toBe('https://www.cbc.ca/news/world/bulgaria-1');
  });

  it('P9: an undated article gives publishedAt null', () => {
    const p = pick([['dw_world', 'front', null, 2, 'DW', T, null]]);
    expect(articleOf(p)).toEqual({ headline: T, url: 'https://example.org/dw_world/2', source: 'DW', publishedAt: null });
  });

  it('P10: a paywall ranks lower, but it is the article when it is alone', () => {
    const nyt: Row = ['nyt_world', 'front', null, 1, 'The New York Times', T, 1.0];
    expect(who([nyt, ['guardian_world', 'front', null, 2, 'The Guardian', T, 1.2]])).toBe('The Guardian guardian_world#2');
    expect(who([nyt])).toBe('The New York Times nyt_world#1');
  });

  it('a critical story prefers a placed fresh tier-2 lead to an old tier-3 headline', () => {
    const rows: Row[] = [
      ['bbc_world', 'front', null, 1, 'BBC News', 'Russian strikes kill 30 in Tallinn', 0.5],
      ['aljazeera', 'front', null, 9, 'Al Jazeera', 'Russia invades Estonia', 10],
    ];
    expect(who(rows, 3, 0)).toBe('BBC News bbc_world#1');
  });
});

describe('the article in the response', () => {
  const base: Row[] = [
    ['bbc_world', 'front', null, 1, 'BBC News', T, 2],
    ['aljazeera', 'front', null, 2, 'Al Jazeera', 'Bulgaria motorway pile-up kills 12', 2],
    ['gn_world', 'gn', 'WORLD', 3, 'Reuters', '12 killed in Bulgaria motorway pile-up', 2],
  ];
  const run = (rows: Row[], now: number, previous: BreakingState | null) =>
    detect({ headlines: rows.map(headline), itn: null, hazards: [], now, sources: null }, previous);

  it('P7: the article stays while no item is more than 1.5 h newer; then it changes', () => {
    const r1 = run(base, NOW, null);
    expect(r1.response.alerts.map((a) => a.source)).toEqual(['BBC News']);
    // 1 h newer: the chip keeps BBC.
    const dw: Row = ['dw_world', 'front', null, 1, 'DW', 'Bulgaria pile-up: 12 dead on motorway near Sofia', 1];
    const r2 = run([...base, dw], NOW, r1.state);
    expect(r2.response.alerts[0].source).toBe('BBC News');
    // 2 h newer than BBC: the chip changes to the new article.
    const sky: Row = ['sky_world', 'front', null, 1, 'Sky News', 'Twelve killed in Bulgaria motorway pile-up', 0];
    const r3 = run([...base, dw, sky], NOW, r2.state);
    const a = r3.response.alerts[0];
    expect([a.source, a.headline, a.url, a.publishedAt]).toEqual(['Sky News', sky[5], 'https://example.org/sky_world/1', new Date(NOW).toISOString()]);
    // "First reported" stays at the first evidence.
    expect(a.since).toBe(new Date(NOW - 2 * HOUR).toISOString());
  });
});
