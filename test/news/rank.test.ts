import { describe, expect, it } from 'vitest';
import type { Candidate } from '../../api/_lib/providers/types.js';
import {
  cluster,
  filterCandidates,
  pick,
  rankContext,
  rankHybrid,
  rankPool,
  sameCandidates,
  score,
  storyTokens,
} from '../../api/_lib/rank.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3.6e6).toISOString();

let seq = 0;
function cand(title: string, over: Partial<Candidate> = {}): Candidate {
  seq += 1;
  return {
    title,
    url: `https://example.com/${seq}`,
    source: `Outlet ${seq}`,
    domain: null,
    publishedAt: hoursAgo(1),
    imageUrl: null,
    feed: 'search',
    rank: null,
    outlets: [],
    lang: null,
    ...over,
  };
}

const ctx = rankContext('Germany', ['Germany', 'German', 'Berlin', 'Merz'], NOW);

describe('same-story test', () => {
  it('matches by Dice overlap without the country words', () => {
    expect(sameCandidates(cand('Germany floods force thousands from homes in Bavaria'), cand('Floods in Bavaria force thousands from their homes'), ctx.ignore)).toBe(true);
  });

  it('matches by 2 shared proper names (rule c)', () => {
    const a = cand('FBI probes Nvidia chief Huang over alleged spy affair');
    const b = cand('Trump says agents look at Nvidia and Huang ties');
    expect(sameCandidates(a, b, ctx.ignore)).toBe(true);
  });

  it('matches a shared capitalised name plus one more shared word (rule d)', () => {
    const a = cand('Hegseth to Hold Rare News Conference as Impeachment Vote Looms');
    const b = cand('Pete Hegseth to address reporters after Republican begins impeachment effort');
    expect(sameCandidates(a, b, ctx.ignore)).toBe(true);
  });

  it('treats "step down" as "resign" and "intent" as "intention"', () => {
    const idn = rankContext('Indonesia', ['Indonesia', 'Indonesian', 'Jakarta', 'Prabowo'], NOW);
    const a = cand('Indonesia VP expresses intent to step down in talks with President, official says');
    const b = cand('Gibran joins Prabowo at Palace after expressing intention to resign');
    expect(sameCandidates(a, b, idn.ignore)).toBe(true);
  });

  it('does not match different stories that share only the country', () => {
    expect(sameCandidates(cand('Germany raises pension age to 68'), cand('Germany beats France in handball final'), ctx.ignore)).toBe(false);
  });

  it('uses character bigrams for CJK titles', () => {
    expect(storyTokens('台風が上陸').has('台風')).toBe(true);
  });
});

describe('clustering', () => {
  it('compares with the cluster seed only, so it never chains', () => {
    // a~b and b~c share words, but a and c do not.
    const a = cand('Bavaria floods: dam breaks near Passau town');
    const b = cand('Passau town dam breaks, rescue teams arrive overnight');
    const c = cand('Rescue teams arrive overnight at mine collapse site');
    const clusters = cluster([a, b, c], ctx);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].members).toEqual([a, b]);
  });

  it('counts the distinct outlets of the members and of the Google list', () => {
    const a = cand('Merz coalition agrees on budget after all-night talks', { feed: 'nation', rank: 1, source: 'Spiegel', outlets: ['Spiegel', 'FAZ', 'Zeit Online', 'tagesschau'] });
    const b = cand('Merz coalition agrees budget after all-night talks', { source: 'Reuters' });
    const [cl] = cluster([a, b], ctx);
    score(cl, ctx);
    expect(cl.outlets).toBe(5);
  });
});

describe('filter', () => {
  it('drops stories older than 36 h, junk and press releases; keeps undated stories', () => {
    const kept = filterCandidates(
      [
        cand('Old story about German rail strike', { publishedAt: hoursAgo(40) }),
        cand('Fresh story about German rail strike', { publishedAt: hoursAgo(2) }),
        cand('Undated story about German rail strike', { publishedAt: null }),
        cand('Company launches product in Germany today', { source: 'PR Newswire' }),
        cand('Watch Germany vs Spain live stream free online'),
      ],
      NOW,
    );
    expect(kept.map((c) => c.title)).toEqual(['Fresh story about German rail strike', 'Undated story about German rail strike']);
  });
});

describe('score', () => {
  it('gives an edition rank 1 story more than a lone search story', () => {
    const top = rankPool([cand('Coalition crisis deepens as finance minister quits', { feed: 'nation', rank: 1, outlets: ['A', 'B', 'C', 'D', 'E'] })], ctx)[0];
    const lone = rankPool([cand('German startup raises funds for battery plant')], ctx)[0];
    expect(top.score).toBeGreaterThan(lone.score);
    expect(top.score).toBeGreaterThan(0.75);
  });

  it('penalises sport, soft and opinion titles', () => {
    const base = rankPool([cand('Germany passes new law on rent caps in big cities')], ctx)[0].score;
    expect(rankPool([cand('Germany squad named for World Cup qualifier in Berlin')], ctx)[0].score).toBeCloseTo(base * 0.5, 1);
    expect(rankPool([cand('Ten luxury hotels in Germany for a winter getaway')], ctx)[0].score).toBeLessThan(base * 0.6);
    expect(rankPool([cand('Opinion: Germany must rethink its rent caps now')], ctx)[0].score).toBeLessThan(base * 0.8);
    expect(rankPool([cand('Church scores four after Germany fight', { source: 'Fox Sports' })], ctx)[0].score).toBeCloseTo(base * 0.5, 1);
    expect(rankPool([cand('Germany opens new freight corridor to Poland', { source: 'Transport Topics' })], ctx)[0].score).toBeCloseTo(base, 1);
    expect(rankPool([cand('Star steals spotlight in bikini on beach in Germany')], ctx)[0].score).toBeLessThan(base * 0.6);
  });

  it('scores 0 for a homonym or a longer place, and 0.3 for a title that does not name the country', () => {
    const mex = rankContext('Mexico', ['Mexico', 'Mexican'], NOW);
    expect(rankPool([cand('New Mexico governor signs water bill')], mex)[0].score).toBe(0);
    expect(rankPool([cand('Rain falls on the plains again tonight')], mex)[0].rel).toBe(0.3);
  });

  it('scores 0 when the shown title names only a US town ("Mexico, NY")', () => {
    const mex = rankContext('Mexico', ['Mexico', 'Mexican'], NOW);
    const ranked = rankPool(
      [
        cand('Watertown woman dies in Mexico, NY crash on Main Street', { publishedAt: hoursAgo(1) }),
        cand('Woman dies in Mexico crash on Main Street', { publishedAt: hoursAgo(3) }),
      ],
      mex,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(0);
  });

  it('decays with age (half-life 12 h)', () => {
    const fresh = rankPool([cand('German court rules on data retention law', { publishedAt: hoursAgo(0) })], ctx)[0];
    const old = rankPool([cand('German court rules on data retention law', { publishedAt: hoursAgo(12) })], ctx)[0];
    expect(fresh.score - old.score).toBeCloseTo(0.25 * 0.5, 2);
  });
});

describe('pick', () => {
  it('orders by score and takes 1 story per publisher on the first pass', () => {
    const pool = [
      cand('Coalition crisis deepens as finance minister quits', { feed: 'nation', rank: 1, source: 'Spiegel' }),
      cand('Rail strike halts trains across the country', { feed: 'nation', rank: 2, source: 'Spiegel' }),
      cand('Farmers block roads in protest over diesel tax', { feed: 'nation', rank: 3, source: 'Zeit Online' }),
    ];
    const picked = pick(rankPool(pool, ctx), 2, ctx.ignore);
    expect(picked.map((c) => c.rep.source)).toEqual(['Spiegel', 'Zeit Online']);
  });

  it('allows a second story from one publisher only to fill the list, and keeps score order', () => {
    const pool = [
      cand('Coalition crisis deepens as finance minister quits', { feed: 'nation', rank: 1, source: 'Spiegel' }),
      cand('Rail strike halts trains across the country', { feed: 'nation', rank: 2, source: 'Spiegel' }),
      cand('Farmers block roads in protest over diesel tax', { feed: 'nation', rank: 3, source: 'Zeit Online' }),
    ];
    const picked = pick(rankPool(pool, ctx), 5, ctx.ignore);
    expect(picked.map((c) => c.rep.title)).toEqual(pool.map((c) => c.title));
  });
});

describe('hybrid (no English edition)', () => {
  const native = (title: string, rank: number) => cand(title, { feed: 'nation', rank, lang: 'de', outlets: ['A', 'B', 'C', 'D', 'E'] });

  it('boosts an English story that shares a name with a native top-20 title', () => {
    const english = [cand('Could Ilse Aigner become the first female head of state?', { source: 'DW' }), cand('German startup raises funds for battery plant')];
    const nat = [native('Aigner soll Bundespräsidentin werden', 2)];
    const r = rankHybrid(english, nat, ctx);
    const aigner = r.all.find((c) => c.rep.title.includes('Aigner') && c.rep.lang === null)!;
    expect(aigner.boostRank).toBe(2);
  });

  it('fills with native stories (lang set) when fewer than 3 English stories score 0.45', () => {
    const english = [cand('German startup raises funds for battery plant', { publishedAt: hoursAgo(20) })];
    const nat = [native('Regierung beschließt große Rentenreform', 1), native('Bahnstreik legt Fernverkehr lahm', 2)];
    const r = rankHybrid(english, nat, ctx);
    expect(r.clusters.map((c) => c.rep.lang)).toEqual(['de', 'de', null]);
    expect(r.native.size).toBe(2);
  });

  it('uses English only when 3 or more English stories are strong', () => {
    const strong = (t: string, s: string) => cand(t, { source: s, outlets: ['Reuters', 'AP', 'BBC', 'DW', 'AFP'], publishedAt: hoursAgo(0) });
    const english = [
      strong('Germany passes rent cap law after long fight', 'Reuters'),
      strong('Germany orders new air defence systems for army', 'DW'),
      strong('German exports fall for third month in a row', 'AP'),
    ];
    const r = rankHybrid(english, [native('Regierung beschließt Rentenreform', 1)], ctx);
    expect(r.clusters.every((c) => c.rep.lang === null)).toBe(true);
    expect(r.native.size).toBe(0);
  });

  it('does not count a fresh story from 1 outlet as strong coverage', () => {
    const lone = (t: string, s: string) => cand(t, { source: s, publishedAt: hoursAgo(0) });
    const english = [
      lone('Germany passes rent cap law after long fight', 'Reuters'),
      lone('Germany orders new air defence systems for army', 'DW'),
      lone('German exports fall for third month in a row', 'Bloomberg'),
    ];
    for (const cl of rankPool(english, ctx)) expect(cl.score).toBeGreaterThanOrEqual(0.45);
    const r = rankHybrid(english, [native('Regierung beschließt große Rentenreform', 1)], ctx);
    expect(r.native.size).toBe(1);
  });
});

describe('market-data filler', () => {
  it('penalises stock notes by source or by an exchange ticker', () => {
    const base = rankPool([cand('Germany passes new law on rent caps in big cities')], ctx)[0].score;
    expect(rankPool([cand('Quantinuum expands quantum work with German partner', { source: 'GuruFocus' })], ctx)[0].score).toBeLessThan(base * 0.6);
    expect(rankPool([cand('Acme Corp (NASDAQ: ACME) opens German plant')], ctx)[0].score).toBeLessThan(base * 0.6);
  });
});
