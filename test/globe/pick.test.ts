import { describe, expect, it } from 'vitest';
import { PICK_SLOP_PX, SLOP_MAX_RADIUS_PX } from '../../src/globe/constants';
import { nearestSmall, pickWithSlop, type PickInput } from '../../src/globe/pick';

const SMALL = 0.01;
// Country 0 is large, 1 is small (a micro-state), 2 is large.
const capRadius = [0.2, 0.001, 0.3];
const free = [{ index: -1, amount: 0 }];

function input(o: Partial<PickInput>): PickInput {
  return { slots: free, capRadius, smallCap: SMALL, at: () => -1, near: () => -1, ...o };
}

describe('pickWithSlop', () => {
  it('tests the cap of a raised country first', () => {
    const asked: number[] = [];
    const at = (amount: number) => {
      asked.push(amount);
      return amount > 0 ? 2 : 0; // the raised cap of 2 hangs over country 0
    };
    expect(pickWithSlop(input({ slots: [{ index: 2, amount: 1 }], at }))).toBe(2);
    expect(asked[0]).toBe(1);
  });

  it('skips a slot that is free, nearly flat, or not under the pointer', () => {
    const at = (amount: number) => (amount > 0 ? 0 : 0);
    const slots = [
      { index: -1, amount: 1 },
      { index: 2, amount: 0.01 },
      { index: 2, amount: 1 },
    ];
    expect(pickWithSlop(input({ slots, at }))).toBe(0);
  });

  it('prefers a small country inside the slop over a large hit', () => {
    expect(pickWithSlop(input({ at: () => 0, near: () => 1 }))).toBe(1);
    // Also on top of a raised large country.
    expect(pickWithSlop(input({ slots: [{ index: 2, amount: 1 }], at: () => 2, near: () => 1 }))).toBe(1);
  });

  it('keeps an exact hit on a small country without asking for the slop', () => {
    let asked = false;
    const near = () => {
      asked = true;
      return -1;
    };
    expect(pickWithSlop(input({ at: () => 1, near }))).toBe(1);
    expect(asked).toBe(false);
  });

  it('gives the ocean or a miss as -1, and no slop above SLOP_MAX_RADIUS_PX (near() gives -1)', () => {
    expect(pickWithSlop(input({ at: () => -1 }))).toBe(-1);
    expect(pickWithSlop(input({ at: () => -2 }))).toBe(-1);
    // The view's near() skips a small country larger than SLOP_MAX_RADIUS_PX on screen: the exact hit stays.
    expect(pickWithSlop(input({ at: () => 0, near: () => -1 }))).toBe(0);
  });
});

describe('nearestSmall', () => {
  it('accepts a near miss within PICK_SLOP_PX of the cap edge, and takes the nearest', () => {
    const cands = [
      { index: 7, x: 100, y: 100, radiusPx: 2 },
      { index: 8, x: 108, y: 100, radiusPx: 2 },
    ];
    expect(nearestSmall(103, 100, cands)).toBe(7);
    expect(nearestSmall(106, 100, cands)).toBe(8);
    expect(nearestSmall(100, 100 + 2 + PICK_SLOP_PX - 0.5, cands)).toBe(7);
    expect(nearestSmall(100, 100 + 2 + PICK_SLOP_PX + 0.5, cands)).toBe(-1);
  });

  it('gives no slop to a country above SLOP_MAX_RADIUS_PX on screen', () => {
    const r = SLOP_MAX_RADIUS_PX + 1;
    expect(nearestSmall(100 + r + 1, 100, [{ index: 3, x: 100, y: 100, radiusPx: r }])).toBe(-1);
    expect(nearestSmall(100 + SLOP_MAX_RADIUS_PX + 1, 100, [{ index: 3, x: 100, y: 100, radiusPx: SLOP_MAX_RADIUS_PX }])).toBe(3);
  });
});
