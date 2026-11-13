import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLabelsFile, worldFeatures, type WorldTopology } from '../../src/data/precompute';
import { buildGlobeGeometry } from '../../src/globe/geometry';
import { CountryLabels } from '../../src/globe/labels';
import { CountryPicker } from '../../src/globe/picker';
import { fitRadius } from '../../src/globe/view';

const world = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/data/world.json'), 'utf8')) as WorldTopology;
const features = worldFeatures(world);
const caps = buildGlobeGeometry(features).caps;
const labels = new CountryLabels(features, new CountryPicker(features, caps, new Set(buildLabelsFile(world).inverted)), caps);
const index = (id: string) => features.findIndex((f) => f.id === id);

// The values that Globe.ts computed before the code moved to labels.ts (the same world.json).
const before: Record<string, [number, number, number]> = {
  FRA: [46.5723053578, 2.4609096203, 0.064902699402],
  RUS: [65.891213526, 95.5330182904, 0.362234362334],
  FJI: [-17.8230277753, 177.9730014897, 0.009241757437],
  ATA: [-84.6792740299, 83.041583098, 0.308813575978],
  CHL: [-34.3607274225, -70.9496822141, 0.071977657832],
};

describe('CountryLabels', () => {
  it('gives the same label point and radius as before the move', () => {
    for (const [id, [lat, lng, radius]] of Object.entries(before)) {
      const l = labels.labelOf(index(id));
      expect(l.latlng[0], id).toBeCloseTo(lat, 8);
      expect(l.latlng[1], id).toBeCloseTo(lng, 8);
      expect(l.radius, id).toBeCloseTo(radius, 10);
    }
  });

  it('caches each country', () => {
    const i = index('FRA');
    expect(labels.mainRings(i)).toBe(labels.mainRings(i));
  });

  it('fits every ring of the main polygon, and falls back to the cap radius with no rings', () => {
    const i = index('ATA');
    const at = labels.labelOf(i).latlng;
    const rings = labels.mainRings(i)!;
    expect(rings.length).toBe(2); // a ring round the pole and the coastline
    expect(labels.mainRadius(i, at, 99)).toBeCloseTo(fitRadius(at, rings), 12);
    const empty = new CountryLabels(
      [{ id: 'X', name: 'X', geometry: { type: 'MultiPolygon', coordinates: [] } }],
      { pick: () => -1 } as unknown as CountryPicker,
      [{ x: 0, y: 0, z: 1, cosRadius: 2 }],
    );
    expect(empty.mainRings(0)).toBeNull();
    expect(empty.mainRadius(0, [0, 0], 0.25)).toBe(0.25);
  });
});
