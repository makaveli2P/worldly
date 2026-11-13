// The pick rule that the globe and the flat map share: a raised country first, then the surface,
// with a tolerance for small countries. Each view gives its own projection through at() and near().

import { PICK_SLOP_PX, SLOP_MAX_RADIUS_PX } from './constants';

export interface PickInput {
  /** The raise slots: the country index and the raise amount 0..1 of each. */
  slots: readonly { index: number; amount: number }[];
  /** True angular radius (rad) per country. */
  capRadius: readonly number[];
  /** Countries smaller than this radius get a pick tolerance. */
  smallCap: number;
  /** The country index under the pointer at this raise amount (0 = the surface), -1 for ocean, or less for a miss. */
  at(amount: number): number;
  /** The small country near the pointer (within the pick slop), or -1. */
  near(): number;
}

/** The country index under the pointer, or -1. */
export function pickWithSlop(o: PickInput): number {
  // A raised country sits above the surface: test its cap first.
  for (const s of o.slots) {
    if (s.index < 0 || s.amount < 0.05) continue;
    if (o.at(s.amount) !== s.index) continue;
    if (o.capRadius[s.index] < o.smallCap) return s.index;
    const near = o.near();
    return near >= 0 ? near : s.index;
  }
  const hit = o.at(0);
  if (hit >= 0 && o.capRadius[hit] < o.smallCap) return hit;
  // Micro-states (Vatican, Monaco) are a few px wide: accept a near miss.
  const near = o.near();
  if (near >= 0) return near;
  return hit < 0 ? -1 : hit;
}

/** A small country projected to the screen: the centre of its bounding cap and its radius, in px. */
export interface SmallCandidate {
  index: number;
  x: number;
  y: number;
  radiusPx: number;
}

/**
 * The small country whose projected cap is nearest (x, y) and within PICK_SLOP_PX of its edge, or -1.
 * A country larger than SLOP_MAX_RADIUS_PX on screen gets no slop: the exact pick is enough, and its cap
 * also covers neighbours. The globe and the flat map both use it.
 */
export function nearestSmall(x: number, y: number, candidates: Iterable<SmallCandidate>): number {
  let best = -1;
  let bestD = PICK_SLOP_PX;
  for (const c of candidates) {
    if (c.radiusPx > SLOP_MAX_RADIUS_PX) continue;
    const d = Math.hypot(c.x - x, c.y - y) - c.radiusPx;
    if (d < bestD) {
      bestD = d;
      best = c.index;
    }
  }
  return best;
}
