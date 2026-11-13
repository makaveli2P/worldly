// Web Mercator in world units: x = lng in radians, y = ln(tan(π/4 + φ/2)). The map is cut at
// MAX_LAT, where y = ±π, so the world is a square of 2π × 2π. Pure functions, no three.js.

const RAD = Math.PI / 180;

/** The latitude (degrees) where Mercator y = π: atan(sinh π). */
export const MAX_LAT = 85.0511287798;

/**
 * Mercator y of a latitude in degrees: ln(tan(π/4 + φ/2)). The latitude is clamped to ±MAX_LAT, so |y| ≤ π.
 * The code uses the equal form asinh(tan φ), which gives exactly 0 at the equator.
 */
export function mercY(latDeg: number): number {
  const phi = Math.max(-MAX_LAT, Math.min(MAX_LAT, latDeg)) * RAD;
  return Math.asinh(Math.tan(phi));
}

/** The latitude in degrees of a Mercator y. */
export function latOfY(y: number): number {
  return Math.atan(Math.sinh(y)) / RAD;
}

/** Wraps an angle in radians into [-π, π). */
export function wrapRad(x: number): number {
  const t = 2 * Math.PI;
  return ((((x + Math.PI) % t) + t) % t) - Math.PI;
}
