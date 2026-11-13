import { describe, expect, it } from 'vitest';
import { MAX_LAT, latOfY, mercY, wrapRad } from '../../src/map/mercator';

describe('mercator', () => {
  it('puts MAX_LAT on y = π: the map is a square', () => {
    expect(mercY(MAX_LAT)).toBeCloseTo(Math.PI, 9);
    expect(mercY(-MAX_LAT)).toBeCloseTo(-Math.PI, 9);
    expect(MAX_LAT).toBeCloseTo((Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI, 9);
  });

  it('puts the equator on y = 0', () => {
    expect(mercY(0)).toBe(0);
    expect(latOfY(0)).toBe(0);
  });

  it('gives back the lat from latOfY(mercY(lat))', () => {
    for (const lat of [-85, -60, -33.3, -1, 0.5, 20, 45, 66.6, 85]) expect(latOfY(mercY(lat))).toBeCloseTo(lat, 9);
  });

  it('grows faster toward the poles (Greenland looks large)', () => {
    expect(mercY(60) - mercY(50)).toBeGreaterThan(mercY(10) - mercY(0));
  });

  it('clamps the lat past ±85.05 to the map edge', () => {
    expect(mercY(89)).toBeCloseTo(Math.PI, 9);
    expect(mercY(90)).toBeCloseTo(Math.PI, 9);
    expect(mercY(-90)).toBeCloseTo(-Math.PI, 9);
    expect(Number.isFinite(mercY(-90))).toBe(true);
  });

  it('wraps an angle into [-π, π)', () => {
    expect(wrapRad(0)).toBe(0);
    expect(wrapRad(Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapRad(-Math.PI)).toBeCloseTo(-Math.PI, 12);
    expect(wrapRad(3 * Math.PI + 0.5)).toBeCloseTo(-Math.PI + 0.5, 12);
    expect(wrapRad(-7)).toBeCloseTo(-7 + 2 * Math.PI, 12);
    for (const x of [-20, -4, -1, 1, 3.1, 4, 13]) {
      const w = wrapRad(x);
      expect(w).toBeGreaterThanOrEqual(-Math.PI);
      expect(w).toBeLessThan(Math.PI);
      expect(Math.cos(w)).toBeCloseTo(Math.cos(x), 12);
    }
  });
});
