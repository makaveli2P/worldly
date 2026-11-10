// Which satellite texture tier to load, and when. Pure functions, so the tests can drive them.
//
// Tier 0 (2048) loads first, on every device. Tier 1 (4096) loads when the view needs more texels
// than tier 0 gives. Tier 2 (8192) loads only on a capable desktop, after the first zoom or selection,
// while the globe is at rest.

import type { TextureFile } from './textureManifest';

export interface TierEnv {
  maxTextureSize: number;
  finePointer: boolean; // matchMedia('(pointer: fine)')
  saveData: boolean; // navigator.connection.saveData
  deviceMemory: number | undefined; // GB; Safari and Firefox do not give it
}

/** The tiers this device may use, smallest first. Tier 0 is always there. */
export function chooseTextureTiers(files: { s: TextureFile; m: TextureFile; l: TextureFile }, env: TierEnv): TextureFile[] {
  const tiers = [files.s];
  if (env.saveData || env.maxTextureSize < files.m.width) return tiers;
  tiers.push(files.m);
  // 8192 RGBA with mipmaps takes about 180 MB of GPU memory: desktops only.
  if (env.maxTextureSize >= files.l.width && env.finePointer && (env.deviceMemory ?? 8) >= 8) tiers.push(files.l);
  return tiers;
}

/** Texels per device pixel that a tier should give at the centre of the view before a larger tier is useful. */
export const TEXEL_TARGET = 0.85;

/**
 * Texture width (px) at which one texel covers one device pixel at the centre of the view, times TEXEL_TARGET.
 * At the sub-camera point, one radian of arc on the unit globe is focalPx / (distance - 1) px on screen.
 */
export function neededTextureWidth(viewHeightCss: number, dpr: number, distance: number, fovDeg: number): number {
  const focalPx = ((viewHeightCss / 2) * dpr) / Math.tan((fovDeg * Math.PI) / 360);
  return 2 * Math.PI * (focalPx / Math.max(1e-3, distance - 1)) * TEXEL_TARGET;
}

export interface UpgradeState {
  tiers: number; // count of usable tiers
  level: number; // tier on screen, -1 = none
  busy: boolean; // a load runs
  shownForMs: number; // time since the first texture showed
  idleMs: number; // time since the last user input or camera move
  moving: boolean; // a focus animation or a drag runs
  zoomedOrSelected: boolean; // the user zoomed or selected a country at least once
  needWidth: number; // neededTextureWidth() for the current view
  widths: number[]; // width per tier
}

/** Minimum time between the first texture and the next tier, so the next download does not slow the first view. */
export const SETTLE_MS = 1200;
/** The largest tier waits for this much idle time: its upload is a main-thread hitch of about 50-130 ms. */
export const LARGE_IDLE_MS = 800;

/** The tier to load now, or -1. Each call asks for at most one step up. */
export function nextTextureLevel(s: UpgradeState): number {
  if (s.busy || s.moving || s.level < 0) return -1;
  const next = s.level + 1;
  if (next >= s.tiers) return -1;
  if (s.shownForMs < SETTLE_MS) return -1;
  // The current tier is already sharp enough for this view.
  if (s.needWidth <= s.widths[s.level]) return -1;
  if (next >= 2 && (!s.zoomedOrSelected || s.idleMs < LARGE_IDLE_MS)) return -1;
  return next;
}
