// Label sites: one point per country, computed once from the shapes.
// The site is the pole of inaccessibility of the largest polygon (the inner point farthest from the edge).

import { geoArea, geoCentroid } from 'd3-geo';
import type { Polygon, Position } from 'geojson';
import type { CountryFeature, CountryId } from '../types';

const EARTH_KM = 6371;

export interface LabelSite {
  id: CountryId;
  lat: number;
  lng: number;
  /** Area of the whole shape, km². */
  areaKm2: number;
  /** More interior points of a large main polygon, [lat, lng], for when the site is off-screen. */
  extra: [number, number][];
}

/** Main polygons larger than this get extra sites. */
const EXTRA_MIN_KM2 = 1e6;
/** Grid step of the extra sites, degrees of latitude (about 550 km). */
const EXTRA_STEP = 5;

/** Spherical area of a polygon in steradians, safe against the wrong winding. */
function sphericalArea(p: Polygon): number {
  const a = geoArea(p);
  return a > 2 * Math.PI ? 4 * Math.PI - a : a;
}

type Ring = number[][]; // planar [x, y]

/** Signed distance from (x, y) to the polygon edge: positive inside. */
function pointToPolygon(x: number, y: number, rings: Ring[]): number {
  let inside = false;
  let minSq = Infinity;
  for (const ring of rings) {
    for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
      minSq = Math.min(minSq, segDistSq(x, y, a, b));
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minSq);
}

function segDistSq(px: number, py: number, a: number[], b: number[]): number {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}

interface Cell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}

function cell(x: number, y: number, h: number, rings: Ring[]): Cell {
  const d = pointToPolygon(x, y, rings);
  return { x, y, h, d, max: d + h * Math.SQRT2 };
}

/** Polylabel (Mapbox algorithm) with a small binary heap. */
function polylabel(rings: Ring[], precision: number): [number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of rings[0]) {
    minX = Math.min(minX, p[0]);
    minY = Math.min(minY, p[1]);
    maxX = Math.max(maxX, p[0]);
    maxY = Math.max(maxY, p[1]);
  }
  const w = maxX - minX;
  const hgt = maxY - minY;
  const size = Math.min(w, hgt);
  if (size === 0) return [minX, minY];
  const heap: Cell[] = [];
  const push = (c: Cell) => {
    heap.push(c);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].max >= heap[i].max) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): Cell => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].max > heap[m].max) m = l;
        if (r < heap.length && heap[r].max > heap[m].max) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const h0 = size / 2;
  for (let x = minX; x < maxX; x += size) for (let y = minY; y < maxY; y += size) push(cell(x + h0, y + h0, h0, rings));
  let best = cell(minX + w / 2, minY + hgt / 2, 0, rings);
  let guard = 0;
  while (heap.length && guard++ < 4000) {
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const h = c.h / 2;
    push(cell(c.x - h, c.y - h, h, rings));
    push(cell(c.x + h, c.y - h, h, rings));
    push(cell(c.x - h, c.y + h, h, rings));
    push(cell(c.x + h, c.y + h, h, rings));
  }
  return [best.x, best.y];
}

/** Unwraps longitudes so a ring that crosses the antimeridian stays continuous. Null when the ring goes round a pole. */
function unwrap(ring: Position[]): number[][] | null {
  const out: number[][] = [];
  let prev = ring[0][0];
  let shift = 0;
  for (const [lon, lat] of ring) {
    const d = lon + shift - prev;
    if (d > 180) shift -= 360;
    else if (d < -180) shift += 360;
    const x = lon + shift;
    out.push([x, lat]);
    prev = x;
  }
  if (Math.abs(out[out.length - 1][0] - out[0][0]) > 180) return null;
  return out;
}

function siteOfPolygon(p: Polygon): [number, number] {
  const outer = unwrap(p.coordinates[0]);
  if (!outer) {
    const [lng, lat] = geoCentroid(p);
    return [lat, lng];
  }
  let lat0 = 0;
  for (const q of outer) lat0 += q[1];
  lat0 /= outer.length;
  const k = Math.max(0.15, Math.cos((lat0 * Math.PI) / 180));
  const base = outer[0][0];
  const rings: Ring[] = [outer.map(([x, y]) => [x * k, y])];
  for (let i = 1; i < p.coordinates.length; i++) {
    const hole = unwrap(p.coordinates[i]);
    if (!hole) continue;
    // Keep each hole on the same turn of the globe as the outer ring.
    const off = Math.round((base - hole[0][0]) / 360) * 360;
    rings.push(hole.map(([x, y]) => [(x + off) * k, y]));
  }
  let minY = Infinity;
  let maxY = -Infinity;
  for (const q of outer) {
    minY = Math.min(minY, q[1]);
    maxY = Math.max(maxY, q[1]);
  }
  const [x, y] = polylabel(rings, Math.max(0.02, (maxY - minY) / 60));
  let lng = x / k;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  return [y, lng];
}

/** Points on a regular grid inside the polygon, at least a third of a step from its edge. */
function interiorGrid(p: Polygon, step: number): [number, number][] {
  const outer = unwrap(p.coordinates[0]);
  if (!outer) return [];
  let lat0 = 0;
  for (const q of outer) lat0 += q[1];
  lat0 /= outer.length;
  const k = Math.max(0.15, Math.cos((lat0 * Math.PI) / 180));
  const rings: Ring[] = [outer.map(([x, y]) => [x * k, y])];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of rings[0]) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const out: [number, number][] = [];
  for (let y = minY + step / 2; y < maxY; y += step) {
    for (let x = minX + step / 2; x < maxX; x += step) {
      if (pointToPolygon(x, y, rings) < step / 3) continue;
      const lng = ((((x / k + 180) % 360) + 360) % 360) - 180;
      out.push([y, lng]);
    }
  }
  return out;
}

/** Computes one label site per feature. About 20-60 ms for the world, run once. */
export function computeLabelSites(features: CountryFeature[]): Map<CountryId, LabelSite> {
  const out = new Map<CountryId, LabelSite>();
  for (const f of features) {
    const polys: Polygon[] =
      f.geometry.type === 'Polygon'
        ? [f.geometry]
        : f.geometry.coordinates.map((coordinates) => ({ type: 'Polygon', coordinates }) as Polygon);
    let best: Polygon | null = null;
    let bestA = -1;
    let total = 0;
    for (const p of polys) {
      if (!p.coordinates[0] || p.coordinates[0].length < 4) continue;
      const a = sphericalArea(p);
      total += a;
      if (a > bestA) {
        bestA = a;
        best = p;
      }
    }
    if (!best) continue;
    const [lat, lng] = siteOfPolygon(best);
    const extra = bestA * EARTH_KM * EARTH_KM > EXTRA_MIN_KM2 ? interiorGrid(best, EXTRA_STEP) : [];
    out.set(f.id, { id: f.id, lat, lng, areaKm2: total * EARTH_KM * EARTH_KM, extra });
  }
  return out;
}
