import { describe, expect, it } from 'vitest';
import {
  LARGE_IDLE_MS,
  SETTLE_MS,
  canUploadTexture,
  TEXEL_TARGET,
  chooseTextureTiers,
  mapNeededTextureWidth,
  neededTextureWidth,
  nextTextureLevel,
  type UploadState,
  type UpgradeState,
} from '../../src/globe/textureTiers';

const files = {
  s: { url: '/s.webp', width: 2048, bytes: 1 },
  m: { url: '/m.webp', width: 4096, bytes: 1 },
  l: { url: '/l.webp', width: 8192, bytes: 1 },
};
const desktop = { maxTextureSize: 16384, finePointer: true, saveData: false, deviceMemory: 8 };

describe('chooseTextureTiers', () => {
  it('gives all three tiers to a capable desktop', () => {
    expect(chooseTextureTiers(files, desktop).map((t) => t.width)).toEqual([2048, 4096, 8192]);
  });

  it('gives no 8192 tier to a touch device, a small GPU limit or little memory', () => {
    expect(chooseTextureTiers(files, { ...desktop, finePointer: false })).toHaveLength(2);
    expect(chooseTextureTiers(files, { ...desktop, maxTextureSize: 4096 })).toHaveLength(2);
    expect(chooseTextureTiers(files, { ...desktop, deviceMemory: 4 })).toHaveLength(2);
  });

  it('treats an unknown device memory (Safari, Firefox) as enough', () => {
    expect(chooseTextureTiers(files, { ...desktop, deviceMemory: undefined })).toHaveLength(3);
  });

  it('gives only the first tier with Save-Data or a 2048 GPU limit', () => {
    expect(chooseTextureTiers(files, { ...desktop, saveData: true })).toEqual([files.s]);
    expect(chooseTextureTiers(files, { ...desktop, maxTextureSize: 2048 })).toEqual([files.s]);
  });
});

describe('neededTextureWidth', () => {
  it('grows when the camera comes closer and with the pixel ratio', () => {
    const far = neededTextureWidth(900, 1, 4.5, 30);
    const near = neededTextureWidth(900, 1, 1.8, 30);
    expect(near).toBeGreaterThan(far * 3);
    expect(neededTextureWidth(900, 2, 4.5, 30)).toBeCloseTo(far * 2, 6);
  });

  it('keeps 2048 enough for a phone at the start view and asks for more on a desktop', () => {
    // Phone 390x844 with the DPR cap 1.5 at the fit distance (about 9); desktop 1440x900 DPR 1 (about 4.55).
    expect(neededTextureWidth(844, 1.5, 9, 30)).toBeLessThan(2048);
    expect(neededTextureWidth(900, 1, 4.55, 30)).toBeGreaterThan(2048);
  });
});

describe('nextTextureLevel', () => {
  const base: UpgradeState = {
    tiers: 3,
    level: 0,
    busy: false,
    shownForMs: SETTLE_MS + 1,
    idleMs: LARGE_IDLE_MS + 1,
    moving: false,
    zoomedOrSelected: false,
    needWidth: 3000,
    widths: [2048, 4096, 8192],
  };

  it('asks for tier 1 when the view needs more texels than tier 0 gives', () => {
    expect(nextTextureLevel(base)).toBe(1);
    expect(nextTextureLevel({ ...base, needWidth: 2000 })).toBe(-1);
  });

  it('waits while a load runs, while the camera moves, and just after the first texture', () => {
    expect(nextTextureLevel({ ...base, busy: true })).toBe(-1);
    expect(nextTextureLevel({ ...base, moving: true })).toBe(-1);
    expect(nextTextureLevel({ ...base, shownForMs: SETTLE_MS - 1 })).toBe(-1);
    expect(nextTextureLevel({ ...base, level: -1 })).toBe(-1);
  });

  it('loads 8192 only after the first zoom or selection, at rest, and when the view needs it', () => {
    const at1 = { ...base, level: 1, needWidth: 6000 };
    expect(nextTextureLevel(at1)).toBe(-1);
    expect(nextTextureLevel({ ...at1, zoomedOrSelected: true })).toBe(2);
    expect(nextTextureLevel({ ...at1, zoomedOrSelected: true, idleMs: LARGE_IDLE_MS - 1 })).toBe(-1);
    expect(nextTextureLevel({ ...at1, zoomedOrSelected: true, moving: true })).toBe(-1);
    expect(nextTextureLevel({ ...at1, zoomedOrSelected: true, needWidth: 4000 })).toBe(-1);
  });

  it('stops at the last usable tier', () => {
    expect(nextTextureLevel({ ...base, tiers: 1 })).toBe(-1);
    expect(nextTextureLevel({ ...base, level: 2, zoomedOrSelected: true, needWidth: 99999 })).toBe(-1);
  });
});

describe('canUploadTexture', () => {
  const rest: UploadState = { level: 2, dragging: false, focusAnim: false, inertia: false, framing: false, spinning: false, idleMs: LARGE_IDLE_MS };

  it('uploads tier 0 at once, also while the globe moves', () => {
    expect(canUploadTexture({ ...rest, level: 0, dragging: true, focusAnim: true, inertia: true, framing: true, spinning: true, idleMs: 0 })).toBe(true);
  });

  it('holds a larger tier while the user drags, the globe turns to a selection, inertia runs or the zoom eases', () => {
    for (const level of [1, 2]) {
      expect(canUploadTexture({ ...rest, level, dragging: true })).toBe(false);
      expect(canUploadTexture({ ...rest, level, focusAnim: true })).toBe(false);
      expect(canUploadTexture({ ...rest, level, inertia: true })).toBe(false);
      expect(canUploadTexture({ ...rest, level, framing: true })).toBe(false);
    }
  });

  it('lets tier 1 upload during the idle spin and with no idle time', () => {
    expect(canUploadTexture({ ...rest, level: 1, spinning: true, idleMs: 0 })).toBe(true);
  });

  it('holds tier 2 during the idle spin and until LARGE_IDLE_MS of idle time', () => {
    expect(canUploadTexture({ ...rest, spinning: true })).toBe(false);
    expect(canUploadTexture({ ...rest, idleMs: LARGE_IDLE_MS - 1 })).toBe(false);
    expect(canUploadTexture(rest)).toBe(true);
  });
});

describe('mapNeededTextureWidth', () => {
  it('gives the width at which one texel covers one device pixel at the equator, times TEXEL_TARGET', () => {
    // 300 CSS px per radian at dpr 2: the world is 2π · 600 device px wide.
    expect(mapNeededTextureWidth(300, 2, 0)).toBeCloseTo(2 * Math.PI * 600 * TEXEL_TARGET, 6);
  });

  it('grows by sec(lat) toward the poles, up to 2', () => {
    const eq = mapNeededTextureWidth(300, 1, 0);
    expect(mapNeededTextureWidth(300, 1, 45) / eq).toBeCloseTo(Math.SQRT2, 9);
    expect(mapNeededTextureWidth(300, 1, -45) / eq).toBeCloseTo(Math.SQRT2, 9);
    expect(mapNeededTextureWidth(300, 1, 60) / eq).toBeCloseTo(2, 9);
    expect(mapNeededTextureWidth(300, 1, 80) / eq).toBe(2);
    expect(mapNeededTextureWidth(300, 1, 90) / eq).toBe(2);
  });

  it('asks for the 4096 tier at the home view of a desktop, and the 8192 tier only zoomed in', () => {
    // sHome on 1440 x 900 is about 257 px per radian.
    expect(mapNeededTextureWidth(257, 2, 20)).toBeGreaterThan(2048);
    expect(mapNeededTextureWidth(257, 2, 20)).toBeLessThan(4096);
    expect(mapNeededTextureWidth(1000, 2, 20)).toBeGreaterThan(8192);
  });
});
