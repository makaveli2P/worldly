// The view model of the flat map: a camera on the Mercator plane, the zoom limits, the framing in the
// free rect between the panels, and the copies of the world across the antimeridian. Pure functions.
//
// World units: x = lng in radians, y = Mercator y (see mercator.ts). The world is 2π wide and 2π high.
// The camera point (x, y) shows at the centre of the free rect. s is CSS px per world unit.

import { FOCUS_FILL, MIN_DIST } from '../globe/constants';
import { kmPerPxMap } from '../view/carry';
import type { Insets } from '../view/types';
import { latOfY, mercY, wrapRad } from './mercator';

const RAD = Math.PI / 180;
const TAU = 2 * Math.PI;

/** The home view shows the land from this lat in the north to this lat in the south. */
export const HOME_N = 78;
export const HOME_S = -58;
/** The most copies of the world that the map draws side by side. */
export const MAX_COPIES = 4;

export interface MapFrame {
  width: number; // canvas CSS px
  height: number;
  insets: Insets;
  focal: number; // (height / 2) / tan(FOV / 2): the globe's focal length in CSS px, for the zoom limits
}

export interface MapCamera {
  x: number; // world x at the centre of the free rect, in [-π, π)
  y: number; // world y at the centre of the free rect
  s: number; // CSS px per world unit
}

/** The part of the canvas that the panels do not cover: its size and its centre. The same rule as the globe. */
export function freeRect(f: MapFrame): { w: number; h: number; cx: number; cy: number } {
  const { left, right, top, bottom } = f.insets;
  const w = Math.max(1, f.width - left - right);
  const h = Math.max(1, f.height - top - bottom);
  return { w, h, cx: left + w / 2, cy: top + h / 2 };
}

/** The smallest scale: the world fills the free rect, with no empty band and no second copy in it. */
export function sMin(f: MapFrame): number {
  const { w, h } = freeRect(f);
  return Math.max(w, h) / TAU;
}

/** The largest scale: the ground scale of the globe at its closest distance, at the equator. */
export function sMax(f: MapFrame): number {
  return f.focal / (MIN_DIST - 1);
}

/** The scale of the home view: HOME_N to HOME_S fills the height of the free rect. */
export function sHome(f: MapFrame): number {
  return Math.max(sMin(f), freeRect(f).h / (mercY(HOME_N) - mercY(HOME_S)));
}

/** The world y at the centre of the home view (before clampY). */
export function homeY(): number {
  return (mercY(HOME_N) + mercY(HOME_S)) / 2;
}

/** Keeps the map edges (y = ±π) out of the free rect. When the world is lower than the free rect, y = 0. */
export function clampY(y: number, s: number, f: MapFrame): number {
  const h = freeRect(f).h / (2 * s);
  if (h >= Math.PI) return 0;
  return Math.max(-Math.PI + h, Math.min(Math.PI - h, y));
}

/** Canvas px of lat/lng, at the copy nearest the camera. liftPx moves the point up the screen. */
export function toScreen(lat: number, lng: number, cam: MapCamera, f: MapFrame, liftPx = 0): { x: number; y: number } {
  const { cx, cy } = freeRect(f);
  return {
    x: cx + wrapRad(lng * RAD - cam.x) * cam.s,
    y: cy - (mercY(lat) - cam.y) * cam.s - liftPx,
  };
}

/** lat/lng (lng wrapped to [-180, 180)) at canvas px, or null past a map edge. */
export function fromScreen(px: number, py: number, cam: MapCamera, f: MapFrame): { lat: number; lng: number } | null {
  const { cx, cy } = freeRect(f);
  const y = cam.y - (py - cy) / cam.s;
  if (Math.abs(y) > Math.PI) return null;
  return { lat: latOfY(y), lng: wrapRad(cam.x + (px - cx) / cam.s) / RAD };
}

/**
 * The camera after a drag of dx, dy world units (dx to the right, dy down). The map moves with the
 * pointer: a drag down brings the north into view. x wraps; y stays in the clampY range.
 */
export function panBy(cam: MapCamera, dx: number, dy: number, f: MapFrame): MapCamera {
  return { x: wrapRad(cam.x - dx), y: clampY(cam.y + dy, cam.s, f), s: cam.s };
}

/** A world point (wx, wy) that must stay under the canvas point (px, py). */
export interface ZoomAnchor {
  wx: number;
  wy: number;
  px: number;
  py: number;
}

/** The camera at scale s that keeps the anchor point under its canvas point. The caller clamps y. */
export function anchorCamera(a: ZoomAnchor, s: number, f: MapFrame): MapCamera {
  const { cx, cy } = freeRect(f);
  return { x: wrapRad(a.wx - (a.px - cx) / s), y: a.wy + (a.py - cy) / s, s };
}

/** The world bounds of the whole canvas. */
export function cameraBounds(cam: MapCamera, f: MapFrame): { left: number; right: number; top: number; bottom: number } {
  const { cx, cy } = freeRect(f);
  return {
    left: cam.x - cx / cam.s,
    right: cam.x + (f.width - cx) / cam.s,
    top: cam.y + cy / cam.s,
    bottom: cam.y - (f.height - cy) / cam.s,
  };
}

/**
 * The copies of the world that the canvas shows, as multiples k of 2π. A mesh that spans xMin..xMax
 * (world x, the unwrapped lon goes past ±π) shows at copy k when [xMin + 2πk, xMax + 2πk] meets [left, right].
 * With more than max copies, the copies nearest the centre of the bounds stay.
 */
export function copyOffsets(left: number, right: number, xMin: number, xMax: number, max = MAX_COPIES): number[] {
  const out: number[] = [];
  // "|| 0" turns -0 into 0.
  for (let k = Math.ceil((left - xMax) / TAU) || 0; k <= Math.floor((right - xMin) / TAU); k++) out.push(k);
  if (out.length <= max) return out;
  const mid = (left + right) / 2;
  const centre = (xMin + xMax) / 2;
  return out
    .sort((a, b) => Math.abs(centre + a * TAU - mid) - Math.abs(centre + b * TAU - mid))
    .slice(0, max)
    .sort((a, b) => a - b);
}

/** The half size of a country round its focus point, in world units: |dx| and |dy| at most. It does not depend on the insets. */
export interface FocusExtent {
  hx: number;
  hy: number;
}

/**
 * The half size of the rings ([lng, lat] points) round the focus point. The rings unwrap round the focus lng,
 * so a country across the antimeridian (Russia, Fiji) stays whole.
 */
export function focusExtent(rings: readonly (readonly (readonly number[])[])[], focus: [number, number]): FocusExtent {
  const fx = focus[1] * RAD;
  const fy = mercY(focus[0]);
  let hx = 0;
  let hy = 0;
  for (const ring of rings)
    for (const p of ring) {
      hx = Math.max(hx, Math.abs(wrapRad(p[0] * RAD - fx)));
      hy = Math.max(hy, Math.abs(mercY(p[1]) - fy));
    }
  return { hx, hy };
}

/**
 * The scale at which an extent fills FOCUS_FILL of the free rect. Call it for each frame: the free rect
 * changes when the panels open, as distanceToFit does on the globe.
 */
export function fitScale(e: FocusExtent, f: MapFrame): number {
  const { w, h } = freeRect(f);
  return Math.min((FOCUS_FILL * w) / Math.max(1e-9, e.hx), (FOCUS_FILL * h) / Math.max(1e-9, e.hy));
}

/** The scale at which the rings fill FOCUS_FILL of the free rect round the focus point (focusExtent, then fitScale). */
export function focusScale(rings: readonly (readonly (readonly number[])[])[], focus: [number, number], f: MapFrame): number {
  return fitScale(focusExtent(rings, focus), f);
}

/**
 * The scale that the framing eases to. A fit (focusScale of the selected country) never zooms out past the
 * home view, as on the globe. Else the user zoom: sHome times zoomRatio (more than 1 = closer, the inverse of
 * the globe's zoomRatio).
 */
export function targetScale(f: MapFrame, o: { zoomRatio: number; fit: number | null }): number {
  const home = sHome(f);
  const want = o.fit !== null ? Math.max(o.fit, home) : home * o.zoomRatio;
  return Math.min(sMax(f), Math.max(sMin(f), want));
}

/** The camera centre at t (0..1) of a flight. x goes the short way round. */
export function lerpCenter(from: { x: number; y: number }, to: { x: number; y: number }, t: number): { x: number; y: number } {
  return { x: wrapRad(from.x + wrapRad(to.x - from.x) * t), y: from.y + (to.y - from.y) * t };
}

/** Ground km per CSS px at lat (degrees) for scale s. src/view/carry.ts holds it, with its inverse. */
export { kmPerPxMap };

/** The map scale 1:d for a ground scale, with 1 CSS px = 1/96 in = 0.26458333 mm. */
export function scaleDenominator(kmPerPx: number): number {
  return (kmPerPx * 1e6) / 0.26458333;
}
