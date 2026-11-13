// The label point and the size of the main polygon of each country. The globe and the flat map share it.
// Each country is computed on first use, then cached.

import { geoArea, geoCentroid } from 'd3-geo';
import type { Polygon, Position } from 'geojson';
import type { CountryFeature } from '../types';
import { capCentre, type BoundingCap } from './geometry';
import type { CountryPicker } from './picker';
import { fitRadius } from './view';

interface LabelData {
  lat: number;
  lng: number;
  radius: number; // angular radius (rad) of a disc with the area of the main polygon
  rings: number[][][] | null; // all rings [lng, lat] of the main polygon (Antarctica: a pole ring and the coastline)
}

export class CountryLabels {
  private readonly features: CountryFeature[];
  private readonly picker: CountryPicker;
  private readonly caps: BoundingCap[];
  private readonly labels: (LabelData | undefined)[] = [];

  constructor(features: CountryFeature[], picker: CountryPicker, caps: BoundingCap[]) {
    this.features = features;
    this.picker = picker;
    this.caps = caps;
  }

  /** Label point [lat, lng] and the angular radius (rad) of the main polygon. */
  labelOf(index: number): { latlng: [number, number]; radius: number } {
    const l = this.labelData(index);
    return { latlng: [l.lat, l.lng], radius: l.radius };
  }

  /** Angular radius (rad) of the cap around lat/lng that holds the country's main polygon. capRadius is the fallback. */
  mainRadius(index: number, latlng: [number, number], capRadius: number): number {
    const rings = this.labelData(index).rings;
    if (!rings || rings.length === 0 || rings[0].length === 0) return capRadius;
    return fitRadius(latlng, rings);
  }

  /** All rings [lng, lat] of the main polygon, or null. */
  mainRings(index: number): Position[][] | null {
    return this.labelData(index).rings;
  }

  private labelData(index: number): LabelData {
    let l = this.labels[index];
    if (!l) {
      l = this.computeLabel(index);
      this.labels[index] = l;
    }
    return l;
  }

  private computeLabel(index: number): LabelData {
    const f = this.features[index];
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best: Polygon | null = null;
    let bestArea = -1;
    for (const coordinates of polygons) {
      const poly: Polygon = { type: 'Polygon', coordinates };
      let a = geoArea(poly);
      if (a > 2 * Math.PI) a = 4 * Math.PI - a; // reversed winding
      if (a > bestArea) {
        bestArea = a;
        best = poly;
      }
    }
    const radius = Math.acos(Math.max(-1, 1 - Math.max(0, bestArea) / (2 * Math.PI)));
    const inside = (lng: number, lat: number) => this.picker.pick(lng, lat) === index;
    if (best) {
      const [lng, lat] = geoCentroid(best);
      if (Number.isFinite(lat) && inside(lng, lat)) return { lat, lng, radius, rings: best.coordinates };
      // A crescent or ring shape: walk from the centroid toward each vertex until inside.
      const ring = best.coordinates[0];
      const stride = Math.max(1, Math.floor(ring.length / 24));
      for (let i = 0; i < ring.length; i += stride) {
        for (const t of [0.5, 0.75, 0.9]) {
          const x = lng + (ring[i][0] - lng) * t;
          const y = lat + (ring[i][1] - lat) * t;
          if (inside(x, y)) return { lat: y, lng: x, radius, rings: best.coordinates };
        }
      }
    }
    return {
      ...capCentre(this.caps[index]),
      radius,
      rings: best ? best.coordinates : null,
    };
  }
}
