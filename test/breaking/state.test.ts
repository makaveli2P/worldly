// The stored detector state: parseState() and mergeStates().
import { describe, expect, it } from 'vitest';
import { MERGE_GAP_MS, mergeStates, parseState } from '../../api/_lib/breaking/state.js';
import type { BreakingState, EndedAlert, HeldAlert } from '../../api/_lib/breaking/types.js';

const PSE: HeldAlert = {
  key: 'PSE-conflict-20261112', country: 'PSE', family: 'conflict', level: 'major',
  since: 1, firstAlertAt: 2, lastQualifiedAt: 3, itemIds: ['0a1b2c3d', '0a1b2c3e'], words: ['hospital'],
  waveAt: 2, waves: 1, peakTier: 2, peakDeaths: 6, waveIds: ['0a1b2c3d'], pickId: '0a1b2c3d',
};
// An entry from before the life rules: no wave, peak or pick fields.
const { waveAt: _w, waves: _n, peakTier: _t, peakDeaths: _d, waveIds: _i, pickId: _p, ...OLD } = PSE;
const ENDED: EndedAlert = {
  key: 'BGR-accident-20261110', country: 'BGR', family: 'accident', since: 1, firstAlertAt: 2, waveAt: 2, waves: 1,
  endedAt: 5, peakTier: 2, peakDeaths: 12, itemIds: ['00000001'], words: ['motorway'],
};
const GOOD: BreakingState = { v: 1, savedAt: 1_800_000_000_000, alerts: [PSE] };

describe('parseState()', () => {
  it('reads a valid state, and drops unknown fields', () => {
    expect(parseState(GOOD)).toEqual(GOOD);
    expect(parseState({ ...GOOD, extra: 1, alerts: [{ ...PSE, extra: 1 }] })).toEqual(GOOD);
  });

  it('reads an entry from before the life rules with defaults (wave = first alert, peak tier from the level)', () => {
    expect(parseState({ ...GOOD, alerts: [OLD] })?.alerts).toEqual([
      { ...OLD, waveAt: 2, waves: 1, peakTier: 2, peakDeaths: 0, waveIds: OLD.itemIds, pickId: null },
    ]);
    expect(parseState({ ...GOOD, alerts: [{ ...OLD, level: 'critical' }] })?.alerts[0].peakTier).toBe(3);
  });

  it('reads the ended stories and the start days', () => {
    const state = { ...GOOD, ended: [ENDED], starts: ['PSE|conflict|20261110', 'X-kosovo|attack|20261111'] };
    expect(parseState(state)).toEqual(state);
    // Empty lists are left out.
    expect(parseState({ ...GOOD, ended: [], starts: [] })).toEqual(GOOD);
  });

  it('gives null for a value that is not a valid state', () => {
    for (const bad of [
      null, undefined, 'x', 42, [],
      { ...GOOD, v: 2 },
      { ...GOOD, savedAt: '2026-11-12' },
      { ...GOOD, alerts: 'x' },
      { ...GOOD, alerts: [{ ...PSE, level: 'minor' }] },
      { ...GOOD, alerts: [{ ...PSE, family: 'sport' }] },
      { ...GOOD, alerts: [{ ...PSE, since: null }] },
      { ...GOOD, alerts: [{ ...PSE, key: '' }] },
      { ...GOOD, alerts: [{ ...PSE, itemIds: undefined }] },
      { ...GOOD, alerts: [{ ...PSE, itemIds: ['https://example.org/a'] }] },
      { ...GOOD, alerts: [{ ...PSE, itemIds: Array(41).fill('0a1b2c3d') }] },
      { ...GOOD, alerts: [{ ...PSE, words: 'hospital' }] },
      { ...GOOD, alerts: [{ ...PSE, words: [''] }] },
      { ...GOOD, alerts: [null] },
      { ...GOOD, alerts: [{ ...PSE, waveAt: 'x' }] },
      { ...GOOD, alerts: [{ ...PSE, peakTier: 4 }] },
      { ...GOOD, alerts: [{ ...PSE, waveIds: Array(21).fill('0a1b2c3d') }] },
      { ...GOOD, alerts: [{ ...PSE, pickId: 'https://example.org/a' }] },
      { ...GOOD, ended: 'x' },
      { ...GOOD, ended: Array(11).fill(ENDED) },
      { ...GOOD, ended: [{ ...ENDED, itemIds: ['bad hash'] }] },
      { ...GOOD, ended: [{ ...ENDED, endedAt: null }] },
      { ...GOOD, starts: Array(61).fill('PSE|conflict|20261110') },
      { ...GOOD, starts: ['PSE|sport|20261110'] },
      { ...GOOD, starts: ['PSE|conflict|2026-11-10'] },
    ]) {
      expect(parseState(bad)).toBeNull();
    }
  });
});

describe('mergeStates()', () => {
  const at = GOOD.savedAt;
  const empty = (savedAt: number): BreakingState => ({ v: 1, savedAt, alerts: [] });

  it('gives the other state when one is null', () => {
    expect(mergeStates(null, GOOD)).toBe(GOOD);
    expect(mergeStates(GOOD, null)).toBe(GOOD);
    expect(mergeStates(null, null)).toBeNull();
  });

  it('a newer state with no alerts does not remove an alert of a state at most 15 minutes older', () => {
    expect(mergeStates(GOOD, empty(at + 6 * 60_000))).toEqual({ v: 1, savedAt: at + 6 * 60_000, alerts: [PSE] });
    expect(mergeStates(empty(at + MERGE_GAP_MS), GOOD)?.alerts).toEqual([PSE]);
  });

  it('a newer state removes the alerts of a state more than 15 minutes older', () => {
    expect(mergeStates(GOOD, empty(at + MERGE_GAP_MS + 1))).toEqual(empty(at + MERGE_GAP_MS + 1));
  });

  it('one story in both states gives one entry with the earliest start and the latest qualified time', () => {
    const later: BreakingState = {
      v: 1, savedAt: at + 60 * 60_000,
      alerts: [{ ...PSE, level: 'critical', since: 5, firstAlertAt: 1, lastQualifiedAt: 2, itemIds: ['0a1b2c3e', 'ffffffff'], words: ['clinic'], peakTier: 3 }],
    };
    expect(mergeStates(GOOD, later)).toEqual({
      v: 1, savedAt: later.savedAt,
      alerts: [{ ...PSE, level: 'critical', since: 1, firstAlertAt: 1, lastQualifiedAt: 3, itemIds: ['0a1b2c3e', 'ffffffff', '0a1b2c3d'], words: ['clinic'], peakTier: 3 }],
    });
  });

  it('keeps the later wave and the higher peak of one story', () => {
    const later: BreakingState = { v: 1, savedAt: at + 60_000, alerts: [{ ...PSE, waveAt: 1, waves: 1, peakDeaths: 2 }] };
    const earlier: BreakingState = { v: 1, savedAt: at, alerts: [{ ...PSE, waveAt: 9, waves: 2, waveIds: ['ffffffff'], peakDeaths: 30 }] };
    expect(mergeStates(earlier, later)?.alerts[0]).toMatchObject({ waveAt: 9, waves: 2, waveIds: ['ffffffff'], peakDeaths: 30 });
  });

  it('joins the ended stories: one entry per story with the latest end, and a live entry wins', () => {
    const a: BreakingState = { v: 1, savedAt: at, alerts: [], ended: [ENDED], starts: ['BGR|accident|20261110'] };
    const b: BreakingState = { v: 1, savedAt: at + 60 * 60_000, alerts: [], ended: [{ ...ENDED, endedAt: 9 }], starts: ['PSE|conflict|20261112'] };
    expect(mergeStates(a, b)).toEqual({
      v: 1, savedAt: b.savedAt, alerts: [], ended: [{ ...ENDED, endedAt: 9 }], starts: ['BGR|accident|20261110', 'PSE|conflict|20261112'],
    });
    // The other state still has the story live: the live entry wins over the ended entry.
    const live: HeldAlert = { ...PSE, key: ENDED.key, country: 'BGR', family: 'accident', itemIds: ['00000001'] };
    const c: BreakingState = { v: 1, savedAt: at + 5 * 60_000, alerts: [live] };
    expect(mergeStates(a, c)).toEqual({ v: 1, savedAt: c.savedAt, alerts: [live], starts: ['BGR|accident|20261110'] });
    // Another story with the same key (no shared item) stays ended.
    const other: HeldAlert = { ...live, itemIds: ['eeeeeeee'] };
    expect(mergeStates(a, { ...c, alerts: [other] })?.ended).toEqual([ENDED]);
  });

  it('two stories with one key and no shared item stay two entries', () => {
    const other: HeldAlert = { ...PSE, itemIds: ['eeeeeeee'], words: ['rafah', 'camp'] };
    expect(mergeStates(GOOD, { v: 1, savedAt: at + 60_000, alerts: [other] })?.alerts).toEqual([other, PSE]);
  });
});
