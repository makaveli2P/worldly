// The stored detector state: parseState() and mergeStates().
import { describe, expect, it } from 'vitest';
import { MERGE_GAP_MS, mergeStates, parseState } from '../../api/_lib/breaking/state.js';
import type { BreakingState, HeldAlert } from '../../api/_lib/breaking/types.js';

const PSE: HeldAlert = {
  key: 'PSE-conflict-20261112', country: 'PSE', family: 'conflict', level: 'major',
  since: 1, firstAlertAt: 2, lastQualifiedAt: 3, itemIds: ['0a1b2c3d', '0a1b2c3e'], words: ['hospital'],
};
const GOOD: BreakingState = { v: 1, savedAt: 1_800_000_000_000, alerts: [PSE] };

describe('parseState()', () => {
  it('reads a valid state, and drops unknown fields', () => {
    expect(parseState(GOOD)).toEqual(GOOD);
    expect(parseState({ ...GOOD, extra: 1, alerts: [{ ...PSE, extra: 1 }] })).toEqual(GOOD);
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
      alerts: [{ ...PSE, level: 'critical', since: 5, firstAlertAt: 1, lastQualifiedAt: 2, itemIds: ['0a1b2c3e', 'ffffffff'], words: ['clinic'] }],
    };
    expect(mergeStates(GOOD, later)).toEqual({
      v: 1, savedAt: later.savedAt,
      alerts: [{ ...PSE, level: 'critical', since: 1, firstAlertAt: 1, lastQualifiedAt: 3, itemIds: ['0a1b2c3e', 'ffffffff', '0a1b2c3d'], words: ['clinic'] }],
    });
  });

  it('two stories with one key and no shared item stay two entries', () => {
    const other: HeldAlert = { ...PSE, itemIds: ['eeeeeeee'], words: ['rafah', 'camp'] };
    expect(mergeStates(GOOD, { v: 1, savedAt: at + 60_000, alerts: [other] })?.alerts).toEqual([other, PSE]);
  });
});
