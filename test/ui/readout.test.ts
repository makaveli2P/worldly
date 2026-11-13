// @vitest-environment happy-dom
// The readout: the map scale format, and the ALT / SCL swap of the third value.

import { describe, expect, it } from 'vitest';
import { Readout, formatScale } from '../../src/ui/readout';

describe('formatScale', () => {
  it('gives 2 significant digits with K or M', () => {
    expect(formatScale(4.2e7)).toBe('1:42M');
    expect(formatScale(8.5e5)).toBe('1:850K');
    expect(formatScale(1.23e6)).toBe('1:1.2M');
    expect(formatScale(12_345)).toBe('1:12K');
    expect(formatScale(500)).toBe('1:500');
  });

  it('moves to the next unit when the rounding reaches 1000', () => {
    expect(formatScale(999.6)).toBe('1:1K');
    expect(formatScale(999_999)).toBe('1:1M');
  });

  it('gives a dash for a value that is not a scale', () => {
    expect(formatScale(0)).toBe('1:—');
    expect(formatScale(Number.NaN)).toBe('1:—');
  });
});

describe('Readout', () => {
  const third = (r: Readout) => r.el.querySelectorAll('.readout-values > span')[2];

  it('shows ALT on the globe and SCL on the map', () => {
    const r = new Readout();
    r.update({ lat: 10, lng: 20, altitudeKm: 25_004 }, null);
    expect(third(r).textContent).toBe('ALT 25,000 km');
    r.update({ lat: 10, lng: 20, altitudeKm: 5000, scaleDenominator: 4.2e7 }, 'FRA');
    expect(third(r).textContent).toBe('SCL 1:42M');
    r.update({ lat: 10, lng: 20, altitudeKm: 25_004 }, null);
    expect(third(r).textContent).toBe('ALT 25,000 km');
  });

  it('writes the label only when it changes', () => {
    const r = new Readout();
    const name = third(r).firstChild as Text;
    r.update({ lat: 0, lng: 0, altitudeKm: 0, scaleDenominator: 1e7 }, null);
    const after = third(r).firstChild;
    expect(after).toBe(name);
    expect(name.data).toBe('SCL ');
  });
});
