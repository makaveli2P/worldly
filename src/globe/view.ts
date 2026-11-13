// The view model: the lat/lng at the centre of the view. North is always up, so the globe has no roll.
// Globe keeps the view as lat/lng and turns it into a globe orientation each frame.

import { Euler, Quaternion } from 'three';

/** Max |lat| that a drag can bring to the view centre when the globe is far away. Closer in, the limit goes up. */
export const MAX_DRAG_LAT = 80;
/** At the drag limit, the pole is this fraction of the arc from the view centre to the screen edge. */
const POLE_MARGIN = 0.5;

export interface ViewCentre {
  lat: number;
  lng: number;
}

/** Options of a drag. */
export interface DragOptions {
  /** Max |lat| that the drag can bring to the view centre (see dragLatLimit). Must be less than 90. */
  maxLat?: number;
  /** Lat of the surface point that the pointer holds. The lng change keeps this point under the pointer. */
  grabLat?: number;
}

const DEG = 180 / Math.PI;

/** Clamps lat to [-90, 90]. */
export function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

/** Wraps lng into [-180, 180). */
export function wrapLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** The shortest signed lng change from `from` to `to`, in [-180, 180). */
export function lngDelta(from: number, to: number): number {
  return wrapLng(to - from);
}

/** The view at t (0..1) of a turn from `from` to `to`. The lng goes the short way round. */
export function lerpView(from: ViewCentre, to: ViewCentre, t: number): ViewCentre {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: wrapLng(from.lng + lngDelta(from.lng, to.lng) * t),
  };
}

/**
 * Arc (degrees) on the globe from the view centre to the surface point on a camera ray.
 * The camera is `distance` globe radii from the globe centre and looks at it. `tanAngle` is the tan of the
 * angle between the ray and the camera axis. A ray that misses the globe gives the arc to the horizon.
 */
export function visibleArc(distance: number, tanAngle: number): number {
  const a = Math.atan(tanAngle);
  const s = distance * Math.sin(a);
  if (s >= 1) return Math.acos(1 / distance) * DEG;
  return (Math.asin(s) - a) * DEG;
}

/**
 * Max |lat| that a drag can bring to the view centre, for the arc (degrees) from the view centre to the
 * screen edge. The pole stays on screen at POLE_MARGIN of that arc. Far away, the limit is MAX_DRAG_LAT.
 */
export function dragLatLimit(arcToEdge: number): number {
  return 90 - Math.min(90 - MAX_DRAG_LAT, POLE_MARGIN * arcToEdge);
}

/**
 * The view after a drag of dx, dy radians of arc at the view centre (dx to the right, dy down).
 * The surface moves with the pointer: a drag down brings the north into view, a drag right brings the west.
 * A horizontal arc at the grabbed lat covers 1/cos(lat) as much lng.
 */
export function dragView(view: ViewCentre, dx: number, dy: number, opts: DragOptions = {}): ViewCentre {
  const maxLat = opts.maxLat ?? MAX_DRAG_LAT;
  // A view past the limit (a focus on a pole) does not jump back. The drag only stops it at a lat nearer the pole.
  const limit = Math.max(maxLat, Math.abs(view.lat));
  // The cos(maxLat) floor acts only on a grab near a pole, or on a view past the limit. Then the globe does not
  // turn faster than for a grab at the view centre at the limit.
  const scale = Math.max(Math.cos((opts.grabLat ?? view.lat) / DEG), Math.cos(maxLat / DEG));
  return {
    lat: Math.max(-limit, Math.min(limit, view.lat + dy * DEG)),
    lng: wrapLng(view.lng - (dx * DEG) / scale),
  };
}

const euler = new Euler(0, 0, 0, 'XYZ');

/**
 * Globe orientation that puts lat/lng in front of the camera (+z) with north up.
 * First a turn about the polar axis brings lng to the front, then a tilt about the screen x axis brings lat.
 */
export function orientationFor(lat: number, lng: number, out = new Quaternion()): Quaternion {
  // Euler 'XYZ' gives the matrix Rx · Ry · Rz: Ry acts first.
  return out.setFromEuler(euler.set(lat / DEG, -lng / DEG, 0, 'XYZ'));
}
