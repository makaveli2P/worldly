import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { worldFeatures, type WorldTopology } from '../../src/data/precompute';
import { worldAssets } from '../../src/globe/assets';
import { mercY } from '../../src/map/mercator';
import { mercatorPositions, planeLonLat } from '../../src/map/plane';

const world = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/data/world.json'), 'utf8')) as WorldTopology;
const features = worldFeatures(world);

describe('mercatorPositions', () => {
  it('builds one time per geometry', () => {
    const g = worldAssets(features).geometry;
    expect(mercatorPositions(g)).toBe(mercatorPositions(g));
  });

  it('puts the vertices in Mercator units, and the pole closure vertices on y = ±π', () => {
    const g = worldAssets(features).geometry;
    const m = mercatorPositions(g);
    const ll = planeLonLat(g);
    expect(m.length).toBe(ll.length);
    let poles = 0;
    let maxY = 0;
    for (let i = 0; i < m.length; i += 2) {
      maxY = Math.max(maxY, Math.abs(m[i + 1]));
      if (Math.abs(ll[i + 1]) === 90) {
        poles++;
        expect(Math.abs(m[i + 1])).toBeCloseTo(Math.PI, 5);
      }
    }
    expect(poles).toBeGreaterThan(0);
    expect(maxY).toBeCloseTo(Math.PI, 5);
    const i = 1000;
    expect(m[i * 2]).toBeCloseTo((ll[i * 2] * Math.PI) / 180, 5);
    expect(m[i * 2 + 1]).toBeCloseTo(mercY(ll[i * 2 + 1]), 5);
  });
});
