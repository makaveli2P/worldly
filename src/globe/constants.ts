// Values and small helpers that the globe and the flat map share. A change here changes both views.

import { Vector3 } from 'three';

export const EARTH_KM = 6371;
export const FOV = 30;
export const MIN_DIST = 1.3; // ~1900 km: closer than this even the 8192 texture turns to mush
export const LIFT = 0.033; // height of a raised country, in earth radii
export const RAISE = LIFT;
export const RAISE_MS = 200;
export const BLUR_MS = 200;
export const FOCUS_MS = 700;
export const TEXTURE_FADE_MS = 400;
export const FRAME_TAU = 110; // ms, smoothing for zoom and inset changes
export const TAP_HOLD_PX = 4; // after a double-click reset, the hover pick waits until the mouse moves this far
export const FOCUS_FILL = 0.25; // selected country radius as a share of the smaller side of the free rect
export const SMALL_CAP = (0.6 * Math.PI) / 180; // countries smaller than this get a pick tolerance
export const PICK_SLOP_PX = 6;
export const SLOP_MAX_RADIUS_PX = 10; // small countries larger than this on screen get no slop
export const MARKER_PX = 5; // below this projected radius the selected country gets a ring marker
/** A zoom within this share of the home zoom counts as the home zoom when a view hands its state on. */
export const HOME_SNAP = 0.1;
export const OUTLINE_PX = 0.45; // CSS px offset of the extra passes that make active outlines about 2px wide
export const NUDGES: [number, number][] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function rgb(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Frees the CPU copy of an ImageBitmap. An <img> needs nothing. */
export function closeImage(image: unknown): void {
  if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) image.close();
}
