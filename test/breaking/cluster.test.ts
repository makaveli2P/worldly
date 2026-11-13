// Cluster voices: the other outlets that Google lists under a Google News item (`Headline.cluster`).
// They help the major bar and `outlets` only. These tests hold the traps: the lead of the story must be
// strong, placed and fresh, the story must have victims and must not be war coverage, an outlet counts
// once, a name that is not a news outlet is no voice, the cap holds, and the critical gates, the business
// bar, the pulse and the chronic-war gate count the feed voices only.
import { describe, expect, it } from 'vitest';
import { CONFIG, detect, outletKey } from '../../api/_lib/breaking/detect.js';
import { CLUSTER_MAX, FEEDS, parseFeed } from '../../api/_lib/breaking/sources.js';
import type { BreakingInputs, BreakingState, FeedKind, Headline, Itn } from '../../api/_lib/breaking/types.js';

const NOW = Date.parse('2026-11-13T17:20:00Z');
const HOUR = 3.6e6;
const ITN: Itn = { blurbs: [], ongoing: ['Iran war', 'Russo-Ukrainian war', 'Yemen offensives'] };

// [feed, kind, edition, position, publisher, title, hours ago, cluster]
type Row = [string, FeedKind, string | null, number, string, string, number, string[]?];

function headlines(rows: Row[], now: number): Headline[] {
  return rows.map(([feed, kind, edition, position, publisher, title, hoursAgo, cluster]) => ({
    feed, kind, edition, position, publisher, title,
    url: `https://example.org/${feed}/${position}/${encodeURIComponent(title)}`,
    publishedAt: new Date(now - hoursAgo * HOUR).toISOString(),
    ...(cluster ? { cluster } : {}),
  }));
}

function run(rows: Row[], extra: Partial<BreakingInputs> = {}, previous: BreakingState | null = null, now = NOW) {
  return detect({ headlines: headlines(rows, now), itn: ITN, hazards: [], now, sources: { ok: 27, total: 27 }, ...extra }, previous);
}
const brief = (r: ReturnType<typeof run>) => r.response.alerts.map((a) => `${a.country}:${a.level}:${a.kind}`);
const cand = (r: ReturnType<typeof run>, id: string) => r.candidates.find((c) => c.id === id)!;
const noCluster = (rows: Row[]): Row[] => rows.map(([f, k, e, p, pub, t, h]) => [f, k, e, p, pub, t, h]);

const AJ: Row = ['aljazeera', 'front', null, 5, 'Al Jazeera', 'Truck and bus crash in India’s Assam state kills at least 24 people', 1.3];
const HINDU = 'At least 26 die in bus-truck collision in Assam’s Kaziranga; 20 others injured';
const NEW4 = ['NDTV', 'India Today', 'Hindustan Times', 'The Indian Express'];

describe('parseFeed: the cluster of a Google News item', () => {
  const item = (title: string, source: string, outlets: string[]) =>
    `<item><title>${title} - ${source}</title><link>https://news.google.com/rss/articles/x${outlets.length}</link><source url="https://example.org">${source}</source>` +
    `<description>${outlets.map((o) => `&lt;li&gt;&lt;a href="https://news.google.com/a"&gt;t&lt;/a&gt;&amp;nbsp;&lt;font color="#6f6f6f"&gt;${o}&lt;/font&gt;&lt;/li&gt;`).join('')}</description></item>`;

  it('keeps the other outlets in order, without the publisher of the item and repeats', () => {
    const src = FEEDS.find((f) => f.id === 'gn_top_in')!;
    const xml = `<rss><channel>${item(HINDU, 'The Hindu', ['The Hindu', 'Reuters', 'Al Jazeera', 'reuters', 'NDTV', 'Arunachal24'])}</channel></rss>`;
    expect(parseFeed(src, xml)[0]).toMatchObject({ publisher: 'The Hindu', cluster: ['Reuters', 'Al Jazeera', 'NDTV', 'Arunachal24'] });
  });

  it('keeps at most CLUSTER_MAX names, and a cluster of only the publisher gives no field', () => {
    const src = FEEDS.find((f) => f.id === 'gn_top_in')!;
    const xml = `<rss><channel>${item('A', 'BBC', ['BBC', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'])}${item('B', 'BBC', ['BBC'])}</channel></rss>`;
    const [a, b] = parseFeed(src, xml);
    expect(a.cluster).toHaveLength(CLUSTER_MAX);
    expect(b).not.toHaveProperty('cluster');
  });

  it('a front page has no cluster', () => {
    const src = FEEDS.find((f) => f.id === 'bbc_world')!;
    const xml = `<rss><channel>${item('Quake kills 16', 'BBC', ['BBC', 'Reuters'])}</channel></rss>`;
    expect(parseFeed(src, xml)[0]).not.toHaveProperty('cluster');
  });
});

describe('cluster voices', () => {
  it('a strong, placed and fresh Google item adds its cluster: 2 voices become major', () => {
    const rows: Row[] = [AJ, ['gn_top_in', 'gn', 'IN', 3, 'The Hindu', HINDU, 2, NEW4]];
    expect(brief(run(noCluster(rows)))).toEqual([]);
    const r = run(rows);
    expect(brief(r)).toEqual(['IND:major:accident']);
    // The cap: 4 new outlets, 3 count.
    expect(cand(r, 'IND').cluster).toEqual(NEW4.slice(0, CONFIG.clusterVoicesMax));
    expect(r.response.alerts[0].outlets).toBe(2 + CONFIG.clusterVoicesMax);
  });

  it('one Google item with a large cluster alone gives no alert: two feed voices must agree on the tier', () => {
    const r = run([['gn_top_in', 'gn', 'IN', 1, 'The Hindu', HINDU, 1, NEW4]]);
    expect(brief(r)).toEqual([]);
    // One feed voice gives no agreed tier or toll, so the story gets no cluster voices and no pulse.
    expect([cand(r, 'IND').windowVoices, cand(r, 'IND').cluster.length, cand(r, 'IND').pulse, cand(r, 'IND').tierEff]).toEqual([1, 0, false, 0]);
  });

  it('the cluster of a tier-1 lead adds nothing', () => {
    const r = run([AJ, ['gn_top_in', 'gn', 'IN', 1, 'The Hindu', 'Kaziranga bus crash: what we know so far', 1, NEW4]]);
    expect(brief(r)).toEqual([]);
    expect(cand(r, 'IND').cluster).toEqual([]);
  });

  it('sport and film items with large clusters add nothing', () => {
    const r = run([
      AJ,
      ['gn_top_in', 'gn', 'IN', 1, 'Cricinfo', "Gambhir 'concerned' by India's frequent ODI batting collapses", 1, NEW4],
      ['gn_top_in', 'gn', 'IN', 2, 'NDTV', "Moushumi Chatterjee's Husband, Producer Jayanta Mukherjee Dies After Prolonged Illness", 1, NEW4],
      ['gn_top_in', 'gn', 'IN', 4, 'The Times of India', "'Ramayana' box office: Yash's film becomes a record breaker in Vietnam", 1, NEW4],
    ]);
    expect(brief(r)).toEqual([]);
    expect(r.candidates.every((c) => c.cluster.length === 0)).toBe(true);
  });

  it('the cluster of an unplaced item (below the top 12) adds nothing', () => {
    // Al Jazeera leads its front page, so the story has a position. Only the cluster is missing.
    const lead: Row = ['aljazeera', 'front', null, 2, 'Al Jazeera', AJ[5], 1.3];
    const at = (position: number): Row[] => [lead, ['gn_top_in', 'gn', 'IN', position, 'The Hindu', HINDU, 2, NEW4]];
    expect(brief(run(at(CONFIG.gnTopPositions + 1)))).toEqual([]);
    expect(cand(run(at(CONFIG.gnTopPositions + 1)), 'IND').cluster).toEqual([]);
    expect(brief(run(at(CONFIG.gnTopPositions)))).toEqual(['IND:major:accident']);
  });

  it('the cluster of a stale item (older than 6 h) adds nothing', () => {
    const lead: Row = ['aljazeera', 'front', null, 2, 'Al Jazeera', AJ[5], 1.3];
    const aged = (hours: number): Row[] => [lead, ['gn_top_in', 'gn', 'IN', 3, 'The Hindu', HINDU, hours, NEW4]];
    expect(brief(run(aged(CONFIG.freshHours + 1)))).toEqual([]);
    expect(cand(run(aged(CONFIG.freshHours + 1)), 'IND').cluster).toEqual([]);
    expect(brief(run(aged(CONFIG.freshHours - 1)))).toEqual(['IND:major:accident']);
  });

  it('an outlet in a feed and in a cluster, or in two clusters, counts once', () => {
    const r = run([
      AJ,
      ['gn_top_in', 'gn', 'IN', 3, 'The Hindu', HINDU, 2, ['Al Jazeera English', 'thehindu.com', 'REUTERS', 'aljazeera.com']],
      ['gn_world', 'gn', 'WORLD', 8, 'NDTV', 'Bus-truck collision in Assam kills 24', 1.5, ['Reuters', 'reuters.com', 'Al Jazeera', 'The Hindu', 'NDTV']],
    ]);
    // Al Jazeera, The Hindu and NDTV are feed voices. Reuters is one outlet in two clusters.
    expect(cand(r, 'IND').voices).toBe(3);
    expect(cand(r, 'IND').cluster).toEqual(['REUTERS']);
    expect(r.response.alerts[0].outlets).toBe(4);
  });

  it('an aggregator in a cluster is no voice', () => {
    const r = run([AJ, ['gn_top_in', 'gn', 'IN', 3, 'The Hindu', HINDU, 2, ['Yahoo News', 'MSN', 'NDTV']]]);
    expect(cand(r, 'IND').cluster).toEqual(['NDTV']);
  });

  it('the cap holds over many clusters', () => {
    const r = run([
      AJ,
      ['gn_top_in', 'gn', 'IN', 3, 'The Hindu', HINDU, 2, NEW4],
      ['gn_world', 'gn', 'WORLD', 5, 'BBC', 'Bus-truck collision in Assam kills 24', 1.5, ['Reuters', 'AP News', 'CNN', 'Sky News']],
    ]);
    expect(cand(r, 'IND').cluster).toHaveLength(CONFIG.clusterVoicesMax);
    // The top item gives its cluster first.
    expect(cand(r, 'IND').cluster).toEqual(NEW4.slice(0, CONFIG.clusterVoicesMax));
  });

  it('the chip article does not change with the clusters', () => {
    const rows: Row[] = [
      AJ,
      ['bbc_world', 'front', null, 11, 'BBC News', 'At least 24 killed after bus collides with truck in north-east India', 2.1],
      ['gn_top_in', 'gn', 'IN', 3, 'The Hindu', HINDU, 2, NEW4],
    ];
    const a = run(rows).response.alerts[0];
    const b = run(noCluster(rows)).response.alerts[0];
    expect([a.url, a.headline, a.source]).toEqual([b.url, b.headline, b.source]);
    expect([a.outlets, b.outlets]).toEqual([3 + CONFIG.clusterVoicesMax, 3]);
  });
});

describe('cluster voices never count for the other bars', () => {
  it('critical never comes from cluster voices: 2 feed voices with 2 editions and a tier-3 toll stay major', () => {
    const r = run([
      ['gn_top_in', 'gn', 'IN', 1, 'NDTV', 'Bus plunges into gorge in Himachal Pradesh, 60 killed', 1, NEW4],
      ['gn_top_gb', 'gn', 'GB', 2, 'BBC', '60 killed as bus plunges into gorge in India', 1, ['Reuters', 'Sky News', 'The Guardian', 'CNN']],
    ]);
    expect(brief(r)).toEqual(['IND:major:accident']);
    expect([cand(r, 'IND').tierEff, cand(r, 'IND').voices, cand(r, 'IND').reason]).toEqual([3, 2, 'major, cluster voices']);
  });

  it('the critical gate (6 outlets) counts feed voices only: 4 voices and 3 cluster voices stay major', () => {
    const r = run([
      ['gn_top_in', 'gn', 'IN', 1, 'NDTV', 'Bus plunges into gorge in Himachal Pradesh, 60 killed', 1, NEW4],
      ['gn_top_gb', 'gn', 'GB', 2, 'BBC', '60 killed as bus plunges into gorge in India', 1],
      ['aljazeera', 'front', null, 4, 'Al Jazeera', 'Bus falls into gorge in northern India, killing 60', 1.5],
      ['guardian_world', 'front', null, 6, 'The Guardian', 'Himachal Pradesh bus crash kills 60', 1.5],
    ]);
    expect(cand(r, 'IND').voices).toBe(4);
    expect(cand(r, 'IND').cluster).toHaveLength(3);
    expect(brief(r)).toEqual(['IND:major:accident']);
    expect(cand(r, 'IND').reason).toBe('critical-class, gate not met');
  });

  it('the business bar (4 outlets) counts feed voices only', () => {
    const rows: Row[] = [
      ['gn_top_us', 'gn', 'US', 3, 'Reuters', 'Nvidia CEO Jensen Huang resigns after affair with suspected Chinese spy', 0.9, ['CNBC', 'Bloomberg', 'The Verge', 'CNN']],
      ['gn_top_gb', 'gn', 'GB', 2, 'BBC', 'Nvidia boss Jensen Huang quits after spy scandal', 1.1, ['The Guardian', 'Sky News', 'Financial Times']],
      ['france24', 'front', null, 2, 'France 24', 'Jensen Huang resigns as Nvidia CEO after mounting scandals', 0.8],
    ];
    const r = run(rows, {}, null, Date.parse('2026-11-12T15:00:00Z'));
    expect(brief(r)).toEqual([]);
    // A business story has no victims, so it gets no cluster voices.
    expect([cand(r, 'USA').voices, cand(r, 'USA').cluster.length]).toEqual([3, 0]);
  });

  it('war coverage gets no cluster voices, also when the war is not on the ITN list', () => {
    const kyiv: Row[] = [
      ['gn_world', 'gn', 'WORLD', 2, 'Reuters', 'Russian missile strike on Kyiv kills 25', 1, ['CNN', 'AP News', 'Sky News', 'NBC News']],
      ['aljazeera', 'front', null, 5, 'Al Jazeera', 'Russian missile attack on Kyiv apartment block kills 25', 1.5],
    ];
    const r = run(kyiv, { itn: { blurbs: [], ongoing: ['Iran war'] } });
    expect(brief(r)).toEqual([]);
    expect(cand(r, 'UKR').cluster).toEqual([]);
  });

  it('the pulse counts feed voices only: one Google item with a cluster does not keep a live alert', () => {
    const first: Row[] = [
      AJ,
      ['bbc_world', 'front', null, 2, 'BBC News', 'At least 24 killed after bus collides with truck in north-east India', 1],
      ['gn_top_in', 'gn', 'IN', 3, 'The Hindu', HINDU, 1, ['Reuters', 'NDTV', 'India Today', 'ThePrint']],
    ];
    const r1 = run(first);
    expect(brief(r1)).toEqual(['IND:major:accident']);
    // 3 h later only The Hindu runs the story. Its cluster does not give the second voice of the pulse.
    const later = NOW + 3 * HOUR;
    const r2 = run([['gn_top_in', 'gn', 'IN', 6, 'The Hindu', HINDU, 2, ['Reuters', 'NDTV', 'India Today', 'ThePrint']]], {}, r1.state, later);
    expect(cand(r2, 'IND').pulse).toBe(false);
    expect(brief(r2)).toEqual([]);
    expect(cand(r2, 'IND').reason).toBe('ended: no fresh lead headline');
  });
});

// Review traps: classifier errors with no victims, war coverage outside the ITN list, and names that are
// not news outlets. Each case gives no alert, and none gives an alert without its cluster either.
describe('cluster traps', () => {
  const C4 = ['CNN', 'The New York Times', 'AP News', 'The Guardian'];
  const cases: [string, Row[]][] = [
    ['a sport "massacre" (tier 2, no toll)', [
      ['gn_world', 'gn', 'WORLD', 5, 'ESPN', 'Spain thrash Germany: a massacre in Madrid', 2, ['Marca', 'AS', 'Sky Sports', 'The Guardian']],
      ['euronews', 'front', null, 2, 'Euronews', 'Massacre in Madrid as Spain thrash Germany 6-0', 1],
    ]],
    ['a report on an assassination attempt (tier 2, no toll)', [
      ['gn_top_us', 'gn', 'US', 2, 'CNN', 'Trump assassination attempt: Secret Service report blasts failures', 2, ['The New York Times', 'Fox News', 'AP News', 'Politico']],
      ['npr_top', 'front', null, 2, 'NPR', 'Secret Service report on Trump assassination attempt blasts agency failures', 1],
    ]],
    ['an Israeli strike on Gaza', [
      ['aljazeera', 'front', null, 4, 'Al Jazeera', 'Israeli strike on Gaza’s Nasser Hospital kills six Palestinians', 1.5],
      ['gn_world', 'gn', 'WORLD', 9, 'NBC News', 'Israeli strike on Gaza’s Nasser Hospital kills at least six people, officials say', 2, C4],
    ]],
    ['a drone strike in Sudan', [
      ['aljazeera', 'front', null, 4, 'Al Jazeera', 'RSF drone strike on market in El Fasher kills 15', 1.5],
      ['gn_world', 'gn', 'WORLD', 9, 'Reuters', 'Drone strike on El Fasher market kills 15, Sudan doctors say', 2, ['Sudan Tribune', 'Radio Dabanga', 'BBC', 'AP News']],
    ]],
    ['a military claim about killed militants', [
      ['aljazeera', 'front', null, 3, 'Al Jazeera', 'Pakistan military reports it killed 74 ‘terrorists’ during raids', 1.5],
      ['gn_top_in', 'gn', 'IN', 5, 'Dawn', 'Pakistan security forces kill 74 militants in raids in Khyber Pakhtunkhwa', 2, ['The Express Tribune', 'Geo News', 'Reuters', 'ARY News']],
    ]],
  ];
  for (const [name, rows] of cases) {
    it(name, () => {
      const r = run(rows);
      expect(brief(r)).toEqual([]);
      expect(brief(run(noCluster(rows)))).toEqual([]);
      expect(r.candidates.every((c) => c.cluster.length === 0)).toBe(true);
    });
  }

  it('a government, police, newsroom, press-release or platform name is no voice', () => {
    const r = run([AJ, ['gn_top_in', 'gn', 'IN', 3, 'The Hindu', HINDU, 2, ['GOV.UK', 'West Midlands Police', 'PM India', 'NVIDIA Newsroom', 'PR Newswire Canada', 'YouTube', 'NDTV']]]);
    expect(cand(r, 'IND').cluster).toEqual(['NDTV']);
  });

  it('the name forms of one outlet give one key', () => {
    const pairs: [string, string][] = [
      ['ABC News - Breaking News, Latest News and Videos', 'ABC News'],
      ['NDTV Profit', 'NDTV'],
      ['WSJ', 'The Wall Street Journal'],
      ['SMH.com.au', 'The Sydney Morning Herald'],
      ['RTE.ie', 'RTÉ'],
    ];
    for (const [a, b] of pairs) expect(outletKey(a)).toBe(outletKey(b));
  });
});
