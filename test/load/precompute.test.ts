import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { geoArea } from 'd3-geo';
import type { MultiPolygon, Polygon } from 'geojson';
import { afterEach, describe, expect, it } from 'vitest';
import { LITE_FIELDS, buildLabelsFile, liteCountries, worldFeatures, type WorldTopology } from '../../src/data/precompute';
import { buildGlobeGeometry } from '../../src/globe/geometry';
import {
  computeLabelSites,
  packLabelSites,
  unpackLabelSites,
  usePrecomputedLabelSites,
  type LabelSite,
} from '../../src/overlay/labelPoints';
import type { CountryFeature, CountryInfo } from '../../src/types';

const root = join(import.meta.dirname, '../..');
const world = JSON.parse(readFileSync(join(root, 'public/data/world.json'), 'utf8')) as WorldTopology;

const square = (id: string, lon: number, lat: number, size: number): CountryFeature => ({
  id,
  name: id,
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [lon, lat],
        [lon + size, lat],
        [lon + size, lat + size],
        [lon, lat + size],
        [lon, lat],
      ],
    ],
  },
});

afterEach(() => usePrecomputedLabelSites(null));

describe('label sites from the build', () => {
  it('packs and unpacks sites with 1e-4 degree rounding', () => {
    const sites = new Map<string, LabelSite>([
      ['AAA', { id: 'AAA', lat: 10.123456, lng: -20.98766, areaKm2: 1234.6, extra: [[1.000049, 2.5]] }],
      ['BBB', { id: 'BBB', lat: 0, lng: 0, areaKm2: 1, extra: [] }],
    ]);
    const back = unpackLabelSites(packLabelSites(sites));
    expect(back.get('AAA')).toEqual({ id: 'AAA', lat: 10.1235, lng: -20.9877, areaKm2: 1235, extra: [[1, 2.5]] });
    expect(back.get('BBB')?.extra).toEqual([]);
  });

  it('skips rows with a bad shape', () => {
    const back = unpackLabelSites({ A: [1, 2], B: [1, 2, 3, 4], C: [1, 2, Number.NaN], D: [1, 2, 3] });
    expect([...back.keys()]).toEqual(['D']);
  });

  it('uses the precomputed sites and computes only the missing features', () => {
    const a = square('AAA', 0, 0, 4);
    const b = square('BBB', 20, 20, 4);
    usePrecomputedLabelSites(new Map([['AAA', { id: 'AAA', lat: 50, lng: 50, areaKm2: 7, extra: [] }]]));
    const sites = computeLabelSites([a, b]);
    expect(sites.get('AAA')?.lat).toBe(50);
    const bb = sites.get('BBB')!;
    expect(bb.lat).toBeGreaterThan(20);
    expect(bb.lat).toBeLessThan(24);
  });

  it('builds labels.json from world.json: one site per feature, the arc count and the inverted features', () => {
    const file = buildLabelsFile(world);
    const features = worldFeatures(world);
    expect(file.v).toBe(1);
    expect(file.arcs).toBe(world.arcs.length);
    expect(Object.keys(file.sites).sort()).toEqual(features.map((f) => f.id).sort());
    const inverted = features.filter((f) => geoArea(f.geometry) > 2 * Math.PI).map((f) => f.id);
    expect(file.inverted).toEqual(inverted);
    // The packed sites give the same result as a computation at start, to 1e-4 degrees.
    const live = computeLabelSites(features);
    const packed = unpackLabelSites(file.sites);
    for (const [id, s] of live) {
      expect(Math.abs(packed.get(id)!.lat - s.lat)).toBeLessThan(1e-4);
      expect(Math.abs(packed.get(id)!.lng - s.lng)).toBeLessThan(1e-4);
    }
  });
});

describe('liteCountries', () => {
  it('keeps only the fields that the first frame needs', () => {
    const full = {
      FRA: { id: 'FRA', name: 'France', capital: ['Paris'], latlng: [46, 2], area: 1, population: 2, region: 'Europe', wikipedia: 'x' },
    } as unknown as Record<string, CountryInfo>;
    const lite = liteCountries(full);
    expect(Object.keys(lite.FRA).sort()).toEqual(['area', 'capital', 'id', 'latlng', 'name', 'population']);
    for (const k of Object.keys(lite.FRA)) expect(LITE_FIELDS).toContain(k);
  });
});

describe('buildGlobeGeometry', () => {
  // The refine step uses a squared-length test. Every cap edge must still be 2° or shorter in the
  // metric of the old edgeLength(): dx scaled by cos(min |lat|), dy in degrees.
  const MAX_EDGE = 2;
  const RAD = Math.PI / 180;
  const edgeDeg = (p: Float32Array, a: number, b: number) => {
    const lat = (i: number) => Math.asin(Math.max(-1, Math.min(1, p[i * 3 + 1]))) / RAD;
    const lon = (i: number) => Math.atan2(p[i * 3], p[i * 3 + 2]) / RAD;
    let dl = Math.abs(lon(b) - lon(a));
    if (dl > 180) dl = 360 - dl;
    const c = Math.cos(Math.min(Math.abs(lat(a)), Math.abs(lat(b))) * RAD);
    return Math.hypot(dl * c, lat(b) - lat(a));
  };

  it('splits every long cap edge, also at high latitude and across the antimeridian', () => {
    const features: CountryFeature[] = [
      square('EQU', -10, -5, 20),
      square('NTH', 30, 60, 25),
      {
        id: 'ANT',
        name: 'ANT',
        geometry: {
          type: 'MultiPolygon',
          coordinates: [
            [
              [
                [170, -20],
                [180, -20],
                [180, -10],
                [170, -10],
                [170, -20],
              ],
            ],
            [
              [
                [-180, -20],
                [-170, -20],
                [-170, -10],
                [-180, -10],
                [-180, -20],
              ],
            ],
          ],
        } as MultiPolygon,
      },
    ];
    const g = buildGlobeGeometry(features);
    let worst = 0;
    for (let t = 0; t < g.triangles.length; t += 3) {
      const tri = [g.triangles[t], g.triangles[t + 1], g.triangles[t + 2]];
      if (!tri.every((i) => g.kind[i] === 1)) continue; // walls join a cap vertex to a bottom vertex
      for (let e = 0; e < 3; e++) worst = Math.max(worst, edgeDeg(g.positions, tri[e], tri[(e + 1) % 3]));
    }
    expect(worst).toBeGreaterThan(1);
    expect(worst).toBeLessThanOrEqual(MAX_EDGE + 1e-3);
  });

  it('gives the same world mesh as the refine() of the base commit', () => {
    // The base commit 4074dfb gives these counts and this hash for the same world.json.
    // Run `npm run data` and this test fails: then check the mesh again and update the numbers.
    const g = buildGlobeGeometry(worldFeatures(world).filter((f) => (f.geometry as Polygon | MultiPolygon).coordinates.length));
    expect(g.positions.length / 3).toBe(245_872);
    expect(g.triangles.length).toBe(1_172_460);
    const hash = createHash('sha256');
    hash.update(new Uint8Array(new Float32Array(g.positions).buffer));
    hash.update(new Uint8Array(new Uint32Array(g.triangles).buffer));
    expect(hash.digest('hex').slice(0, 16)).toBe('831b2e69d0bf224d');
  });
});
