// The business family in detect(): the country, the level, the order, the key and the life of a business
// story. The Nvidia scenario holds real titles of 2026-11-12 (fixtures/scenarios/nvidia-ceo.json).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { alertKey, CONFIG, detect } from '../../api/_lib/breaking/detect.js';
import { parseState } from '../../api/_lib/breaking/state.js';
import type { BreakingInputs, BreakingState, FeedKind, Headline, Itn } from '../../api/_lib/breaking/types.js';
import { fromFixture, type Fixture } from './fixture.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const HOUR = 3.6e6;
const ITN: Itn = { blurbs: [], ongoing: ['Iran war', 'Russo-Ukrainian war', 'Yemen offensives'] };
// [feed, kind, edition, position, publisher, title, hours ago]
type Row = [string, FeedKind, string | null, number, string, string, number];

const NVIDIA = JSON.parse(readFileSync(join(DIR, 'scenarios/nvidia-ceo.json'), 'utf8')) as { now: string; items: Row[] };
const NOW = Date.parse(NVIDIA.now);

function headlines(rows: Row[], now: number): Headline[] {
  return rows.map(([feed, kind, edition, position, publisher, title, hoursAgo]) => ({
    feed, kind, edition, position, publisher, title,
    url: `https://example.org/${feed}/${encodeURIComponent(title)}`,
    publishedAt: new Date(now - hoursAgo * HOUR).toISOString(),
  }));
}

function run(rows: Row[], extra: Partial<BreakingInputs> = {}, previous: BreakingState | null = null, now = NOW) {
  return detect({ headlines: headlines(rows, now), itn: ITN, hazards: [], now, sources: { ok: 27, total: 27 }, ...extra }, previous);
}
const brief = (r: ReturnType<typeof run>) => r.response.alerts.map((a) => `${a.country}:${a.level}:${a.kind}`);

const DOW: Row[] = [
  ['bbc_world', 'front', null, 2, 'BBC News', 'Dow plunges 2,900 points as tariff fears grip Wall Street', 1],
  ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Dow plunges nearly 3,000 points in worst day since 2008', 1],
  ['gn_top_ca', 'gn', 'CA', 2, 'CBC', 'S&P 500 sinks 6% in worst day since 2008', 1],
  ['gn_world', 'gn', 'WORLD', 3, 'Reuters', 'Wall Street crashes 6% as tariff panic spreads', 1],
  ['npr_top', 'front', null, 1, 'NPR', 'Stocks crash: Dow plunges 2,900 points', 1],
];

describe('a business alert: the Nvidia CEO resignation', () => {
  const r = run(NVIDIA.items);

  it('gives one major business alert in the US, with the company in the key', () => {
    expect(brief(r)).toEqual(['USA:major:business']);
    const a = r.response.alerts[0];
    expect(a.key).toBe('USA-business-20261112-Q182477');
    expect(a.subject).toBe('Q182477');
  });

  it('the chip article is one strong front-page lead: headline, link and source match', () => {
    const a = r.response.alerts[0];
    const src = headlines(NVIDIA.items, NOW).find((h) => h.url === a.url)!;
    expect(src).toBeDefined();
    expect([a.headline, a.source, a.publishedAt]).toEqual([src.title, src.publisher, src.publishedAt]);
    expect(a.headline).toBe('Jensen Huang resigns as Nvidia CEO after mounting scandals');
  });

  it('"Chinese spy" in the titles gives no China candidate', () => {
    expect(r.candidates.some((c) => c.id === 'CHN')).toBe(false);
  });

  it('the press review, the question and the memes feature are not voices', () => {
    const c = r.candidates.find((x) => x.family === 'business')!;
    const titles = c.items.map((i) => i.h.title);
    expect(titles.some((t) => t.startsWith('The Papers'))).toBe(false);
    expect(titles.some((t) => t.includes('Memes'))).toBe(false);
    // 6 outlets. BBC News (the question, tier 1) and "BBC" on Google News are one outlet.
    expect(c.voices).toBe(6);
    expect(titles).toContain("Jensen Huang has resigned, what's next for Nvidia?");
  });

  it('3 strong outlets are enough for other kinds, but not for business', () => {
    const three = NVIDIA.items.filter((x) => ['gn_top_in', 'gn_top_sg', 'france24'].includes(x[0]));
    const t = run(three);
    expect(t.response.alerts).toEqual([]);
    expect(t.candidates.find((c) => c.family === 'business')).toMatchObject({ voices: 3, level: null });
    expect(CONFIG.businessOutlets).toBe(4);
  });

  it('a story with only support headlines gives no alert', () => {
    const memes: Row[] = ['bbc_world', 'aljazeera', 'guardian_world', 'france24', 'dw_world'].map((f, i) => [
      f, 'front', null, 1, `Outlet ${i}`, 'Nvidia Scandal Unleashes a Flood of AI-Generated Memes', 1,
    ]);
    expect(run(memes).response.alerts).toEqual([]);
  });

  it('an ITN blurb about the resignation names the US and supports the story', () => {
    const itn: Itn = { ...ITN, blurbs: [{ text: 'Jensen Huang resigns as CEO of Nvidia.', date: '2026-11-12T00:00:00Z' }] };
    const t = run(NVIDIA.items, { itn });
    expect(t.response.alerts[0].basis).toContain('itn');
  });

  it('the state keeps a held business alert, and the alert ends when the coverage is stale', () => {
    const parsed = parseState(JSON.parse(JSON.stringify(r.state)));
    expect(parsed).toEqual(r.state);
    expect(parsed!.alerts[0]).toMatchObject({ family: 'business', key: 'USA-business-20261112-Q182477' });
    expect(parsed!.starts).toEqual(['USA|business|20261112']);
    // 8 h later with the same headlines and no new one: no fresh lead, so the alert ends.
    const later = NOW + 8 * HOUR;
    const old = NVIDIA.items.map(([f, k, e, p, pub, t, h]): Row => [f, k, e, p, pub, t, h + 8]);
    const t = run(old, {}, parsed, later);
    expect(t.response.alerts).toEqual([]);
    expect(t.candidates.find((c) => c.family === 'business')?.reason).toBe('ended: no fresh lead headline');
    expect(t.state.ended?.[0].key).toBe('USA-business-20261112-Q182477');
  });
});

describe('business stories and other stories', () => {
  it('a company story and a market crash in one country are two stories with two keys, and one alert', () => {
    const r = run([...NVIDIA.items, ...DOW]);
    const biz = r.candidates.filter((c) => c.family === 'business' && c.level);
    expect(biz.map((c) => c.subject).sort()).toEqual(['Q182477', 'mkt-USA']);
    expect(new Set(biz.map((c) => alertKey(c.id, c.family, c.since, c.subject))).size).toBe(2);
    expect(brief(r)).toEqual(['USA:major:business']);
  });

  it('a deadly event in the same country wins over a larger business story', () => {
    const shooting: Row[] = [
      ['bbc_world', 'front', null, 1, 'BBC News', 'Gunman kills 5 at Texas shopping mall', 1],
      ['aljazeera', 'front', null, 3, 'Al Jazeera', 'Five killed in mass shooting at Texas mall', 1],
      ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Texas mall mass shooting leaves 5 dead', 1],
    ];
    const r = run([...NVIDIA.items, ...shooting]);
    expect(brief(r)).toEqual(['USA:major:attack']);
    const biz = r.candidates.find((c) => c.family === 'business')!;
    expect(biz.level).toBe('major');
    expect(biz.score).toBeGreaterThan(r.candidates.find((c) => c.family === 'attack')!.score);
  });

  it('an index fall of 10% or more with wide coverage is critical; with 4 outlets and no support it is major', () => {
    const nikkei: Row[] = [
      ['bbc_world', 'front', null, 1, 'BBC News', 'Nikkei plunges 11% in worst day since 1987', 1],
      ['aljazeera', 'front', null, 2, 'Al Jazeera', 'Japan stocks: Nikkei crashes 11 percent as panic spreads', 1],
      ['gn_top_us', 'gn', 'US', 2, 'CNN', 'Japan’s Nikkei tumbles 11% in historic rout', 1],
      ['gn_top_gb', 'gn', 'GB', 3, 'Sky News', 'Nikkei plummets more than 11% in biggest fall since 1987', 1],
      ['gn_world', 'gn', 'WORLD', 1, 'Reuters', 'Japan’s Nikkei slumps 11.2%, worst day since 1987', 1],
      ['guardian_world', 'front', null, 3, 'The Guardian', 'Tokyo stocks crash: Nikkei loses 11%', 1],
    ];
    expect(brief(run(nikkei))).toEqual(['JPN:critical:business']);
    const four = run(nikkei.slice(0, 4));
    expect(brief(four)).toEqual(['JPN:major:business']);
    expect(four.candidates[0].reason).toBe('critical-class, gate not met');
  });

  it('trap: a correction (a fall over many sessions) with wide coverage gives no alert', () => {
    const rows: Row[] = [
      ['bbc_world', 'front', null, 2, 'BBC News', 'S&P 500 falls 10% from record high, confirming correction', 1],
      ['guardian_world', 'front', null, 3, 'The Guardian', 'S&P 500 slides 10% from its peak as correction deepens', 1],
      ['gn_top_us', 'gn', 'US', 4, 'CNBC', 'S&P 500 closes down 10% from record, entering correction territory', 1],
      ['gn_top_gb', 'gn', 'GB', 6, 'Reuters', 'Wall Street stocks have lost 10% since record high', 1],
      ['nyt_world', 'front', null, 1, 'The New York Times', 'S&P 500 Falls 10% From Its Peak, Entering a Correction', 1],
      ['gn_top_in', 'gn', 'IN', 9, 'Mint', 'S&P 500 drops 10% from February peak', 1],
    ];
    expect(run(rows).response.alerts).toEqual([]);
  });

  it('trap: the sacking of the Red Bull F1 team principal is no business alert', () => {
    const rows: Row[] = [
      ['bbc_top', 'front', null, 2, 'BBC News', 'Christian Horner sacked as Red Bull boss', 1],
      ['sky_home', 'front', null, 1, 'Sky News', 'Red Bull boss Christian Horner sacked after 20 years', 1],
      ['gn_top_gb', 'gn', 'GB', 3, 'The Guardian', 'Christian Horner sacked as Red Bull team principal', 1],
      ['gn_top_au', 'gn', 'AU', 5, 'ABC News', 'Red Bull boss Christian Horner sacked', 1],
      ['gn_top_in', 'gn', 'IN', 8, 'Hindustan Times', 'Christian Horner fired as Red Bull boss', 1],
    ];
    expect(run(rows).response.alerts).toEqual([]);
  });

  it('a leader of two companies is one story: the bare name joins the story of the named company', () => {
    // The data gives Elon Musk to SpaceX (the larger company); "Tesla" in the other titles names the story.
    const rows: Row[] = [
      ['bbc_world', 'front', null, 1, 'BBC News', 'Elon Musk steps down as Tesla CEO', 1],
      ['guardian_world', 'front', null, 2, 'The Guardian', 'Elon Musk resigns with immediate effect', 1],
      ['gn_top_us', 'gn', 'US', 1, 'CNBC', 'Elon Musk steps down, shocking investors', 1],
      ['gn_top_gb', 'gn', 'GB', 2, 'Reuters', 'Musk quits as Tesla chief executive', 1],
      ['cbc_world', 'front', null, 1, 'CBC News', 'Elon Musk quits Tesla', 1],
    ];
    const r = run(rows);
    expect(brief(r)).toEqual(['USA:major:business']);
    expect(r.response.alerts[0].subject).toBe('Q478214');
    expect(r.candidates.filter((c) => c.family === 'business').length).toBe(1);
  });

  it('the saved live fixtures give no business alert', () => {
    for (const f of ['live-2026-11-10T1315Z', 'live-2026-11-10T1510Z', 'live-2026-11-10T1545Z', 'live-2026-11-10T1630Z-wide']) {
      const inputs = fromFixture(JSON.parse(readFileSync(join(DIR, `${f}.json`), 'utf8')) as Fixture);
      expect(detect(inputs).response.alerts.filter((a) => a.kind === 'business')).toEqual([]);
    }
  });
});
