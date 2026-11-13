// The life of an alert: fresh coverage decides if an alert lives, not the age of its first headline.
// - An alert stays while it has the pulse: a fresh (6 h) strong headline in a lead position, and 2 voices
//   in the 12 h window.
// - One wave lasts at most 24 h. A new wave of headlines (3 voices, new URLs) or an escalation renews it,
//   for 72 h after the first alert; after that only an escalation does.
// - A story that ended alerts again only with a new wave or an escalation, with its first key and since.
// - Chronic wars (ITN "Ongoing", or conflicts that started alerts on 2 earlier days of the last 7) alert
//   only on an escalation, a big fresh wave, or a new ITN development.
// Each test replays runs in order and gives the state of one run to the next run.
import { describe, expect, it } from 'vitest';
import { detect, itemId } from '../../api/_lib/breaking/detect.js';
import { parseState } from '../../api/_lib/breaking/state.js';
import type { BreakingInputs, BreakingState, EndedAlert, Hazard, HeldAlert, Itn } from '../../api/_lib/breaking/types.js';

const T1 = Date.parse('2026-11-12T10:00:00Z');
const MIN = 60_000;
const HOUR = 3.6e6;
// Gaza is not on the "Ongoing" list, so the ITN chronic rule does not apply to it.
const ITN: Itn = { blurbs: [], ongoing: ['Russo-Ukrainian war', 'Sudanese civil war'] };

// [feed, kind, edition, position, publisher, title, published at (epoch ms)]
type Row = [string, 'front' | 'gn', string | null, number, string, string, number];

const urlOf = (r: Row) => `https://example.org/${r[0]}/${encodeURIComponent(r[5])}`;
const idOf = (r: Row) => itemId(urlOf(r));

function run(rows: Row[], now: number, previous: BreakingState | null, extra: Partial<BreakingInputs> = {}) {
  // One article keeps its URL from run to run, also when it moves in its feed or gets a new date.
  const headlines = rows.map(([feed, kind, edition, position, publisher, title, at]) => ({
    feed, kind, edition, position, publisher, title, url: urlOf([feed, kind, edition, position, publisher, title, at]),
    publishedAt: new Date(at).toISOString(),
  }));
  return detect({ headlines, itn: ITN, hazards: [], now, sources: { ok: 27, total: 27 }, ...extra }, previous);
}
type Run = ReturnType<typeof run>;
const brief = (r: Run) => r.response.alerts.map((a) => `${a.country}:${a.level}`);
const reasonOf = (r: Run, id: string) => r.candidates.find((c) => c.id === id)?.reason;
/** The same rows with a new date (an outlet that changes the date of an old URL). */
const redate = (rows: Row[], at: number): Row[] => rows.map((r) => [...r.slice(0, 6), at] as Row);

// ---------------------------------------------------------------- the Gaza case

const at = T1 - 40 * MIN;
const BBC: Row = ['bbc_world', 'front', null, 1, 'BBC News', 'Israeli strike on Gaza hospital kills six Palestinians', at];
const AJ: Row = ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Six killed in Israeli strike on Gaza hospital', at];
const GUARDIAN: Row = ['guardian_world', 'front', null, 2, 'The Guardian', 'Israeli strike on Gaza hospital kills 6, health officials say', at];
const GAZA = [BBC, AJ, GUARDIAN];

describe('the pulse (Gaza hospital strike, 2026-11-12)', () => {
  const r1 = run(GAZA, T1, null);

  it('L1: the alert stays while its newest lead is at most 6 h old, then it ends', () => {
    expect(brief(r1)).toEqual(['PSE:major']);
    // The items are 5.97 h old: still fresh.
    const r2 = run(GAZA, T1 + 5.3 * HOUR, r1.state);
    expect(brief(r2)).toEqual(['PSE:major']);
    expect(reasonOf(r2, 'PSE')).toBe('major');
    // 6.2 h old and no new headline: the story is stale.
    const r3 = run(GAZA, T1 + 5.5 * HOUR, r2.state);
    expect(r3.response.alerts).toEqual([]);
    expect(reasonOf(r3, 'PSE')).toBe('ended: no fresh lead headline');
    expect(r3.state.alerts).toEqual([]);
    expect(r3.state.ended?.map((x) => [x.key, x.firstAlertAt, x.endedAt])).toEqual([['PSE-conflict-20261112', T1, T1 + 5.5 * HOUR]]);
  });

  it('L2 (trap, the live case): old headlines deep in the feeds pass the full test but do not keep the alert', () => {
    // On 2026-11-13 the alert stayed 17 h: 4 voices with items 6.5-11 h old at bbc_world#10, france24#15,
    // nyt_world#22 and gn_top_ca#11. The old hold kept it, because gn_top_ca#11 counted as a lead.
    const now = T1 + 10 * HOUR;
    const rows: Row[] = [
      ['bbc_world', 'front', null, 10, 'BBC News', BBC[5], at],
      ['france24', 'front', null, 15, 'France 24', 'Israeli strike on Gaza hospital kills six, officials say', now - 8.5 * HOUR],
      ['nyt_world', 'front', null, 22, 'The New York Times', 'Israeli Strike on Gaza Hospital Kills Six', now - 11 * HOUR],
      ['gn_top_ca', 'gn', 'CA', 11, 'CBC News', 'Israeli strike on Gaza hospital kills 6', now - 6.5 * HOUR],
    ];
    const r = run(rows, now, r1.state);
    const c = r.candidates.find((x) => x.id === 'PSE')!;
    expect(c.fullLevel).toBe('major');
    expect([c.freshLeads, c.pulse]).toEqual([0, false]);
    expect(r.response.alerts).toEqual([]);
    expect(c.reason).toBe('ended: no fresh lead headline');
    // With no state it is no new alert either.
    expect(reasonOf(run(rows, now, null), 'PSE')).toBe('stale: no fresh lead headline');
  });

  // L3 (one fresh voice keeps an alert for its first 2 h only) is in hold.test.ts.

  it('L7: a wave lasts 24 h; 2 voices cannot renew it, 3 voices with new headlines can', () => {
    // 2 outlets write again. Their new headlines share 2 stored words ("hospital", "health"), so the
    // live alert finds its story again.
    const t23 = T1 + 23 * HOUR;
    const two: Row[] = [
      ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Health officials say Israeli strike on Gaza hospital killed six', t23 - HOUR],
      ['guardian_world', 'front', null, 2, 'The Guardian', 'Gaza health ministry: six killed in Israeli strike on hospital', t23 - HOUR],
    ];
    const r2 = run([...GAZA, ...two], t23, r1.state);
    expect(brief(r2)).toEqual(['PSE:major']);
    expect(reasonOf(r2, 'PSE')).toBe('held: fresh lead');

    const cap = T1 + 24.5 * HOUR;
    const ended = run([...GAZA, ...two], cap, r2.state);
    expect(ended.response.alerts).toEqual([]);
    expect(reasonOf(ended, 'PSE')).toBe('ended: wave over 24 h');

    const third: Row = ['dw_world', 'front', null, 2, 'DW', 'Israeli strike on Gaza hospital kills six people, health officials say', cap - 30 * MIN];
    const renewed = run([...GAZA, ...two, third], cap, r2.state);
    expect(brief(renewed)).toEqual(['PSE:major']);
    expect(reasonOf(renewed, 'PSE')).toBe('renewed: new wave');
    expect(renewed.state.alerts[0]).toMatchObject({ key: 'PSE-conflict-20261112', since: at, firstAlertAt: T1, waveAt: cap, waves: 2 });
    expect(renewed.state.starts).toEqual(['PSE|conflict|20261112', 'PSE|conflict|20261113']);
  });
});

// ---------------------------------------------------------------- a continuing disaster

const QUAKE_DAY1: Row[] = [
  ['bbc_world', 'front', null, 1, 'BBC News', 'Tibet earthquake kills 16 in mountain villages', at],
  ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Earthquake in Tibet kills 16 in mountain villages', at],
  ['gn_world', 'gn', 'WORLD', 2, 'Reuters', 'Tibet earthquake kills 16 in mountain villages, more feared', at],
];

describe('a disaster that gets a new wave of coverage', () => {
  const r1 = run(QUAKE_DAY1, T1, null);
  const r2 = run(QUAKE_DAY1, T1 + 8 * HOUR, r1.state);

  it('day 1: the quake is major, then it ends when no outlet leads with it', () => {
    expect(brief(r1)).toEqual(['CHN:major']);
    expect(r1.response.alerts[0].key).toBe('CHN-disaster-20261112');
    expect(reasonOf(r2, 'CHN')).toBe('ended: no fresh lead headline');
    expect(r2.state.ended?.[0]).toMatchObject({ key: 'CHN-disaster-20261112', peakDeaths: 16, peakTier: 2 });
  });

  it('L4: 30 h later, 4 new outlets report a toll of 45: the story alerts again (escalation) with its first key', () => {
    const now = T1 + 30 * HOUR;
    const wave: Row[] = [
      ['cbc_world', 'front', null, 2, 'CBC News', 'Tibet earthquake: 45 killed in mountain villages', now - HOUR],
      ['gn_top_us', 'gn', 'US', 3, 'CNN', '45 dead as Tibet earthquake toll rises in mountain villages', now - HOUR],
      ['dw_world', 'front', null, 4, 'DW', 'Tibet earthquake death toll rises to 45', now - HOUR],
      ['guardian_world', 'front', null, 5, 'The Guardian', 'Tibet earthquake kills 45 in remote mountain villages', now - HOUR],
    ];
    const r = run([...QUAKE_DAY1, ...wave], now, r2.state);
    expect(brief(r)).toEqual(['CHN:major']);
    expect(reasonOf(r, 'CHN')).toBe('renewed: escalation');
    const a = r.response.alerts[0];
    // "First reported" stays day 1; the chip shows the new article.
    expect([a.key, a.since]).toEqual(['CHN-disaster-20261112', new Date(at).toISOString()]);
    expect([a.headline, a.source, a.publishedAt]).toEqual([wave[0][5], 'CBC News', new Date(now - HOUR).toISOString()]);
    expect(r.state.alerts[0]).toMatchObject({ waves: 2, waveAt: now, firstAlertAt: T1, peakDeaths: 45 });
    expect(r.state.ended).toBeUndefined();
  });

  const wave16 = (t: number): Row[] => [
    ['cbc_world', 'front', null, 2, 'CBC News', 'Tibet earthquake kills 16 in mountain villages, rescuers say', t],
    ['dw_world', 'front', null, 5, 'DW', 'Rescuers dig through mountain villages after Tibet earthquake kills 16', t],
    ['france24', 'front', null, 6, 'France 24', 'Tibet earthquake: 16 killed in mountain villages', t],
  ];

  it('L5: 20 h later, 3 new outlets with the same toll are a new wave', () => {
    const now = T1 + 20 * HOUR;
    const r = run([...QUAKE_DAY1, ...wave16(now - HOUR)], now, r2.state);
    expect(brief(r)).toEqual(['CHN:major']);
    expect(reasonOf(r, 'CHN')).toBe('renewed: new wave');
    expect(r.response.alerts[0].key).toBe('CHN-disaster-20261112');
  });

  it('L5: more than 72 h after the first alert, a new wave with no escalation does not renew the story', () => {
    const now = T1 + 80 * HOUR;
    const old: EndedAlert = {
      key: 'CHN-disaster-20261112', country: 'CHN', family: 'disaster', since: at, firstAlertAt: T1, waveAt: T1 + 48 * HOUR, waves: 3,
      endedAt: now - 10 * HOUR, peakTier: 2, peakDeaths: 16, itemIds: ['00000001'], words: ['mountain', 'villag'],
    };
    const r = run(wave16(now - HOUR), now, { v: 1, savedAt: now - 5 * MIN, alerts: [], ended: [old] });
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'CHN')).toBe('ended earlier: story over 72 h');
  });

  it('L6 (trap): the same URLs with new dates are not a new wave', () => {
    const now = T1 + 20 * HOUR;
    const r = run(redate(QUAKE_DAY1, now - HOUR), now, r2.state);
    expect(r.candidates.find((c) => c.id === 'CHN')?.fullLevel).toBe('major');
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'CHN')).toBe('ended earlier: no new wave');
  });

  it('a new wave from 2 outlets only is not enough', () => {
    const now = T1 + 20 * HOUR;
    const r = run([...QUAKE_DAY1, ...wave16(now - HOUR).slice(0, 2), ['gn_world', 'gn', 'WORLD', 2, 'Reuters', QUAKE_DAY1[2][5], at]], now, r2.state);
    expect(r.response.alerts).toEqual([]);
  });
});

// ---------------------------------------------------------------- the story cap

describe('L8: the story cap of 72 h', () => {
  const now = T1;
  const rows = (dead: number): Row[] => [
    ['bbc_world', 'front', null, 1, 'BBC News', `Tibet earthquake kills ${dead} in mountain villages`, now - HOUR],
    ['aljazeera', 'front', null, 3, 'Al Jazeera', `Earthquake in Tibet: ${dead} killed in mountain villages`, now - HOUR],
    ['gn_world', 'gn', 'WORLD', 4, 'Reuters', `Tibet earthquake kills ${dead} in remote mountain villages`, now - HOUR],
  ];
  // A live alert of 73 h: its second wave started 25 h ago, and the last run saw these items.
  const state = (r: Row[]): BreakingState => ({
    v: 1, savedAt: now - 5 * MIN,
    alerts: [{
      key: 'CHN-disaster-20261109', country: 'CHN', family: 'disaster', level: 'major', since: now - 74 * HOUR,
      firstAlertAt: now - 73 * HOUR, lastQualifiedAt: now - 5 * MIN, itemIds: r.map(idOf), words: ['mountain', 'villag'],
      waveAt: now - 25 * HOUR, waves: 2, peakTier: 2, peakDeaths: 20, waveIds: ['00000001'], pickId: null,
    }],
  });

  it('a fresh wave with no escalation ends the story', () => {
    const r = run(rows(20), now, state(rows(20)));
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'CHN')).toBe('ended: story over 72 h');
  });

  it('a toll from 20 to 60 renews it', () => {
    const r = run(rows(60), now, state(rows(60)));
    expect(brief(r)).toEqual(['CHN:major']);
    expect(reasonOf(r, 'CHN')).toBe('renewed: escalation');
    expect(r.response.alerts[0].key).toBe('CHN-disaster-20261109');
  });

  it('a tier rise (a red GDACS level) renews it, also with a toll that does not double', () => {
    const red: Hazard = {
      source: 'gdacs', type: 'EQ', level: 'red', countries: ['CHN'], name: 'Earthquake in China',
      from: new Date(now - 70 * HOUR).toISOString(), to: new Date(now - 2 * HOUR).toISOString(), url: null, magnitude: 7.1,
    };
    const r = run(rows(25), now, state(rows(25)), { hazards: [red] });
    expect(r.response.alerts.length).toBe(1);
    expect(reasonOf(r, 'CHN')).toBe('renewed: escalation');
  });
});

// ---------------------------------------------------------------- chronic wars

describe('L9: a chronic war on the ITN "Ongoing" list', () => {
  const now = T1;
  const fresh = now - HOUR;
  const OUTLETS: [string, 'front' | 'gn', string | null, string][] = [
    ['bbc_world', 'front', null, 'BBC News'],
    ['aljazeera', 'front', null, 'Al Jazeera'],
    ['gn_world', 'gn', 'WORLD', 'Reuters'],
    ['guardian_world', 'front', null, 'The Guardian'],
    ['dw_world', 'front', null, 'DW'],
    ['france24', 'front', null, 'France 24'],
  ];
  /** `n` outlets with small changes of `title`; the first `placed` of them lead. */
  const rows = (title: string, n: number, placed: number): Row[] =>
    OUTLETS.slice(0, n).map(([feed, kind, edition, publisher], i): Row => [feed, kind, edition, i < placed ? 1 : 8, publisher, i ? `${title} (${publisher})` : title, fresh]);

  it('the routine coverage of the day does not alert', () => {
    const r = run(rows('Russian strikes kill 7 in Kharkiv', 5, 2), now, null);
    expect(r.candidates.find((c) => c.id === 'UKR')?.fullLevel).toBe('major');
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'UKR')).toBe('chronic conflict');
  });

  it('a barrage that 6 outlets cover and 3 lead with now is major; it ends when the wave fades', () => {
    const big = rows('Russian missile barrage kills 25 in Kyiv', 6, 3);
    const r = run(big, now, null);
    expect(brief(r)).toEqual(['UKR:major']);
    expect(reasonOf(r, 'UKR')).toBe('chronic, fresh wave');
    // 10 minutes later only 4 outlets carry it: no endless alert.
    const r2 = run(big.slice(0, 4), now + 10 * MIN, r.state);
    expect(r2.response.alerts).toEqual([]);
    expect(reasonOf(r2, 'UKR')).toBe('ended: chronic conflict');
  });

  const blurb = (date: string): Itn => ({ ...ITN, blurbs: [{ text: 'A Russian missile strike on a hospital in Kharkiv, Ukraine, kills five people.', date }] });
  const hospital = rows('Russian missile strike on Kharkiv hospital kills five', 3, 1);

  it('a new development that ITN posts today, with a new wave of 3 outlets, is major', () => {
    const r = run(hospital, now, null, { itn: blurb('2026-11-12T00:00:00.000Z') });
    expect(brief(r)).toEqual(['UKR:major']);
    expect(reasonOf(r, 'UKR')).toBe('chronic, ITN development');
  });

  it('the same blurb from 3 days ago gives nothing', () => {
    const r = run(hospital, now, null, { itn: blurb('2026-11-09T00:00:00.000Z') });
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'UKR')).toBe('chronic conflict');
  });
});

describe('L10: a recurring conflict that ITN does not list', () => {
  const now = T1; // 2026-11-12
  const four = (title: string): Row[] => [
    ['bbc_world', 'front', null, 1, 'BBC News', title, now - HOUR],
    ['aljazeera', 'front', null, 2, 'Al Jazeera', `${title}, officials say`, now - HOUR],
    ['gn_world', 'gn', 'WORLD', 3, 'Reuters', `${title}: medics`, now - HOUR],
    ['guardian_world', 'front', null, 4, 'The Guardian', `${title} in latest attack`, now - HOUR],
  ];
  const history = (...days: string[]): BreakingState => ({ v: 1, savedAt: now - HOUR, alerts: [], starts: days.map((d) => `PSE|conflict|${d}`) });
  const gaza = four('Israeli strike on Gaza school kills 9');

  it('conflict alerts on 2 earlier days of the last 7 make the conflict chronic', () => {
    expect(brief(run(gaza, now, null))).toEqual(['PSE:major']);
    const r = run(gaza, now, history('20261110', '20261111'));
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'PSE')).toBe('chronic conflict (recurring)');
  });

  it('trap: one earlier day, or a day more than 7 days ago, is not enough', () => {
    expect(brief(run(gaza, now, history('20261111')))).toEqual(['PSE:major']);
    expect(brief(run(gaza, now, history('20261104', '20261111')))).toEqual(['PSE:major']);
    // A start of today does not count.
    expect(brief(run(gaza, now, history('20261111', '20261112')))).toEqual(['PSE:major']);
  });

  it('trap: an attack in the same country, and another country, still alert', () => {
    const state = history('20261110', '20261111');
    expect(brief(run(four('Suicide bombing kills 12 at Gaza market'), now, state))).toEqual(['PSE:major']);
    expect(brief(run(four('Israeli strikes on southern Lebanon kill 9'), now, state))).toEqual(['LBN:major']);
  });

  it('trap: an attack story with a state attacker is war coverage, so the recurring rule gates it', () => {
    // The live wording of routine Gaza coverage is often "attack", which the attack family takes.
    const attack = four('Israeli attack on Gaza tent camp kills 18');
    expect(run(attack, now, null).candidates.find((c) => c.id === 'PSE')).toMatchObject({ family: 'attack', war: true });
    const r = run(attack, now, history('20261110', '20261111'));
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'PSE')).toBe('chronic conflict (recurring)');
  });

  it('the start of a war attack counts as a conflict start; a terror bombing counts as an attack start', () => {
    expect(run(four('Israeli attack on Gaza tent camp kills 18'), now, null).state.starts).toEqual(['PSE|conflict|20261112']);
    expect(run(four('Suicide bombing kills 12 at Gaza market'), now, null).state.starts).toEqual(['PSE|attack|20261112']);
  });

  it('a live alert does not become chronic from its own start days', () => {
    // The alert started on 11-12 and was renewed on 11-13; on 11-14 only the days before 11-12 count.
    const t = Date.parse('2026-11-14T10:00:00Z');
    const rows = redate(gaza, t - HOUR);
    const entry: HeldAlert = {
      key: 'PSE-conflict-20261112', country: 'PSE', family: 'conflict', level: 'major', since: T1 - HOUR, firstAlertAt: T1,
      lastQualifiedAt: t - 5 * MIN, itemIds: rows.map(idOf), words: [], waveAt: t - 20 * HOUR, waves: 2, peakTier: 2, peakDeaths: 9,
      waveIds: rows.map(idOf), pickId: null,
    };
    const state: BreakingState = { v: 1, savedAt: t - 5 * MIN, alerts: [entry], starts: ['PSE|conflict|20261112', 'PSE|conflict|20261113'] };
    expect(reasonOf(run(rows, t, state), 'PSE')).toBe('major');
  });
});

// ---------------------------------------------------------------- long stories

describe('long stories', () => {
  const rowsAt = (now: number): Row[] => [
    ['bbc_world', 'front', null, 30, 'BBC News', 'Tibet earthquake kills 16 in mountain villages', now - 20 * HOUR],
    ['cbc_world', 'front', null, 1, 'CBC News', 'Tibet earthquake kills 30 in mountain villages', now - HOUR],
    ['dw_world', 'front', null, 2, 'DW', 'Tibet earthquake: 30 killed in mountain villages', now - HOUR],
    ['gn_world', 'gn', 'WORLD', 3, 'Reuters', 'Tibet earthquake kills 30 in remote mountain villages', now - HOUR],
  ];
  const entry = (now: number, rows: Row[]): HeldAlert => ({
    key: 'CHN-disaster-20261110', country: 'CHN', family: 'disaster', level: 'major', since: now - 50 * HOUR, firstAlertAt: now - 49 * HOUR,
    lastQualifiedAt: now - 5 * MIN, itemIds: rows.map(idOf), words: ['mountain', 'villag'], waveAt: now - 5 * HOUR, waves: 2,
    peakTier: 2, peakDeaths: 16, waveIds: ['00000001'], pickId: null,
  });

  it('L11: a story keeps its entry after its oldest headlines leave the lookback (a shared item, no time check)', () => {
    const now = T1;
    const rows = rowsAt(now);
    const r = run(rows, now, { v: 1, savedAt: now - 5 * MIN, alerts: [entry(now, rows)] });
    // The story starts 20 h ago, 30 h after the stored first evidence.
    expect(r.candidates.find((c) => c.id === 'CHN')?.since).toBe(now - 20 * HOUR);
    expect(reasonOf(r, 'CHN')).toBe('major');
    const a = r.response.alerts[0];
    expect([a.key, a.since]).toEqual(['CHN-disaster-20261110', new Date(now - 50 * HOUR).toISOString()]);
    expect(r.state.alerts[0]).toMatchObject({ firstAlertAt: now - 49 * HOUR, waves: 2, waveAt: now - 5 * HOUR });
  });

  it('L12: the ITN follow-up rule compares the blurb with the first evidence of the live alert', () => {
    // ITN dates the quake 11-11. 40 h later a new story would be a follow-up; the live alert of 11-11 goes on.
    const now = Date.parse('2026-11-12T16:00:00Z');
    const itn: Itn = { ...ITN, blurbs: [{ text: 'An earthquake in Tibet, China, kills sixteen people in mountain villages.', date: '2026-11-11T00:00:00.000Z' }] };
    const rows = rowsAt(now).slice(1);
    expect(reasonOf(run(rows, now, null, { itn }), 'CHN')).toBe('ITN follow-up');
    const live: HeldAlert = { ...entry(now, rows), since: Date.parse('2026-11-11T09:30:00Z'), firstAlertAt: Date.parse('2026-11-11T10:00:00Z'), waveAt: now - 10 * HOUR };
    const r = run(rows, now, { v: 1, savedAt: now - 5 * MIN, alerts: [live] }, { itn });
    expect(brief(r)).toEqual(['CHN:major']);
  });
});

describe('L13: detect() stays pure, and its state round-trips', () => {
  it('the same inputs and state give the same output; parseState() reads the state back', () => {
    const r1 = run(GAZA, T1, null);
    const r2 = run([], T1 + 10 * MIN, r1.state);
    const r3 = run(QUAKE_DAY1, T1 + 20 * MIN, r2.state);
    expect(r3.state.ended?.length).toBe(1);
    expect(r3.state.starts?.length).toBe(2);
    const a = run(QUAKE_DAY1, T1 + 30 * MIN, r3.state);
    const b = run(QUAKE_DAY1, T1 + 30 * MIN, structuredClone(r3.state));
    expect(a.response).toEqual(b.response);
    expect(a.state).toEqual(b.state);
    expect(parseState(JSON.parse(JSON.stringify(a.state)))).toEqual(a.state);
  });
});

// ---------------------------------------------------------------- the pulse and the chip use the same items

describe('L14 (trap): a live blog, a video clip or an aggregator copy does not keep the pulse', () => {
  const t0 = Date.parse('2026-11-10T08:00:00Z');
  const base: Row[] = [
    ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Motorway pile-up kills 12 in Bulgaria', t0 - 30 * MIN],
    ['guardian_world', 'front', null, 2, 'The Guardian', '12 killed in Bulgaria motorway pile-up', t0 - 36 * MIN],
    ['dw_world', 'front', null, 2, 'DW', 'Bulgaria: motorway pile-up leaves 12 dead', t0 - 42 * MIN],
  ];
  const r1 = run(base, t0, null);
  // An outlet changes the date of a live blog at each update, so the blog is always "fresh".
  const junk = (t: number): Row[] => [
    ['bbc_world', 'front', null, 1, 'BBC News', 'Live: Bulgaria motorway pile-up kills 12', t - 12 * MIN],
    ['sky_world', 'front', null, 1, 'Sky News', 'Watch: Bulgaria motorway pile-up kills 12', t - 12 * MIN],
    ['gn_top_us', 'gn', 'US', 2, 'Yahoo News', 'Bulgaria motorway pile-up kills 12 in heavy fog', t - 12 * MIN],
  ];

  it('the alert ends when its only fresh leads are junk', () => {
    expect(brief(r1)).toEqual(['BGR:major']);
    const now = t0 + 9 * HOUR;
    const r = run([...base, ...junk(now)], now, r1.state);
    const c = r.candidates.find((x) => x.id === 'BGR')!;
    expect([c.freshLeads, c.pulse]).toEqual([0, false]);
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'BGR')).toBe('ended: no fresh lead headline');
  });

  it('while the alert lives, the chip article is a report of at most 6 h, not the junk', () => {
    for (const h of [1, 3, 5]) {
      const now = t0 + h * HOUR;
      const r = run([...base, ...junk(now)], now, r1.state);
      expect(brief(r)).toEqual(['BGR:major']);
      const a = r.response.alerts[0];
      expect((now - Date.parse(a.publishedAt!)) / HOUR).toBeLessThanOrEqual(6);
      expect(['Al Jazeera', 'The Guardian', 'DW']).toContain(a.source);
    }
  });
});

// ---------------------------------------------------------------- an ITN development

describe('L15 (trap): ITN posts an event on the next day; that alone is no escalation', () => {
  const d1 = Date.parse('2026-11-12T21:00:00Z');
  const crash = (t: number): Row[] => [
    ['bbc_world', 'front', null, 1, 'BBC News', 'Bus plunges into ravine in Peru, killing 25', t],
    ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Bus crash in Peru kills 25 people', t],
    ['guardian_world', 'front', null, 2, 'The Guardian', 'Peru bus crash kills at least 25', t],
  ];
  // The blurb carries the day after the crash.
  const itn: Itn = { ...ITN, blurbs: [{ text: 'A bus plunges into a ravine in Peru, killing 25 people.', date: '2026-11-13T00:00:00.000Z' }] };
  const r1 = run(crash(d1 - 30 * MIN), d1, null);
  const r2 = run(crash(d1 - 30 * MIN), d1 + 6 * HOUR, r1.state, { itn });
  const now = d1 + 15 * HOUR;

  it('the same URLs with new dates and the next-day blurb do not renew the ended story', () => {
    expect(brief(r1)).toEqual(['PER:major']);
    expect(reasonOf(r2, 'PER')).toBe('ended: no fresh lead headline');
    const r = run(redate(crash(0), now - 30 * MIN), now, r2.state, { itn });
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'PER')).toBe('ended earlier: no new wave');
  });

  it('a new headline that tells the blurb is a development', () => {
    const fresh: Row = ['cbc_world', 'front', null, 1, 'CBC News', "Bus plunges into ravine in Peru's Andes, killing 25", now - 30 * MIN];
    const r = run([...redate(crash(0), now - 30 * MIN), fresh], now, r2.state, { itn });
    expect(brief(r)).toEqual(['PER:major']);
    expect(reasonOf(r, 'PER')).toBe('renewed: escalation');
  });

  it('an ended story needs a new headline: a higher toll in the blurb over old URLs is not enough', () => {
    const more: Itn = { ...ITN, blurbs: [{ text: 'A bus plunges into a ravine in Peru, killing 60 people.', date: '2026-11-13T00:00:00.000Z' }] };
    const r = run(redate(crash(0), now - 30 * MIN), now, r2.state, { itn: more });
    expect(r.response.alerts).toEqual([]);
  });
});
