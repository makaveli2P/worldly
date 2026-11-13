// The flat map positions of the world mesh. The globe geometry (src/globe/geometry.ts) holds unit
// directions only. This module gets the plane lon/lat back from them, so the globe boot does no work
// for the map. Computed one time per geometry, when the first flat map starts.

import type { GlobeGeometryData } from '../globe/geometry';
import { mercY } from './mercator';

const DEG = 180 / Math.PI;

const mercatorCache = new WeakMap<GlobeGeometryData, Float32Array>();

/**
 * The plane lon and lat in degrees, 2 per vertex. The lon is unwrapped as in the mesh: a polygon across the
 * antimeridian (Russia, Fiji) goes past ±180, so no triangle jumps across the map. The pole closure vertices
 * of Antarctica have lat -90.
 * Not cached: only mercatorPositions keeps a result.
 */
export function planeLonLat(g: GlobeGeometryData): Float32Array {
  const p = g.positions;
  const out = new Float32Array((p.length / 3) * 2);
  for (let v = 0, n = p.length / 3; v < n; v++) {
    const x = p[v * 3];
    const y = p[v * 3 + 1];
    const z = p[v * 3 + 2];
    out[v * 2] = Math.atan2(x, z) * DEG;
    // atan2 and not asin: asin loses precision near the poles.
    out[v * 2 + 1] = Math.atan2(y, Math.hypot(x, z)) * DEG;
  }
  // atan2 gives [-180, 180]. The polygons at the antimeridian keep their own unwrapped lon.
  for (const s of g.seams) for (let i = 0; i < s.lon.length; i++) out[(s.start + i) * 2] = s.lon[i];
  return out;
}

/** The vertices in Mercator world units, xy per vertex: x = lon in radians, y = Mercator y. Lat ±90 goes to y = ±π. */
export function mercatorPositions(g: GlobeGeometryData): Float32Array {
  const hit = mercatorCache.get(g);
  if (hit) return hit;
  const ll = planeLonLat(g);
  const out = new Float32Array(ll.length);
  for (let i = 0; i < ll.length; i += 2) {
    out[i] = ll[i] / DEG;
    out[i + 1] = mercY(ll[i + 1]);
  }
  mercatorCache.set(g, out);
  return out;
}
