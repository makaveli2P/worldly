// The ground scale that carries the zoom from one view to the other. Pure math, no three.js.
// Both views state their zoom as km of ground per CSS px at the view centre (ViewState.kmPerPx).

import { EARTH_KM, FOV, HOME_SNAP, MIN_DIST } from '../globe/constants';

export { HOME_SNAP };

const RAD = Math.PI / 180;
const TAN_HALF_FOV = Math.tan((FOV * RAD) / 2);

/** Globe: km of ground per CSS px under the camera, at camera distance d (earth radii) and canvas height h (CSS px). */
export function kmPerPxGlobe(distance: number, heightCss: number): number {
  return (EARTH_KM * (distance - 1) * TAN_HALF_FOV) / (heightCss / 2);
}

/** Globe: the camera distance (earth radii) that gives k km per CSS px. The inverse of kmPerPxGlobe. */
export function distanceForKmPerPx(k: number, heightCss: number): number {
  return 1 + (k * (heightCss / 2)) / (EARTH_KM * TAN_HALF_FOV);
}

/** Map: km of ground per CSS px at lat, for the scale s (CSS px per world unit). */
export function kmPerPxMap(s: number, latDeg: number): number {
  return (EARTH_KM * Math.cos(latDeg * RAD)) / s;
}

/** Map: the scale s that gives k km per CSS px at lat. The inverse of kmPerPxMap. */
export function scaleForKmPerPx(k: number, latDeg: number): number {
  return (EARTH_KM * Math.cos(latDeg * RAD)) / k;
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/**
 * The zoom that a view hands on: null near the home zoom, else k. ratio is the current zoom over the home
 * zoom of the view; null means that the zoom fits a country (it is never "home").
 */
export function handOnKmPerPx(ratio: number | null, k: number): number | null {
  return ratio !== null && Math.abs(ratio - 1) < HOME_SNAP ? null : k;
}

/**
 * Globe: the zoomRatio (distance over the fit distance) for a received zoom. Null gives the home zoom (1).
 * The result stays between the closest distance (MIN_DIST) and the farthest distance (maxDistance).
 */
export function globeZoomRatio(k: number | null, heightCss: number, fit: number, maxDistance: number): number {
  if (k === null) return 1;
  return clamp(distanceForKmPerPx(k, heightCss) / fit, MIN_DIST / fit, maxDistance / fit);
}

/** Map: the scale s for a received zoom at lat. Null gives the home scale. The result stays in [min, max]. */
export function mapScale(k: number | null, latDeg: number, limits: { home: number; min: number; max: number }): number {
  return clamp(k === null ? limits.home : scaleForKmPerPx(k, latDeg), limits.min, limits.max);
}
