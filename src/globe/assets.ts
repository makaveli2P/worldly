// The world data that each view needs, built one time per feature list. A second view (the globe after
// the map, or the map after the globe) gets the same object and does not triangulate the world again.

import type { CountryFeature, CountryId } from '../types';
import { SMALL_CAP } from './constants';
import { buildGlobeGeometry, type BoundingCap, type GlobeGeometryData } from './geometry';
import { CountryLabels } from './labels';
import { CountryPicker } from './picker';

export interface WorldAssets {
  geometry: GlobeGeometryData;
  idToIndex: Map<CountryId, number>;
  picker: CountryPicker;
  caps: BoundingCap[];
  capRadius: number[]; // true angular radius per country, rad
  smallCountries: number[]; // indices of countries with a cap smaller than SMALL_CAP
  labels: CountryLabels;
}

const cache = new WeakMap<CountryFeature[], WorldAssets>();

/**
 * The assets of a feature list. The result is memoized with the array as the key, so pass the same array.
 * inverted: ids with a reversed winding, from the build. The first call decides it for the array.
 */
export function worldAssets(features: CountryFeature[], inverted?: ReadonlySet<CountryId>): WorldAssets {
  const hit = cache.get(features);
  if (hit) return hit;
  const geometry = buildGlobeGeometry(features);
  const idToIndex = new Map<CountryId, number>();
  features.forEach((f, i) => idToIndex.set(f.id, i));
  const caps = geometry.caps;
  const picker = new CountryPicker(features, caps, inverted);
  // geometry.ts pads each cap by 0.001 in cosine; remove the pad for the true size.
  const capRadius = caps.map((c) => (c.cosRadius > 1 ? 0 : Math.acos(Math.min(1, c.cosRadius + 0.001))));
  const smallCountries = capRadius.flatMap((r, i) => (r < SMALL_CAP ? [i] : []));
  const assets: WorldAssets = {
    geometry,
    idToIndex,
    picker,
    caps,
    capRadius,
    smallCountries,
    labels: new CountryLabels(features, picker, caps),
  };
  cache.set(features, assets);
  return assets;
}
