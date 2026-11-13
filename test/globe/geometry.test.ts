import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { worldFeatures, type WorldTopology } from '../../src/data/precompute';
import { buildGlobeGeometry, lonLatToVec } from '../../src/globe/geometry';
import { MAX_LAT } from '../../src/map/mercator';
import { planeLonLat } from '../../src/map/plane';

const world = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/data/world.json'), 'utf8')) as WorldTopology;
const features = worldFeatures(world);
const g = buildGlobeGeometry(features);
const lonLat = planeLonLat(g);
const lon = (v: number) => lonLat[v * 2];
const lat = (v: number) => lonLat[v * 2 + 1];

describe('planeLonLat (the plane that the flat map gets from the globe geometry)', () => {
  it('has 2 floats per vertex', () => {
    expect(lonLat.length).toBe((g.positions.length / 3) * 2);
  });

  it('keeps the unwrapped lon only for the few polygons at the antimeridian', () => {
    const seamVertices = g.seams.reduce((n, s) => n + s.lon.length, 0);
    expect(seamVertices).toBeGreaterThan(0);
    expect(seamVertices).toBeLessThan(g.positions.length / 3 / 4);
    // Each vertex out of a seam polygon is inside the open lon range, where atan2 is exact.
    const inSeam = new Uint8Array(g.positions.length / 3);
    for (const s of g.seams) inSeam.fill(1, s.start, s.start + s.lon.length);
    for (let i = 0; i < inSeam.length; i++) if (!inSeam[i]) expect(Math.abs(lon(i))).toBeLessThan(179.95);
  });

  it('gives the same point as the unit direction of each vertex', () => {
    const v = [0, 0, 0];
    let worst = 0;
    for (let i = 0; i < g.positions.length / 3; i++) {
      lonLatToVec(lon(i), lat(i), v);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(v[k] - g.positions[i * 3 + k]));
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('has no triangle that jumps across the antimeridian', () => {
    // The fill of the small ring round the South Pole is the one exception: its triangles span the turn,
    // but they lie past MAX_LAT, so the flat map clamps them flat onto its south edge.
    let worst = 0;
    const polar = new Set<string>();
    for (let t = 0; t < g.triangles.length; t += 3) {
      if ([0, 1, 2].every((k) => Math.abs(lat(g.triangles[t + k])) > MAX_LAT)) {
        polar.add(features[g.countryIndex[g.triangles[t]]].id);
        continue;
      }
      const a = lon(g.triangles[t]);
      const b = lon(g.triangles[t + 1]);
      const c = lon(g.triangles[t + 2]);
      worst = Math.max(worst, Math.abs(a - b), Math.abs(b - c), Math.abs(c - a));
    }
    expect(worst).toBeLessThan(180);
    expect([...polar]).toEqual(['ATA']);
  });

  it('unwraps Russia past 180°, so its mesh stays whole on the flat map', () => {
    const ru = features.findIndex((f) => f.id === 'RUS');
    let max = -Infinity;
    for (let i = 0; i < g.countryIndex.length; i++) if (g.countryIndex[i] === ru) max = Math.max(max, lon(i));
    expect(max).toBeGreaterThan(180);
  });

  it('makes no border line on an antimeridian cut or on a pole closure', () => {
    const onMeridian180 = (x: number) => Math.abs(Math.abs(((x + 540) % 360) - 180) - 180) < 0.01;
    let cuts = 0;
    let poles = 0;
    for (let s = 0; s < g.lines.length; s += 2) {
      const a = g.lines[s];
      const b = g.lines[s + 1];
      if (Math.abs(lon(a) - lon(b)) < 1e-9 && onMeridian180(lon(a))) cuts++;
      if (Math.abs(lat(a)) > 89.9 && Math.abs(lat(b)) > 89.9) poles++;
    }
    expect(cuts).toBe(0);
    expect(poles).toBe(0);
  });

  it('closes the Antarctica ring at the pole (the flat map puts those vertices on its south edge)', () => {
    let south = 0;
    for (let i = 0; i < lonLat.length / 2; i++) if (lat(i) === -90) south++;
    expect(south).toBeGreaterThan(0);
  });
});
