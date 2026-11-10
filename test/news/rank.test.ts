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
    const picked = pick(rankPool(pool, ctx), 2, ctx);
    expect(picked.map((c) => c.rep.source)).toEqual(['Spiegel', 'Zeit Online']);
  });

  it('allows a second story from one publisher only to fill the list, and keeps score order', () => {
    const pool = [
      cand('Coalition crisis deepens as finance minister quits', { feed: 'nation', rank: 1, source: 'Spiegel' }),
      cand('Rail strike halts trains across the country', { feed: 'nation', rank: 2, source: 'Spiegel' }),
      cand('Farmers block roads in protest over diesel tax', { feed: 'nation', rank: 3, source: 'Zeit Online' }),
    ];
    const picked = pick(rankPool(pool, ctx), 5, ctx);
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

describe('review cases: filler outside the audit countries', () => {
  const titles: [string, string, string, string][] = [
    ['Georgia', 'Georgian', "Georgian Dream party wins basketball federation vote in 80-72 count", 'Example'],
    ['Pakistan', 'Pakistani', 'Shakeel nears century as Pakistan score 390-6 in first Test', 'France 24'],
    ['Sweden', 'Swedish', 'Sweden Will Not Play Russia if Matched at World Juniors', 'Example'],
    ['Hungary', 'Hungarian', "Kyori Audi (Hungary) defeated Blomberg Lippe to continue its unbeaten run in the Women's Handball Championship", 'Example'],
    ['Netherlands', 'Dutch', "Sudden call-up for Ajax player raises many questions: 'The worst in the Netherlands!'", 'LiveScore'],
    ['Singapore', 'Singaporean', "Singapore to host 'BTS The City Arirang' for all of December", 'Example'],
    ['South Africa', 'South African', 'John Legend brings The Muse Tour to South Africa in February 2027', 'Example'],
  ];
  it.each(titles)('%s: "%s" gets a penalty', (name, demonym, title, source) => {
    const c = rankContext(name, [name, demonym], NOW);
    const [cl] = rankPool([cand(title, { source })], c);
    expect(cl.pen).toBeLessThan(1);
  });

  it('drops a title that holds only the country name', () => {
    const vct = rankContext('Saint Vincent and the Grenadines', ['Saint Vincent and the Grenadines'], NOW);
    expect(rankPool([cand('Saint Vincent and the Grenadines')], vct)).toHaveLength(0);
  });
});

describe('review cases: the shown title', () => {
  it('shows a member that names the country, not a tier-1 title about something else', () => {
    const ven = rankContext('Venezuela', ['Venezuela', 'Venezuelan', 'Caracas'], NOW);
    const ranked = rankPool(
      [
        cand('What are the impeachment articles facing US Defence Secretary Pete Hegseth?', { source: 'The Straits Times', publishedAt: hoursAgo(1) }),
        cand('Hegseth impeachment push grows over Venezuela boat strikes', { source: 'Local Paper', publishedAt: hoursAgo(2) }),
      ],
      ven,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].rep.title).toContain('Venezuela');
  });
});

describe('review cases: one story, one row', () => {
  it('treats clusters that the hybrid boost links to the same native story as one story', () => {
    const ven = rankContext('Venezuela', ['Venezuela', 'Venezuelan', 'Caracas'], NOW);
    const english = [
      cand("ExxonMobil explores return to Venezuela after calling nation 'uninvestable'", { source: 'Financial Times' }),
      cand('Exxon Takes First Step Toward Investing in Venezuela', { source: 'WSJ' }),
      cand('ExxonMobil signs Venezuela MoU but stops short of investment commitment', { source: 'BNamericas' }),
    ];
    const nat = [cand('ExxonMobil firma memorando con Venezuela', { feed: 'nation', rank: 1, lang: 'es', outlets: ['A', 'B', 'C'] })];
    const r = rankHybrid(english, nat, ven);
    const exxon = r.clusters.filter((c) => /exxon/i.test(c.rep.title));
    expect(exxon).toHaveLength(1);
  });

  it('treats two fresh titles that share a name as one story (brand variants count)', () => {
    const ven = rankContext('Venezuela', ['Venezuela', 'Venezuelan', 'Caracas'], NOW);
    const pool = [
      cand("ExxonMobil explores return to Venezuela after calling nation 'uninvestable'", { source: 'Financial Times' }),
      cand('ExxonMobil signs Venezuela MoU but stops short of investment commitment', { source: 'BNamericas' }),
    ];
    expect(pick(rankPool(pool, ven), 5, ven)).toHaveLength(1);
  });

  it('treats two fresh titles that share 2 words as one story', () => {
    const ukr = rankContext('Ukraine', ['Ukraine', 'Ukrainian', 'Kyiv'], NOW);
    const pool = [
      cand("US officials seek 'final end' to Russia-Ukraine war as Abu Dhabi talks begin", { source: 'The Guardian' }),
      cand("First day of Ukraine peace talks 'very productive', US says", { source: 'BBC News' }),
    ];
    expect(pick(rankPool(pool, ukr), 5, ukr)).toHaveLength(1);
  });

  it('keeps two different stories apart', () => {
    const pool = [
      cand('Germany passes rent cap law after long fight', { source: 'Reuters' }),
      cand('German exports fall for third month in a row', { source: 'AP' }),
    ];
    expect(pick(rankPool(pool, ctx), 5, ctx)).toHaveLength(2);
  });
});

describe('review cases: no low filler', () => {
  it('leaves out a cluster that does not name the country and scores under 0.2', () => {
    const vat = rankContext('Vatican City', ['Vatican City', 'Vatican', 'Holy See'], NOW);
    const pool = [
      cand('Vatican City hosts climate summit for faith leaders', { publishedAt: hoursAgo(2) }),
      cand('Kenya shuts down embassy in Switzerland', { publishedAt: hoursAgo(20) }),
    ];
    const picked = pick(rankPool(pool, vat), 5, vat);
    expect(picked.map((c) => c.rep.title)).toEqual(['Vatican City hosts climate summit for faith leaders']);
  });
});

describe('review cases: second live run', () => {
  it('treats a sentence-case and a Title Case title with one name as one story', () => {
    const che = rankContext('Switzerland', ['Switzerland', 'Swiss', 'Bern'], NOW);
    const pool = [
      cand('Watches of Switzerland lifts outlook floor as US, UK demand remains strong', { source: 'Reuters', publishedAt: hoursAgo(5) }),
      cand('Watches of Switzerland Shares Fade From 6% Intraday Jump After H1 Update', { source: 'AskTraders.com', publishedAt: hoursAgo(6) }),
      cand('Mafioso given six-year prison sentence in Switzerland', { source: 'SWI swissinfo.ch', publishedAt: hoursAgo(1) }),
    ];
    const picked = pick(rankPool(pool, che), 5, che).map((c) => c.rep.source);
    expect(picked).toHaveLength(2);
    expect(picked).toContain('Reuters');
  });

  it('counts a weak match as named when the search asked for the capital too', () => {
    const geo = rankContext('Georgia', ['Georgia', 'Georgian', 'Tbilisi'], NOW);
    expect(rankPool([cand('Georgia approves new budget for next year')], geo)[0].rel).toBe(0.3);
    expect(rankPool([cand('Georgia approves new budget for next year', { confirmed: true })], geo)[0].rel).toBe(1);
  });

  it('penalises an NFL game abroad and stock notes', () => {
    const [game] = rankPool([cand('What Ann Arbor bars will be open for the Detroit Lions’ 9:30 a.m. Germany game?')], ctx);
    expect(game.pen).toBeLessThan(1);
    const pan = rankContext('Panama', ['Panama', 'Panamanian'], NOW);
    const [note] = rankPool([cand("What Will Franco-Nevada's Q3 Results Reveal on Panama and Royalties?", { source: 'Kalkine Media' })], pan);
    expect(note.pen).toBeLessThan(1);
  });
});
