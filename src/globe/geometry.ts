// Builds one merged mesh for all countries from GeoJSON polygons.
//
// Each vertex stores a unit direction (attribute "position"), the country index and a kind:
// 1 = cap or wall top (rises with the country), 0 = wall bottom (stays on the surface).
// The vertex shader turns these into real positions, so a raise costs no CPU work.
//
// Rings are triangulated in plane lon/lat space with earcut. Then every edge longer than
// MAX_EDGE degrees on the sphere is split, so the triangles follow the curve of the sphere.

import earcut from 'earcut';
import type { Position } from 'geojson';
import type { CountryFeature } from '../types';

const MAX_EDGE = 2; // degrees
const POLE_LAT = 89.9;
const RAD = Math.PI / 180;

/** Edge length in degrees on the sphere, approximated from plane lon/lat. Depends on the edge only. */
function edgeLength(x0: number, y0: number, x1: number, y1: number): number {
  const c = Math.cos(Math.min(Math.abs(y0), Math.abs(y1)) * RAD);
  return Math.hypot((x1 - x0) * c, y1 - y0);
}

export interface Range {
  start: number;
  count: number;
}

export interface BoundingCap {
  x: number;
  y: number;
  z: number;
  cosRadius: number;
}

export interface GlobeGeometryData {
  positions: Float32Array; // unit directions, xyz
  countryIndex: Uint16Array;
  kind: Uint8Array;
  triangles: Uint32Array;
  lines: Uint32Array;
  triangleRanges: Range[]; // per country, in index units
  lineRanges: Range[];
  caps: BoundingCap[]; // per country, for the pick prefilter
}

/** Ring in plane lon/lat. real[i] = false when the edge i -> i+1 is not a true border. */
interface PlaneRing {
  lon: number[];
  lat: number[];
  real: boolean[];
}

type TypedCtor = Float32ArrayConstructor | Uint32ArrayConstructor | Uint16ArrayConstructor | Uint8ArrayConstructor;

class Growable {
  private data: Float32Array | Uint32Array | Uint16Array | Uint8Array;
  private readonly ctor: TypedCtor;
  length = 0;
  constructor(ctor: TypedCtor, initial: number) {
    this.ctor = ctor;
    this.data = new ctor(initial);
  }
  push(v: number): void {
    if (this.length === this.data.length) {
      const next = new this.ctor(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = v;
  }
  result<T>(): T {
    return this.data.slice(0, this.length) as unknown as T;
  }
}

export function lonLatToVec(lon: number, lat: number, out: number[] = [0, 0, 0]): number[] {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const c = Math.cos(p);
  out[0] = c * Math.sin(l);
  out[1] = Math.sin(p);
  out[2] = c * Math.cos(l);
  return out;
}

/** Unwraps longitudes, closes rings that go round a pole, and drops tiny pole circles. */
function toPlaneRing(ring: Position[]): PlaneRing | null {
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length;
  if (n < 3) return null;
  let allPole = true;
  for (let i = 0; i < n; i++) if (Math.abs(ring[i][1]) < POLE_LAT) allPole = false;
  if (allPole) return null;

  const lon: number[] = [];
  const lat: number[] = [];
  let prev = ring[0][0];
  let offset = 0;
  for (let i = 0; i < n; i++) {
    let x = ring[i][0];
    const d = x + offset - prev;
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    x += offset;
    if (lon.length && x === lon[lon.length - 1] && ring[i][1] === lat[lat.length - 1]) continue;
    lon.push(x);
    lat.push(ring[i][1]);
    prev = x;
  }
  const real = lon.map(() => true);

  // A ring that does not come back to its start offset after unwrapping goes round a pole.
  const d = ring[0][0] + offset - prev;
  if (d > 180) offset -= 360;
  else if (d < -180) offset += 360;
  if (offset !== 0) {
    let sum = 0;
    for (const v of lat) sum += v;
    const pole = sum < 0 ? -90 : 90;
    // Close at the start point, one turn later, so both pole edges lie on the same meridian.
    const closeLon = ring[0][0] + offset;
    lon.push(closeLon, closeLon, lon[0]);
    lat.push(ring[0][1], pole, pole);
    real.push(false, false, false);
  }
  if (lon.length < 3) return null;
  return densify({ lon, lat, real });
}

function densify(r: PlaneRing): PlaneRing {
  const out: PlaneRing = { lon: [], lat: [], real: [] };
  const n = r.lon.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x0 = r.lon[i];
    const y0 = r.lat[i];
    const dx = r.lon[j] - x0;
    const dy = r.lat[j] - y0;
    const steps = Math.max(1, Math.ceil(edgeLength(x0, y0, r.lon[j], r.lat[j]) / MAX_EDGE));
    // An edge on the antimeridian or along a pole is a cut, not a border.
    const onCut =
      (Math.abs(dx) < 1e-9 && Math.abs(Math.abs(((x0 + 540) % 360) - 180) - 180) < 0.01) ||
      (Math.abs(y0) > POLE_LAT && Math.abs(r.lat[j]) > POLE_LAT);
    const real = r.real[i] && !onCut;
    for (let s = 0; s < steps; s++) {
      out.lon.push(x0 + (dx * s) / steps);
      out.lat.push(y0 + (dy * s) / steps);
      out.real.push(real);
    }
  }
  return out;
}

/** Splits every edge longer than MAX_EDGE. Splits depend on the edge only, so the result has no T-junctions. */
function refine(lon: number[], lat: number[], tris: number[]): number[] {
  const long = (a: number, b: number) => edgeLength(lon[a], lat[a], lon[b], lat[b]) > MAX_EDGE;
  for (let iter = 0; iter < 16; iter++) {
    const mids = new Map<number, number>();
    const mid = (a: number, b: number) => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let m = mids.get(key);
      if (m === undefined) {
        m = lon.length;
        lon.push((lon[a] + lon[b]) / 2);
        lat.push((lat[a] + lat[b]) / 2);
        mids.set(key, m);
      }
      return m;
    };
    const next: number[] = [];
    let split = false;
    for (let t = 0; t < tris.length; t += 3) {
      let a = tris[t];
      let b = tris[t + 1];
      let c = tris[t + 2];
      let ab = long(a, b);
      let bc = long(b, c);
      let ca = long(c, a);
      const k = +ab + +bc + +ca;
      if (k === 0) {
        next.push(a, b, c);
        continue;
      }
      split = true;
      if (k === 3) {
        const m0 = mid(a, b);
        const m1 = mid(b, c);
        const m2 = mid(c, a);
        next.push(a, m0, m2, m0, b, m1, m2, m1, c, m0, m1, m2);
        continue;
      }
      // Rotate (keeps winding) so that ab is split, and for k = 2 also bc.
      for (let r = 0; r < 3; r++) {
        if (ab && (k === 1 || bc)) break;
        [a, b, c] = [b, c, a];
        [ab, bc, ca] = [bc, ca, ab];
      }
      const m0 = mid(a, b);
      if (k === 1) {
        next.push(a, m0, c, m0, b, c);
      } else {
        const m1 = mid(b, c);
        next.push(m0, b, m1, a, m0, m1, a, m1, c);
      }
    }
    tris = next;
    if (!split) break;
  }
  return tris;
}

function polygonsOf(f: CountryFeature): Position[][][] {
  return f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
}

export function buildGlobeGeometry(features: CountryFeature[]): GlobeGeometryData {
  const pos = new Growable(Float32Array, 1 << 20);
  const cidx = new Growable(Uint16Array, 1 << 18);
  const kind = new Growable(Uint8Array, 1 << 18);
  const tri = new Growable(Uint32Array, 1 << 20);
  const line = new Growable(Uint32Array, 1 << 19);
  const triangleRanges: Range[] = [];
  const lineRanges: Range[] = [];
  const caps: BoundingCap[] = [];
  const v = [0, 0, 0];

  const addVertex = (lon: number, lat: number, ci: number, k: number) => {
    lonLatToVec(lon, lat, v);
    pos.push(v[0]);
    pos.push(v[1]);
    pos.push(v[2]);
    cidx.push(ci);
    kind.push(k);
  };

  features.forEach((feature, ci) => {
    const triStart = tri.length;
    const lineStart = line.length;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const dirs: number[] = [];

    for (const polygon of polygonsOf(feature)) {
      const rings = polygon.map(toPlaneRing).filter((r): r is PlaneRing => r !== null);
      if (!rings.length) continue;
      // Move holes next to the outer ring in unwrapped longitude.
      const outer = rings[0];
      let oMin = Infinity;
      let oMax = -Infinity;
      for (const x of outer.lon) {
        if (x < oMin) oMin = x;
        if (x > oMax) oMax = x;
      }
      const oMid = (oMin + oMax) / 2;
      for (let h = 1; h < rings.length; h++) {
        const shift = 360 * Math.round((oMid - rings[h].lon[0]) / 360);
        if (shift) rings[h].lon = rings[h].lon.map((x) => x + shift);
      }

      const lon: number[] = [];
      const lat: number[] = [];
      const holes: number[] = [];
      const ringStarts: number[] = [];
      for (let r = 0; r < rings.length; r++) {
        if (r > 0) holes.push(lon.length);
        ringStarts.push(lon.length);
        lon.push(...rings[r].lon);
        lat.push(...rings[r].lat);
      }
      const ringPoints = lon.length;
      const flat = new Float64Array(ringPoints * 2);
      for (let i = 0; i < ringPoints; i++) {
        flat[i * 2] = lon[i];
        flat[i * 2 + 1] = lat[i];
      }
      const tris = refine(lon, lat, earcut(flat, holes.length ? holes : undefined, 2));

      // Cap vertices (kind 1): ring points first, then refine midpoints.
      const base = pos.length / 3;
      for (let i = 0; i < lon.length; i++) {
        addVertex(lon[i], lat[i], ci, 1);
        sx += v[0];
        sy += v[1];
        sz += v[2];
        if (i < ringPoints) dirs.push(v[0], v[1], v[2]);
      }
      for (const t of tris) tri.push(base + t);

      // Walls: one bottom vertex (kind 0) per ring point; quads on real edges.
      const bottom = pos.length / 3;
      for (let i = 0; i < ringPoints; i++) addVertex(lon[i], lat[i], ci, 0);
      rings.forEach((ring, r) => {
        const s = ringStarts[r];
        const n = ring.lon.length;
        for (let i = 0; i < n; i++) {
          if (!ring.real[i]) continue;
          const ti = base + s + i;
          const tj = base + s + ((i + 1) % n);
          const bi = bottom + s + i;
          const bj = bottom + s + ((i + 1) % n);
          // The last vertex of each triangle is a bottom vertex: the flat "kind" varying reads 0 on walls.
          tri.push(ti);
          tri.push(tj);
          tri.push(bi);
          tri.push(tj);
          tri.push(bj);
          tri.push(bi);
          line.push(ti);
          line.push(tj);
        }
      });
    }

    triangleRanges.push({ start: triStart, count: tri.length - triStart });
    lineRanges.push({ start: lineStart, count: line.length - lineStart });

    const len = Math.hypot(sx, sy, sz) || 1;
    const cx = sx / len;
    const cy = sy / len;
    const cz = sz / len;
    let cosRadius = 1;
    for (let i = 0; i < dirs.length; i += 3) {
      const d = dirs[i] * cx + dirs[i + 1] * cy + dirs[i + 2] * cz;
      if (d < cosRadius) cosRadius = d;
    }
    caps.push({ x: cx, y: cy, z: cz, cosRadius: dirs.length ? cosRadius - 0.001 : 2 });
  });

  return {
    positions: pos.result<Float32Array>(),
    countryIndex: cidx.result<Uint16Array>(),
    kind: kind.result<Uint8Array>(),
    triangles: tri.result<Uint32Array>(),
    lines: line.result<Uint32Array>(),
    triangleRanges,
    lineRanges,
    caps,
  };
}
