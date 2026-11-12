// The hold: an alert of the last run stays an alert while its story keeps some support.
// Each test replays runs in order and gives the state of one run to the next run.
import { describe, expect, it } from 'vitest';
import { CONFIG, detect, itemId } from '../../api/_lib/breaking/detect.js';
import type { BreakingInputs, BreakingState, Headline, Itn } from '../../api/_lib/breaking/types.js';

const T1 = Date.parse('2026-11-12T10:00:00Z');
const MIN = 60_000;
const HOUR = 3.6e6;
// Gaza is not on the "Ongoing" list, so the chronic-war rule does not apply.
const ITN: Itn = { blurbs: [], ongoing: ['Russo-Ukrainian war', 'Sudanese civil war'] };

// [feed, kind, edition, position, publisher, title, published at (epoch ms)]
type Row = [string, 'front' | 'gn', string | null, number, string, string, number];

function run(rows: Row[], now: number, previous: BreakingState | null, extra: Partial<BreakingInputs> = {}) {
  // One article keeps its URL from run to run, also when it moves in its feed.
  const headlines: Headline[] = rows.map(([feed, kind, edition, position, publisher, title, at]) => ({
    feed, kind, edition, position, publisher, title,
    url: `https://example.org/${feed}/${encodeURIComponent(title)}`,
    publishedAt: new Date(at).toISOString(),
  }));
  return detect({ headlines, itn: ITN, hazards: [], now, sources: { ok: 27, total: 27 }, ...extra }, previous);
}
const brief = (r: ReturnType<typeof run>) => r.response.alerts.map((a) => `${a.country}:${a.level}:${a.outlets}`);
const reasonOf = (r: ReturnType<typeof run>, id: string) => r.candidates.find((c) => c.id === id)?.reason;
const idOf = (r: Row) => itemId(`https://example.org/${r[0]}/${encodeURIComponent(r[5])}`);

// The story of 2026-11-12: 3 outlets lead with it, then one leaves.
const at = T1 - 40 * MIN;
const BBC: Row = ['bbc_world', 'front', null, 1, 'BBC News', 'Israeli strike on Gaza hospital kills six Palestinians', at];
const AJ: Row = ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Six killed in Israeli strike on Gaza hospital', at];
const GUARDIAN: Row = ['guardian_world', 'front', null, 2, 'The Guardian', 'Israeli strike on Gaza hospital kills 6, health officials say', at];
const GUARDIAN_LOW: Row = ['guardian_world', 'front', null, 8, 'The Guardian', 'Israeli strike on Gaza hospital kills 6, health officials say', at];

describe('the hold (Gaza hospital strike, 2026-11-12)', () => {
  const run1 = run([BBC, AJ, GUARDIAN], T1, null);
  const run2 = run([AJ, GUARDIAN_LOW], T1 + 5 * MIN, run1.state);

  it('run 1: 3 outlets lead with the story, so it is a major alert', () => {
    expect(brief(run1)).toEqual(['PSE:major:3']);
    expect(reasonOf(run1, 'PSE')).toBe('major');
    expect(run1.state.alerts).toEqual([
      {
        key: 'PSE-conflict-20261112', country: 'PSE', family: 'conflict', level: 'major', since: at, firstAlertAt: T1, lastQualifiedAt: T1,
        itemIds: [BBC, AJ, GUARDIAN].map(idOf), words: [...run1.state.alerts[0].words],
      },
    ]);
    expect(run1.state.alerts[0].words.length).toBeGreaterThan(0);
  });

  it('run 2 with no state: 2 voices (ed=0 lead=1) are below the bar, so the alert vanishes', () => {
    const r = run([AJ, GUARDIAN_LOW], T1 + 5 * MIN, null);
    expect(r.response.alerts).toEqual([]);
    const c = r.candidates.find((x) => x.id === 'PSE')!;
    expect([c.voices, c.editions, c.lead]).toEqual([2, 0, 1]);
  });

  it('run 2 with the state: the alert is held, with the same key', () => {
    expect(brief(run2)).toEqual(['PSE:major:2']);
    expect(run2.response.alerts[0].key).toBe(run1.response.alerts[0].key);
    expect(reasonOf(run2, 'PSE')).toBe('held: 2 voices lead');
    // The first alert time stays; the last qualified time stays at run 1.
    expect(run2.state.alerts[0]).toMatchObject({ firstAlertAt: T1, lastQualifiedAt: T1, level: 'major' });
  });

  it('run 3: the story is older than 24 h, so the hold ends', () => {
    // Fresh headlines only: the story itself starts late, but the state keeps the first evidence of run 1.
    const now = at + (CONFIG.maxAgeHours + 0.5) * HOUR;
    const fresh = (r: Row): Row => [...r.slice(0, 6), now - 2 * HOUR] as Row;
    const r = run([fresh(AJ), fresh(GUARDIAN_LOW)], now, run2.state);
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'PSE')).toBe('hold ended: older than 24 h');
    expect(r.state.alerts).toEqual([]);
  });

  it('one voice keeps the alert for the first 2 h only', () => {
    const r3 = run([AJ], T1 + 1 * HOUR, run2.state);
    expect(brief(r3)).toEqual(['PSE:major:1']);
    expect(reasonOf(r3, 'PSE')).toBe('held: alert under 2 h old');
    const r4 = run([AJ], T1 + 2 * HOUR + 5 * MIN, r3.state);
    expect(r4.response.alerts).toEqual([]);
    expect(reasonOf(r4, 'PSE')).toBe('hold ended: below hold');
    expect(r4.state.alerts).toEqual([]);
  });

  it('a story that is gone leaves the state', () => {
    const r = run([], T1 + 10 * MIN, run2.state);
    expect(r.response.alerts).toEqual([]);
    expect(r.state.alerts).toEqual([]);
  });

  it('the chronic-war rule ends the hold', () => {
    const chronic: Itn = { blurbs: [], ongoing: ['Gaza war'] };
    const r = run([AJ, GUARDIAN_LOW], T1 + 5 * MIN, run1.state, { itn: chronic });
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'PSE')).toBe('hold ended: chronic conflict');
    // Also with 3 outlets: the full test fails on the chronic rule, and the hold does not override it.
    expect(run([BBC, AJ, GUARDIAN], T1 + 5 * MIN, run1.state, { itn: chronic }).response.alerts).toEqual([]);
  });

  it('the ITN follow-up rule ends the hold', () => {
    // ITN told the story 2 days ago, so the headlines of today are a follow-up.
    const itn: Itn = { ...ITN, blurbs: [{ text: 'Israeli strike on Gaza hospital kills six Palestinians.', date: '2026-11-10T00:00:00.000Z' }] };
    const r = run([AJ, GUARDIAN_LOW], T1 + 5 * MIN, run1.state, { itn });
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'PSE')).toBe('hold ended: ITN follow-up');
  });

  it('the follow-up rule with no ITN ends the hold', () => {
    // With no ITN, a story that spans more than 12 h is a follow-up. (PSE is on the fallback chronic
    // list then, so the test uses a crash in Peru.)
    const crash = (pos: number, publisher: string, feed: string, title: string, t: number): Row => [feed, 'front', null, pos, publisher, title, t];
    const rows = [
      crash(1, 'BBC News', 'bbc_world', 'Tourist bus crash in Peru Andes kills 20', at),
      crash(1, 'Al Jazeera', 'aljazeera', 'Peru: tourist bus crash in the Andes kills 20', at),
      crash(2, 'The Guardian', 'guardian_world', 'Tourist bus crash kills 20 in Peru Andes', at),
    ];
    const r1 = run(rows, T1, null, { itn: null });
    expect(brief(r1)).toEqual(['PER:major:3']);
    // An older headline of the same story (3 shared words) makes the story span 13 h.
    const old = crash(30, 'BBC News', 'bbc_world', 'Tourist bus crash in Peru Andes kills 20', T1 - 13 * HOUR);
    const r2 = run([old, rows[1], rows[2]], T1 + 5 * MIN, r1.state, { itn: null });
    expect(r2.response.alerts).toEqual([]);
    expect(reasonOf(r2, 'PER')).toBe('hold ended: follow-up (no ITN)');
  });

  it('the story passes the full test again: the alert is no longer held', () => {
    const r = run([BBC, AJ, GUARDIAN], T1 + 10 * MIN, run2.state);
    expect(reasonOf(r, 'PSE')).toBe('major');
    expect(r.state.alerts[0]).toMatchObject({ firstAlertAt: T1, lastQualifiedAt: T1 + 10 * MIN });
  });
});

describe('the hold follows one story, not every story of the country and kind', () => {
  // A second PSE conflict story on the same day. It has the same key, but it never passes the full test.
  const DW_RAFAH: Row = ['dw', 'front', null, 2, 'DW', 'Israeli strike on Rafah refugee camp kills two Palestinians', T1 + 60 * MIN];
  const GN_RAFAH: Row = ['gn_top_gb', 'gn', 'GB', 3, 'Sky News', 'Two Palestinians killed in Israeli strike on Rafah refugee camp', T1 + 60 * MIN];
  const run1 = run([BBC, AJ, GUARDIAN], T1, null);

  it('the alert story is gone: another story with the same key is not held', () => {
    const now = T1 + 80 * MIN;
    expect(run([DW_RAFAH, GN_RAFAH], now, null).response.alerts).toEqual([]);
    const r = run([DW_RAFAH, GN_RAFAH], now, run1.state);
    expect(r.response.alerts).toEqual([]);
    expect(reasonOf(r, 'PSE')).toBe('below thresholds');
    expect(r.state.alerts).toEqual([]);
    // One voice in the first 2 h does not hold it either.
    expect(run([DW_RAFAH], now, run1.state).response.alerts).toEqual([]);
  });

  it('the alert story is weaker than another story: the hold stays with the alert story', () => {
    const r = run([AJ, GUARDIAN_LOW, DW_RAFAH, GN_RAFAH], T1 + 80 * MIN, run1.state);
    const gaza = r.candidates.find((c) => c.id === 'PSE' && /Gaza/.test(c.best.h.title))!;
    const rafah = r.candidates.find((c) => c.id === 'PSE' && /Rafah/.test(c.best.h.title))!;
    // The Rafah story has the higher score, but it is not the story of the alert.
    expect(rafah.score).toBeGreaterThan(gaza.score);
    expect(gaza.reason).toBe('held: 2 voices lead');
    expect(rafah.reason).toBe('below thresholds');
    expect(r.response.alerts.map((a) => [a.country, a.headline])).toEqual([['PSE', AJ[5]]]);
    expect(r.state.alerts[0]).toMatchObject({ firstAlertAt: T1, since: at });
  });

  it('the same story with new URLs is found by its words', () => {
    const moved = (r: Row): Row => [`${r[0]}_live`, ...r.slice(1)] as Row;
    const r = run([moved(AJ), moved(GUARDIAN_LOW)], T1 + 5 * MIN, run1.state);
    expect(brief(r)).toEqual(['PSE:major:2']);
    expect(reasonOf(r, 'PSE')).toBe('held: 2 voices lead');
  });
});

describe('the hold of a critical alert', () => {
  const ESTONIA: Row[] = [
    ['bbc_top', 'front', null, 1, 'BBC News', 'Russia invades Estonia as tanks cross border at Narva', T1 - HOUR],
    ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Russia launches invasion of Estonia', T1 - HOUR],
    ['guardian_world', 'front', null, 1, 'The Guardian', 'Russia invades Estonia in dawn assault', T1 - HOUR],
    ['gn_world', 'gn', 'WORLD', 1, 'Reuters', 'Russian forces invade Estonia, NATO invokes Article 5', T1 - HOUR],
    ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Russia invades Estonia', T1 - HOUR],
    ['gn_top_gb', 'gn', 'GB', 1, 'Sky News', 'Russia invades Estonia', T1 - HOUR],
  ];

  it('a critical alert that weakens is held as major, not dropped', () => {
    const r1 = run(ESTONIA, T1, null);
    expect(brief(r1)).toEqual(['EST:critical:6']);
    const r2 = run(ESTONIA.slice(0, 2), T1 + 5 * MIN, r1.state);
    expect(brief(r2)).toEqual(['EST:major:2']);
    expect(reasonOf(r2, 'EST')).toBe('held: 2 voices lead');
    expect(r2.state.alerts[0]).toMatchObject({ level: 'major', firstAlertAt: T1, lastQualifiedAt: T1 });
  });
});

describe('the hold and the alert limit', () => {
  // Each country has its own feed positions: one feed item belongs to one story.
  const POS: Record<string, number> = { Peru: 1, Kenya: 2, Nepal: 3, Bolivia: 4 };
  const crash = (name: string, n: number, minutesAgo = 30): Row[] => [
    ['bbc_world', 'front', null, POS[name], 'BBC News', `Bus crash kills ${n} in ${name}`, T1 - minutesAgo * MIN],
    ['aljazeera', 'front', null, Math.min(POS[name], 3), 'Al Jazeera', `${name} bus crash kills ${n}`, T1 - minutesAgo * MIN],
    ['gn_world', 'gn', 'WORLD', POS[name], 'Reuters', `${n} killed in ${name} bus crash`, T1 - minutesAgo * MIN],
  ];

  it('a new alert that passes the full test pushes a held alert off the list', () => {
    const r1 = run([...crash('Peru', 40), ...crash('Kenya', 15), ...crash('Nepal', 12)], T1, null);
    expect(r1.response.alerts.map((a) => a.country)).toEqual(['PER', 'KEN', 'NPL']);
    // Peru drops to 2 voices, but its score (40 dead, an edition and a lead) stays above the new Bolivia alert.
    const peru = crash('Peru', 40).filter((r) => r[0] !== 'bbc_world');
    const r2 = run([...peru, ...crash('Kenya', 15), ...crash('Nepal', 12), ...crash('Bolivia', 8, 10)], T1 + 5 * MIN, r1.state);
    const held = r2.candidates.find((c) => c.id === 'PER')!;
    const bolivia = r2.candidates.find((c) => c.id === 'BOL')!;
    expect(held.held).toBe(true);
    expect(held.score).toBeGreaterThan(bolivia.score);
    expect(r2.response.alerts.map((a) => a.country)).toEqual(['KEN', 'NPL', 'BOL']);
    // Peru is not on the list, so it leaves the state.
    expect(r2.state.alerts.map((a) => a.country)).toEqual(['KEN', 'NPL', 'BOL']);
  });

  it('a held alert keeps its place when the list has room', () => {
    const r1 = run([...crash('Peru', 40), ...crash('Kenya', 15)], T1, null);
    const peru = crash('Peru', 40).filter((r) => r[0] !== 'bbc_world');
    const r2 = run([...peru, ...crash('Kenya', 15)], T1 + 5 * MIN, r1.state);
    expect(r2.response.alerts.map((a) => a.country)).toEqual(['KEN', 'PER']);
  });
});

describe('detect() stays pure', () => {
  it('the same inputs and state give the same output', () => {
    const r1 = run([BBC, AJ, GUARDIAN], T1, null);
    const a = run([AJ, GUARDIAN_LOW], T1 + 5 * MIN, r1.state);
    const b = run([AJ, GUARDIAN_LOW], T1 + 5 * MIN, structuredClone(r1.state));
    expect(a.response).toEqual(b.response);
    expect(a.state).toEqual(b.state);
  });
});
