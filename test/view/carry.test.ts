// The zoom that carries from the globe to the map and back (src/view/carry.ts).

import { describe, expect, it } from 'vitest';
import { EARTH_KM, MIN_DIST } from '../../src/globe/constants';
import {
  HOME_SNAP,
  distanceForKmPerPx,
  globeZoomRatio,
  handOnKmPerPx,
  kmPerPxGlobe,
  kmPerPxMap,
  mapScale,
  scaleForKmPerPx,
} from '../../src/view/carry';

const H = 900;

describe('globe and map ground scale', () => {
  it('kmPerPxGlobe and distanceForKmPerPx are inverses', () => {
    for (const d of [1.05, 1.3, 2, 4.9, 6]) expect(distanceForKmPerPx(kmPerPxGlobe(d, H), H)).toBeCloseTo(d, 10);
  });

  it('kmPerPxMap and scaleForKmPerPx are inverses', () => {
    for (const lat of [0, 45, 70]) {
      for (const s of [150, 600, 4000]) expect(scaleForKmPerPx(kmPerPxMap(s, lat), lat)).toBeCloseTo(s, 8);
    }
  });

  it('carries the zoom globe -> map -> globe at 0°, 45° and 70°', () => {
    for (const lat of [0, 45, 70]) {
      const d = 2.2;
      const k = kmPerPxGlobe(d, H);
      const s = scaleForKmPerPx(k, lat);
      // The map shows the same ground scale at the centre.
      expect(kmPerPxMap(s, lat)).toBeCloseTo(k, 10);
      expect(distanceForKmPerPx(kmPerPxMap(s, lat), H)).toBeCloseTo(d, 10);
    }
  });

  it('a map scale gets larger toward the poles for the same ground scale', () => {
    const k = 5;
    expect(scaleForKmPerPx(k, 70)).toBeCloseTo((EARTH_KM * Math.cos((70 * Math.PI) / 180)) / k, 8);
    expect(scaleForKmPerPx(k, 70)).toBeLessThan(scaleForKmPerPx(k, 0));
  });
});

describe('the home zoom', () => {
  it('gives null near the home zoom and k elsewhere', () => {
    expect(handOnKmPerPx(1, 7)).toBeNull();
    expect(handOnKmPerPx(1 + HOME_SNAP * 0.9, 7)).toBeNull();
    expect(handOnKmPerPx(1 - HOME_SNAP * 0.9, 7)).toBeNull();
    expect(handOnKmPerPx(1 + HOME_SNAP * 1.1, 7)).toBe(7);
    expect(handOnKmPerPx(0.5, 7)).toBe(7);
  });

  it('a zoom that fits a country is never home', () => {
    expect(handOnKmPerPx(null, 3)).toBe(3);
  });

  it('null gives the home zoom of the target view', () => {
    expect(globeZoomRatio(null, H, 4.9, 6)).toBe(1);
    expect(mapScale(null, 40, { home: 245, min: 229, max: 11000 })).toBe(245);
  });
});

describe('the clamps', () => {
  const fit = 4.9;
  const maxDistance = 6;
  it('the globe stops at MIN_DIST and at its farthest distance', () => {
    expect(globeZoomRatio(1e-6, H, fit, maxDistance)).toBeCloseTo(MIN_DIST / fit, 10);
    expect(globeZoomRatio(1e6, H, fit, maxDistance)).toBeCloseTo(maxDistance / fit, 10);
    const k = kmPerPxGlobe(3, H);
    expect(globeZoomRatio(k, H, fit, maxDistance)).toBeCloseTo(3 / fit, 10);
  });

  it('the map stops at sMin and sMax', () => {
    const limits = { home: 245, min: 229, max: 11000 };
    expect(mapScale(1e6, 0, limits)).toBe(229);
    expect(mapScale(1e-6, 0, limits)).toBe(11000);
    expect(mapScale(kmPerPxMap(800, 30), 30, limits)).toBeCloseTo(800, 8);
  });
});
