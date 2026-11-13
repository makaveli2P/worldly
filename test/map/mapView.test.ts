import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildLabelsFile, worldFeatures, type WorldTopology } from '../../src/data/precompute';
import { worldAssets } from '../../src/globe/assets';
import { EARTH_KM, FOCUS_FILL, FOV, MIN_DIST } from '../../src/globe/constants';
import {
  HOME_N,
  HOME_S,
  anchorCamera,
  cameraBounds,
  clampY,
  copyOffsets,
  fitScale,
  focusExtent,
  focusScale,
  freeRect,
  fromScreen,
  kmPerPxMap,
  lerpCenter,
  panBy,
  sHome,
  sMax,
  sMin,
  scaleDenominator,
  targetScale,
  toScreen,
  type MapCamera,
  type MapFrame,
} from '../../src/map/mapView';
import { mercY } from '../../src/map/mercator';
import type { Insets } from '../../src/view/types';

const RAD = Math.PI / 180;
const TAU = 2 * Math.PI;
const none: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

function frame(width: number, height: number, insets: Insets = none): MapFrame {
  return { width, height, insets, focal: height / 2 / Math.tan((FOV * Math.PI) / 360) };
}

const desktop = frame(1440, 900);
// The details and news plates on desktop, and the bottom sheet at half height on a phone.
const plates = frame(1440, 900, { left: 380, right: 380, top: 56, bottom: 0 });
const phone = frame(390, 844, { left: 0, right: 0, top: 56, bottom: 422 });
const ultrawide = frame(3440, 1440);

const world = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/data/world.json'), 'utf8')) as WorldTopology;
const features = worldFeatures(world);
const assets = worldAssets(features, new Set(buildLabelsFile(world).inverted));
function country(id: string) {
  const i = assets.idToIndex.get(id)!;
  return { rings: assets.labels.mainRings(i)!, at: assets.labels.labelOf(i).latlng };
}

/** The centre and scale that FlatMap.focus() flies to. */
function focusCamera(id: string, f: MapFrame): MapCamera {
  const c = country(id);
  const s = targetScale(f, { zoomRatio: 1, fit: focusScale(c.rings, c.at, f) });
  return { x: c.at[1] * RAD, y: clampY(mercY(c.at[0]), s, f), s };
}

/** The screen box of the rings at camera cam (each point at its copy nearest the camera). */
function screenBox(rings: number[][][], cam: MapCamera, f: MapFrame) {
  const box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const r of rings)
    for (const [lng, lat] of r) {
      const p = toScreen(lat, lng, cam, f);
      box.x0 = Math.min(box.x0, p.x);
      box.x1 = Math.max(box.x1, p.x);
      box.y0 = Math.min(box.y0, p.y);
      box.y1 = Math.max(box.y1, p.y);
    }
  return box;
}

describe('zoom limits', () => {
  it('gives sMin, sHome and sMax on a desktop screen', () => {
    expect(sMin(desktop)).toBeCloseTo(1440 / TAU, 9);
    expect(sHome(desktop)).toBeCloseTo(900 / (mercY(HOME_N) - mercY(HOME_S)), 9);
    expect(sHome(desktop)).toBeCloseTo(257.0, 0);
    expect(sMax(desktop)).toBeCloseTo(desktop.focal / (MIN_DIST - 1), 9);
    expect(sMin(desktop)).toBeLessThan(sHome(desktop));
    expect(sHome(desktop)).toBeLessThan(sMax(desktop));
  });

  it('frames the home view in the free rect above the phone sheet', () => {
    const free = freeRect(phone);
    expect(free).toEqual({ w: 390, h: 366, cx: 195, cy: 56 + 183 });
    expect(sMin(phone)).toBeCloseTo(390 / TAU, 9);
    expect(sHome(phone)).toBeCloseTo(366 / (mercY(HOME_N) - mercY(HOME_S)), 9);
  });

  it('uses sMin as the home view on an ultrawide screen: no second copy of the world at rest', () => {
    expect(sHome(ultrawide)).toBe(sMin(ultrawide));
    expect(sMin(ultrawide)).toBeCloseTo(3440 / TAU, 9);
  });

  it('shows no empty band and no repeat at sMin', () => {
    for (const f of [desktop, plates, phone, ultrawide]) {
      const s = sMin(f);
      const free = freeRect(f);
      // The world is at least as wide and as high as the free rect, and exactly fills the larger side.
      expect(TAU * s).toBeGreaterThanOrEqual(free.w - 1e-9);
      expect(TAU * s).toBeGreaterThanOrEqual(free.h - 1e-9);
      expect(Math.max(free.w, free.h)).toBeCloseTo(TAU * s, 9);
      // With the camera clamped, both map edges are outside the free rect.
      for (const y of [-10, 0, 10]) {
        const cy = clampY(y, s, f);
        const top = free.cy - (Math.PI - cy) * s;
        const bottom = free.cy + (cy + Math.PI) * s;
        expect(top).toBeLessThanOrEqual(f.insets.top + 1e-6);
        expect(bottom).toBeGreaterThanOrEqual(f.insets.top + free.h - 1e-6);
      }
    }
  });
});

describe('clampY', () => {
  it('stops the camera so that a map edge touches the free rect', () => {
    const s = 400;
    const h = 900 / (2 * s);
    expect(clampY(10, s, desktop)).toBeCloseTo(Math.PI - h, 12);
    expect(clampY(-10, s, desktop)).toBeCloseTo(-Math.PI + h, 12);
    expect(clampY(0.3, s, desktop)).toBe(0.3);
  });

  it('uses the free height, not the canvas height, with insets', () => {
    const s = 400;
    const h = 366 / (2 * s);
    expect(clampY(10, s, phone)).toBeCloseTo(Math.PI - h, 12);
    expect(clampY(-10, s, phone)).toBeCloseTo(-Math.PI + h, 12);
  });

  it('centres the world when it is lower than the free rect', () => {
    expect(clampY(1, 900 / TAU / 2, desktop)).toBe(0);
  });
});

describe('camera moves', () => {
  it('wraps x on a pan, and the map moves with the pointer', () => {
    const cam = { x: 3, y: 0, s: 300 };
    const next = panBy(cam, -0.3, 0, desktop); // a drag to the left by 0.3 world units
    expect(next.x).toBeCloseTo(3.3 - TAU, 12);
    expect(panBy(cam, 0, 0.2, desktop).y).toBeCloseTo(0.2, 12); // a drag down brings the north into view
    expect(panBy(cam, 0, 50, desktop).y).toBeCloseTo(clampY(50, 300, desktop), 12);
  });

  it('keeps the anchor point under the pointer at a new scale', () => {
    const cam = { x: 0.4, y: 0.7, s: 300 };
    const px = 1100;
    const py = 200;
    const ll = fromScreen(px, py, cam, desktop)!;
    const { cx, cy } = freeRect(desktop);
    const anchor = { wx: cam.x + (px - cx) / cam.s, wy: cam.y - (py - cy) / cam.s, px, py };
    for (const s of [150, 450, 2000]) {
      const p = toScreen(ll.lat, ll.lng, anchorCamera(anchor, s, desktop), desktop);
      expect(p.x).toBeCloseTo(px, 6);
      expect(p.y).toBeCloseTo(py, 6);
    }
  });

  it('goes the short way across the antimeridian', () => {
    const from = { x: 170 * RAD, y: 0 };
    const to = { x: -170 * RAD, y: 1 };
    const mid = lerpCenter(from, to, 0.5);
    expect(Math.abs(mid.x)).toBeCloseTo(Math.PI, 9);
    expect(mid.y).toBeCloseTo(0.5, 12);
    expect(lerpCenter(from, to, 1).x).toBeCloseTo(-170 * RAD, 12);
  });
});

describe('toScreen and fromScreen', () => {
  const cam = { x: 2.5, y: 0.6, s: 350 };

  it('round-trips a point', () => {
    for (const [lat, lng] of [
      [48.86, 2.35],
      [35.68, 139.69],
      [-33.9, 151.2],
      [64.1, -21.9],
    ]) {
      const p = toScreen(lat, lng, cam, plates);
      const back = fromScreen(p.x, p.y, cam, plates)!;
      expect(back.lat).toBeCloseTo(lat, 9);
      expect(back.lng).toBeCloseTo(lng, 9);
    }
  });

  it('projects to the copy nearest the camera across ±180', () => {
    const at180 = { x: Math.PI - 0.01, y: 0, s: 300 };
    const east = toScreen(0, -179, at180, desktop); // just east of the antimeridian
    const west = toScreen(0, 179, at180, desktop);
    const { cx } = freeRect(desktop);
    expect(east.x).toBeGreaterThan(cx);
    expect(west.x).toBeLessThan(cx);
    expect(east.x - west.x).toBeCloseTo(2 * RAD * 300, 6);
  });

  it('gives null past a map edge, and the lift moves a point up', () => {
    const top = { x: 0, y: clampY(10, 300, desktop), s: 300 };
    expect(fromScreen(720, -400, top, desktop)).toBeNull();
    const p = toScreen(10, 10, cam, desktop);
    expect(toScreen(10, 10, cam, desktop, 6).y).toBeCloseTo(p.y - 6, 9);
  });

  it('gives the camera bounds of the whole canvas', () => {
    const b = cameraBounds(cam, plates);
    const { cx, cy } = freeRect(plates);
    expect(b.left).toBeCloseTo(cam.x - cx / cam.s, 12);
    expect(b.right - b.left).toBeCloseTo(1440 / cam.s, 9);
    expect(b.top - b.bottom).toBeCloseTo(900 / cam.s, 9);
    expect(b.top).toBeCloseTo(cam.y + cy / cam.s, 12);
  });
});

describe('copyOffsets', () => {
  // The world mesh spans a little more than one turn: the unwrapped lon of Russia goes past 180°.
  const xMin = -181.4 * RAD;
  const xMax = 190.3 * RAD;

  it('gives one copy for a view inside the world', () => {
    expect(copyOffsets(-1, 1, xMin, xMax)).toEqual([0]);
  });

  it('gives two copies for a view across the antimeridian', () => {
    expect(copyOffsets(2.5, 4, xMin, xMax)).toEqual([0, 1]);
    expect(copyOffsets(-4, -2.5, xMin, xMax)).toEqual([-1, 0]);
  });

  it('gives up to four copies for a wide view, the nearest first kept', () => {
    expect(copyOffsets(-12, 12, xMin, xMax)).toHaveLength(4);
    const all = copyOffsets(-12, 12, xMin, xMax, 99);
    expect(all.length).toBeGreaterThan(4);
    const four = copyOffsets(-12, 12, xMin, xMax);
    expect(four).toEqual([...four].sort((a, b) => a - b));
    expect(four).toContain(0);
  });
});

describe('focus framing', () => {
  it('fits Japan in the free rect between the desktop plates', () => {
    const f = plates;
    const cam = focusCamera('JPN', f);
    const box = screenBox(country('JPN').rings, cam, f);
    const free = freeRect(f);
    expect(box.x0).toBeGreaterThanOrEqual(f.insets.left);
    expect(box.x1).toBeLessThanOrEqual(f.width - f.insets.right);
    expect(box.y0).toBeGreaterThanOrEqual(f.insets.top);
    expect(box.y1).toBeLessThanOrEqual(f.insets.top + free.h);
    // One side fills 2 × FOCUS_FILL of the free rect.
    const fillX = (box.x1 - box.x0) / free.w;
    const fillY = (box.y1 - box.y0) / free.h;
    expect(Math.max(fillX, fillY)).toBeGreaterThan(FOCUS_FILL);
    expect(Math.max(fillX, fillY)).toBeLessThanOrEqual(2 * FOCUS_FILL + 1e-6);
  });

  it('fits Japan above the phone sheet', () => {
    const f = phone;
    const cam = focusCamera('JPN', f);
    const box = screenBox(country('JPN').rings, cam, f);
    expect(box.y0).toBeGreaterThanOrEqual(56);
    expect(box.y1).toBeLessThanOrEqual(844 - 422);
    expect(box.x0).toBeGreaterThanOrEqual(0);
    expect(box.x1).toBeLessThanOrEqual(390);
  });

  it('fits Russia across the antimeridian, and never zooms out past the home view', () => {
    const c = country('RUS');
    // The main polygon has points on both sides of 180°: the unwrap keeps the fit near the size of Russia.
    expect(c.rings.flat().some((p) => p[0] > 170)).toBe(true);
    expect(c.rings.flat().some((p) => p[0] < -170)).toBe(true);
    const fit = focusScale(c.rings, c.at, desktop);
    // Unwrapped, Russia is about 190° wide (half 95°); with no unwrap a point at -180 would count as 275° away.
    expect((FOCUS_FILL * 1440) / fit / RAD).toBeLessThan(110);
    expect(targetScale(desktop, { zoomRatio: 1, fit })).toBe(sHome(desktop));
  });

  it('refits a focused country when the panels open after the focus', () => {
    // FlatMap.focus() runs before the panels open. It keeps the extent, and each frame fits it to its free rect.
    for (const id of ['USA', 'FJI', 'JPN', 'FRA', 'CHL']) {
      const c = country(id);
      const extent = focusExtent(c.rings, c.at);
      expect(fitScale(extent, desktop)).toBe(focusScale(c.rings, c.at, desktop));
      expect(fitScale(extent, plates)).toBe(focusScale(c.rings, c.at, plates));
      expect(fitScale(extent, phone)).toBe(focusScale(c.rings, c.at, phone));
      // With the panels open, the country stays inside the free rect between them.
      const s = targetScale(plates, { zoomRatio: 1, fit: fitScale(extent, plates) });
      const cam = { x: c.at[1] * RAD, y: clampY(mercY(c.at[0]), s, plates), s };
      const box = screenBox(c.rings, cam, plates);
      const r = freeRect(plates);
      expect(box.x0).toBeGreaterThanOrEqual(r.cx - r.w / 2 - 1);
      expect(box.x1).toBeLessThanOrEqual(r.cx + r.w / 2 + 1);
    }
    // The fit before the panels open is up to about 2x too close for the USA: a fit kept as a number goes wrong.
    const us = country('USA');
    expect(focusScale(us.rings, us.at, desktop) / focusScale(us.rings, us.at, plates)).toBeGreaterThan(1.8);
  });

  it('unwraps a ring round the focus lng', () => {
    const ring = [[[175, -1], [-175, -1], [-175, 1], [175, 1]]];
    const fit = focusScale(ring, [0, 180], desktop);
    expect(fit).toBeCloseTo(Math.min((FOCUS_FILL * 1440) / (5 * RAD), (FOCUS_FILL * 900) / mercY(1)), 6);
  });

  it('zooms to Fiji, which sits on the antimeridian', () => {
    const cam = focusCamera('FJI', desktop);
    expect(cam.s).toBeGreaterThan(sHome(desktop) * 5);
    const box = screenBox(country('FJI').rings, cam, desktop);
    expect(box.x0).toBeGreaterThanOrEqual(0);
    expect(box.x1).toBeLessThanOrEqual(1440);
  });

  it('clamps the Vatican to sMax', () => {
    const c = country('VAT');
    const fit = focusScale(c.rings, c.at, desktop);
    expect(fit).toBeGreaterThan(sMax(desktop));
    expect(targetScale(desktop, { zoomRatio: 1, fit })).toBe(sMax(desktop));
  });

  it('puts the camera at the bottom edge for Antarctica', () => {
    const cam = focusCamera('ATA', desktop);
    expect(cam.y).toBeCloseTo(-Math.PI + 900 / (2 * cam.s), 9);
    const { cy } = freeRect(desktop);
    expect(cy + (cam.y + Math.PI) * cam.s).toBeCloseTo(900, 6); // the south edge of the map is the bottom of the screen
  });

  it('uses the user zoom with no fit, inside the limits', () => {
    expect(targetScale(desktop, { zoomRatio: 1, fit: null })).toBe(sHome(desktop));
    expect(targetScale(desktop, { zoomRatio: 3, fit: null })).toBeCloseTo(3 * sHome(desktop), 9);
    expect(targetScale(desktop, { zoomRatio: 1e-3, fit: null })).toBe(sMin(desktop));
    expect(targetScale(desktop, { zoomRatio: 1e3, fit: null })).toBe(sMax(desktop));
  });
});

describe('scale readout', () => {
  it('gives km per px from the scale and the lat', () => {
    expect(kmPerPxMap(EARTH_KM, 0)).toBeCloseTo(1, 12);
    expect(kmPerPxMap(EARTH_KM, 60)).toBeCloseTo(0.5, 12);
    expect(kmPerPxMap(100, 0)).toBeCloseTo(63.71, 9);
  });

  it('gives the map scale for 96 CSS px per inch', () => {
    expect(scaleDenominator(1)).toBeCloseTo(3_779_527.6, 0); // 1 km per px = 1:3.78M
    expect(scaleDenominator(0.26458333e-6)).toBeCloseTo(1, 9);
  });
});
