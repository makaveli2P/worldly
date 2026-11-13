// @vitest-environment happy-dom
// The overlay on a view with a rect surface (the flat map), and with no surface (the globe disc).
// A stub view projects lat/lng with a plain linear map, so the screen positions are easy to check.

import { describe, expect, it } from 'vitest';
import { Overlay, edgePoint, type OverlayGlobe } from '../../src/overlay/Overlay';
import type { CountryFeature } from '../../src/types';
import type { Surface } from '../../src/view/types';

const W = window.innerWidth;
const H = window.innerHeight;
const CX = W / 2;
const CY = H / 2;
const PX_PER_DEG = 5;

/** A small square country around (lat, lng), with the ring order that d3 reads as the inside. */
function square(id: string, lat: number, lng: number, d = 2): CountryFeature {
  const ring = [
    [lng - d, lat - d],
    [lng - d, lat + d],
    [lng + d, lat + d],
    [lng + d, lat - d],
    [lng - d, lat - d],
  ];
  return { id, name: id, geometry: { type: 'Polygon', coordinates: [ring] } };
}

// The screen corner: about 30px from the top-left corner.
const CORNER_LAT = (CY - 30) / PX_PER_DEG;
const CORNER_LNG = (30 + 20 - CX) / PX_PER_DEG;
const features = [square('CNR', CORNER_LAT, CORNER_LNG), square('MID', 0, 0), square('FAR', 0, 150)];

function stubView(surface: Surface | null | undefined): OverlayGlobe & { frame(): void } {
  let cb: (() => void) | null = null;
  const view: OverlayGlobe & { frame(): void } = {
    project: (lat, lng) => ({ x: CX + lng * PX_PER_DEG, y: CY - lat * PX_PER_DEG, visible: true, facing: 1 }),
    onFrame: (f) => {
      cb = f;
      return () => (cb = null);
    },
    // distance 2: the horizon is 60° away, so the disc radius is 300px.
    getView: () => ({ lat: 0, lng: 0, altitudeKm: 6371, distance: 2 }),
    selectedAnchor: () => [0, 0],
    frame: () => cb?.(),
  };
  if (surface !== undefined) view.surface = () => surface;
  return view;
}

const fullRect: Surface = { kind: 'rect', x0: 0, y0: 0, x1: W, y1: H };

function mount(surface: Surface | null | undefined) {
  const root = document.createElement('div');
  document.body.append(root);
  const view = stubView(surface);
  const overlay = new Overlay(root, { countries: {}, features, globe: view });
  return { root, view, overlay };
}

const label = (root: HTMLElement, text: string) => [...root.querySelectorAll<HTMLElement>('.wo-country')].find((e) => e.textContent === text);

describe('edgePoint', () => {
  const box = { x0: 0, y0: 0, x1: 100, y1: 50 };
  const s = Math.SQRT1_2;
  it.each([
    [1, 0, 100, 25],
    [-1, 0, 0, 25],
    [0, 1, 50, 50],
    [0, -1, 50, 0],
    [s, s, 75, 50],
    [-s, -s, 25, 0],
    [s, -s, 75, 0],
    [-s, s, 25, 50],
  ])('direction (%f, %f) leaves at (%f, %f)', (dx, dy, x, y) => {
    const p = edgePoint(50, 25, dx, dy, box);
    expect(p.x).toBeCloseTo(x, 9);
    expect(p.y).toBeCloseTo(y, 9);
  });

  it('moves a centre outside the box to the box first', () => {
    expect(edgePoint(150, 25, 1, 0, box)).toEqual({ x: 100, y: 25 });
    expect(edgePoint(-50, 25, 1, 0, box)).toEqual({ x: 100, y: 25 });
    expect(edgePoint(-50, -50, 0, 0, box)).toEqual({ x: 0, y: 0 });
  });
});

describe('Overlay with a rect surface', () => {
  it('places a label near the corner that the disc rejects', () => {
    const map = mount(fullRect);
    map.view.frame();
    expect(label(map.root, 'CNR')?.style.display).toBe('block');
    expect(label(map.root, 'MID')?.style.display).toBe('block');

    const globe = mount(undefined);
    globe.view.frame();
    expect(label(globe.root, 'CNR')?.style.display ?? 'none').not.toBe('block');
    expect(label(globe.root, 'MID')?.style.display).toBe('block');
  });

  it('keeps a label 6px inside the map edges', () => {
    // The map ends just under the corner label: its box is not inside the map.
    const map = mount({ kind: 'rect', x0: 0, y0: 30, x1: W, y1: H });
    map.view.frame();
    expect(label(map.root, 'CNR')?.style.display ?? 'none').not.toBe('block');
  });

  it('shows the rect clip for the leader lines', () => {
    const map = mount(fullRect);
    map.overlay.setSelected('MID');
    map.overlay.setPanelRects({ details: new DOMRect(0, 60, 200, 500), news: null });
    map.view.frame();
    const svg = map.root.querySelector('.wo-lines')!;
    expect(svg.querySelector('clipPath rect')?.getAttribute('display')).toBe('inline');
    expect(svg.querySelector('clipPath circle')?.getAttribute('display')).toBe('none');
    expect(svg.querySelector('mask rect[fill="#000"]')?.getAttribute('display')).toBe('inline');
    expect(svg.querySelector('clipPath rect')?.getAttribute('width')).toBe(W.toFixed(1));
  });

  it('gives an off-screen alert an arrow at the map edge, and an on-screen alert none', () => {
    const map = mount(fullRect);
    map.overlay.setAlerts([
      { id: 'FAR', key: 'far', level: 'major' },
      { id: 'MID', key: 'mid', level: 'major' },
    ]);
    map.view.frame();
    const edges = [...map.root.querySelectorAll<HTMLElement>('.wo-alert-edge')];
    const far = edges.find((e) => e.textContent === 'FAR')!;
    const mid = edges.find((e) => e.textContent === 'MID')!;
    expect(far.hasAttribute('data-on')).toBe(true);
    expect(mid.hasAttribute('data-on')).toBe(false);
    // 12px past the right edge, then the clamp: 4px margin and 10px for the arrow box.
    expect(far.style.transform).toBe(`translate3d(${(W - 14).toFixed(1)}px,${CY.toFixed(1)}px,0)`);
  });
});

describe('Overlay with no surface (the globe)', () => {
  it('keeps the disc clip and the disc arrow', () => {
    const globe = mount(undefined);
    globe.overlay.setSelected('MID');
    globe.overlay.setPanelRects({ details: new DOMRect(0, 60, 200, 500), news: null });
    globe.overlay.setAlerts([{ id: 'FAR', key: 'far', level: 'major' }]);
    globe.view.frame();
    const svg = globe.root.querySelector('.wo-lines')!;
    expect(svg.querySelector('clipPath rect')?.getAttribute('display')).toBe('none');
    expect(svg.querySelector('clipPath circle')?.getAttribute('display')).not.toBe('none');
    expect(svg.querySelector('clipPath circle')?.getAttribute('r')).toBe('300.0');
    const far = globe.root.querySelector<HTMLElement>('.wo-alert-edge')!;
    expect(far.hasAttribute('data-on')).toBe(true);
    // The disc rule: 12px past the disc radius from the centre.
    expect(far.style.transform).toBe(`translate3d(${(CX + 312).toFixed(1)}px,${CY.toFixed(1)}px,0)`);
  });

  it('a null surface is the same as no surface', () => {
    const a = mount(null);
    a.view.frame();
    expect(label(a.root, 'CNR')?.style.display ?? 'none').not.toBe('block');
    expect(label(a.root, 'MID')?.style.display).toBe('block');
  });
});
