// Finds the country at a lon/lat point: bounding-cap prefilter, then d3-geo geoContains.

import { geoArea, geoContains } from 'd3-geo';
import type { CountryFeature } from '../types';
import { lonLatToVec, type BoundingCap } from './geometry';

interface Candidate {
  index: number;
  cap: BoundingCap;
  feature: CountryFeature;
  inverted: boolean; // ring winding is reversed, so geoContains returns the complement
}

export class CountryPicker {
  private readonly candidates: Candidate[];

  constructor(features: CountryFeature[], caps: BoundingCap[]) {
    this.candidates = features
      .map((feature, index) => ({
        index,
        cap: caps[index],
        feature,
        inverted: geoArea(feature.geometry) > 2 * Math.PI,
      }))
      // Small countries first, so a tiny state wins over a big neighbour on a shared edge.
      .sort((a, b) => b.cap.cosRadius - a.cap.cosRadius);
  }

  /** Returns the feature index at the point, or -1 for ocean. */
  pick(lon: number, lat: number): number {
    // world-atlas cuts a tiny circle out of Antarctica at the pole.
    lat = Math.max(-89.99, Math.min(89.99, lat));
    const [x, y, z] = lonLatToVec(lon, lat);
    for (const c of this.candidates) {
      if (x * c.cap.x + y * c.cap.y + z * c.cap.z < c.cap.cosRadius) continue;
      if (geoContains(c.feature.geometry, [lon, lat]) !== c.inverted) return c.index;
    }
    return -1;
  }
}
