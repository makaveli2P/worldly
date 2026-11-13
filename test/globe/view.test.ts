import { describe, expect, it } from 'vitest';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { lonLatToVec } from '../../src/globe/geometry';
import {
  fitRadius,
  MAX_DRAG_LAT,
  clampLat,
  dragLatLimit,
  dragView,
  lerpView,
  lngDelta,
  orientationFor,
  visibleArc,
  wrapLng,
} from '../../src/globe/view';

const DEG = Math.PI / 180;

/** The point at lat/lng, turned by q into view space (camera on +z, screen x right, screen y up). */
function turned(q: Quaternion, lat: number, lng: number): Vector3 {
  return new Vector3(...lonLatToVec(lng, lat)).applyQuaternion(q);
}

/** The orientation from the earlier basis construction, for comparison. */
function basisOrientation(lat: number, lng: number): Quaternion {
  const p = new Vector3(...lonLatToVec(lng, lat));
  const l = lng * DEG;
  const east = new Vector3(Math.cos(l), 0, -Math.sin(l));
  const north = new Vector3().crossVectors(p, east);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(east, north, p)).invert();
}

const VIEWS: [number, number][] = [
  [0, 0],
  [20, 77],
  [-33, 151],
  [51.5, -0.1],
  [64, -150],
  [-75, 30],
  [80, 179.9],
  [-80, -180],
  [87.5, 45],
];

describe('clampLat and wrapLng', () => {
  it('clamps lat to [-90, 90]', () => {
    expect(clampLat(0)).toBe(0);
    expect(clampLat(89)).toBe(89);
    expect(clampLat(-90)).toBe(-90);
    expect(clampLat(91)).toBe(90);
    expect(clampLat(-120)).toBe(-90);
  });

  it('wraps lng into [-180, 180)', () => {
    expect(wrapLng(0)).toBe(0);
    expect(wrapLng(179)).toBe(179);
    expect(wrapLng(180)).toBe(-180);
    expect(wrapLng(-180)).toBe(-180);
    expect(wrapLng(190)).toBe(-170);
    expect(wrapLng(-190)).toBe(170);
    expect(wrapLng(720 + 30)).toBe(30);
    expect(wrapLng(-725)).toBe(-5);
  });
});

describe('lngDelta and lerpView', () => {
  it('gives the shortest signed lng change', () => {
    expect(lngDelta(10, 30)).toBe(20);
    expect(lngDelta(30, 10)).toBe(-20);
    expect(lngDelta(170, -170)).toBe(20);
    expect(lngDelta(-170, 170)).toBe(-20);
    expect(lngDelta(0, 180)).toBe(-180);
  });

  it('goes the short way across the antimeridian', () => {
    const from = { lat: 10, lng: 170 };
    const to = { lat: -20, lng: -160 };
    expect(lerpView(from, to, 0)).toEqual(from);
    const mid = lerpView(from, to, 0.5);
    expect(mid.lat).toBeCloseTo(-5);
    expect(mid.lng).toBeCloseTo(-175);
    const end = lerpView(from, to, 1);
    expect(end.lat).toBeCloseTo(-20);
    expect(end.lng).toBeCloseTo(-160);
  });
});

describe('dragView', () => {
  it('moves the surface right on a drag to the right', () => {
    for (const [lat, lng] of VIEWS) {
      const next = dragView({ lat, lng }, 0.05, 0);
      expect(next.lat).toBe(lat);
      const p = turned(orientationFor(next.lat, next.lng), lat, lng);
      expect(p.x).toBeGreaterThan(0);
      expect(Math.abs(p.y)).toBeLessThan(0.01);
    }
  });

  it('moves the surface down on a drag down, so the north comes into view', () => {
    const next = dragView({ lat: 20, lng: 40 }, 0, 0.1);
    expect(next.lat).toBeCloseTo(20 + 0.1 / DEG);
    expect(next.lng).toBe(40);
    const p = turned(orientationFor(next.lat, next.lng), 20, 40);
    expect(p.y).toBeCloseTo(-Math.sin(0.1));
    expect(p.x).toBeCloseTo(0);
  });

  it('keeps the surface under the pointer for a small horizontal drag', () => {
    for (const lat of [0, 30, 60, 70]) {
      const dx = 0.002;
      const next = dragView({ lat, lng: 0 }, dx, 0);
      const p = turned(orientationFor(next.lat, next.lng), lat, 0);
      expect(p.x).toBeCloseTo(dx, 6);
    }
  });

  it('keeps the view centre under the pointer up to the drag limit', () => {
    // No floor acts inside the limit: the surface does not lag behind the pointer.
    for (const lat of [76, 80, 85, 87.5]) {
      const dx = 0.002;
      const next = dragView({ lat, lng: 0 }, dx, 0, { maxLat: 87.6 });
      const p = turned(orientationFor(next.lat, next.lng), lat, 0);
      // Near the pole the point moves on a small circle, so allow a small chord error.
      expect(Math.abs(p.x / dx - 1)).toBeLessThan(1e-3);
    }
  });

  it('keeps a grabbed point under the pointer for a small horizontal drag', () => {
    // The grab is on the central meridian, above and below the view centre.
    for (const grabLat of [46, 60, -10]) {
      const dx = 0.002;
      const next = dragView({ lat: 20, lng: 0 }, dx, 0, { grabLat });
      const p = turned(orientationFor(next.lat, next.lng), grabLat, 0);
      expect(p.x).toBeCloseTo(dx, 6);
    }
  });

  it('limits the lng change of a grab near a pole to that of a centre grab at the limit', () => {
    const dx = 0.01;
    const next = dragView({ lat: 20, lng: 0 }, dx, 0, { grabLat: 89.9 });
    expect(-next.lng).toBeCloseTo(dx / DEG / Math.cos(MAX_DRAG_LAT * DEG));
  });

  it('stops at the lat limit and wraps lng', () => {
    expect(dragView({ lat: 79, lng: 0 }, 0, 1).lat).toBe(MAX_DRAG_LAT);
    expect(dragView({ lat: -79, lng: 0 }, 0, -1).lat).toBe(-MAX_DRAG_LAT);
    expect(dragView({ lat: 85, lng: 0 }, 0, 1, { maxLat: 87 }).lat).toBe(87);
    expect(dragView({ lat: 0, lng: -179 }, 2 * DEG, 0).lng).toBeCloseTo(179);
  });

  it('does not pull back a view past the limit, and lets the drag move it away from the pole', () => {
    const pole = { lat: -90, lng: 0 };
    expect(dragView(pole, 0.01, 0).lat).toBe(-90);
    expect(dragView(pole, 0, -0.01).lat).toBe(-90);
    expect(dragView(pole, 0, 0.01).lat).toBeCloseTo(-90 + 0.01 / DEG);
    const next = dragView(pole, 0.01, 0);
    expect(Number.isFinite(next.lng)).toBe(true);
    // A view at 87 after a zoom out: a drag toward the pole stops, a drag away moves it.
    expect(dragView({ lat: 87, lng: 0 }, 0, 0.01).lat).toBe(87);
    expect(dragView({ lat: 87, lng: 0 }, 0, -0.01).lat).toBeCloseTo(87 - 0.01 / DEG);
  });
});

describe('visibleArc and dragLatLimit', () => {
  const tan15 = Math.tan(15 * DEG);

  it('gives the arc to the surface point on the ray', () => {
    // Small angle: the camera is distance - 1 from the surface.
    expect(visibleArc(3, 0.001)).toBeCloseTo((2 * 0.001) / DEG, 4);
    // Check against a direct ray-sphere hit.
    const d = 1.3;
    const a = Math.atan(tan15);
    const t = d * Math.cos(a) - Math.sqrt(1 - d * d * Math.sin(a) ** 2);
    const hit = new Vector3(0, t * Math.sin(a), d - t * Math.cos(a));
    expect(visibleArc(d, tan15)).toBeCloseTo(Math.atan2(hit.y, hit.z) / DEG, 6);
  });

  it('gives the arc to the horizon for a ray that misses the globe', () => {
    expect(visibleArc(6, 1)).toBeCloseTo(Math.acos(1 / 6) / DEG);
  });

  it('is MAX_DRAG_LAT far away and goes up close in, with the pole on screen', () => {
    expect(dragLatLimit(visibleArc(6, tan15))).toBe(MAX_DRAG_LAT);
    const arc = visibleArc(1.3, tan15);
    const limit = dragLatLimit(arc);
    expect(limit).toBeGreaterThan(87);
    expect(limit).toBeLessThan(90);
    expect(90 - limit).toBeLessThan(arc);
  });
});

describe('orientationFor', () => {
  it('puts lat/lng in front of the camera', () => {
    for (const [lat, lng] of VIEWS) {
      const p = turned(orientationFor(lat, lng), lat, lng);
      expect(p.x).toBeCloseTo(0);
      expect(p.y).toBeCloseTo(0);
      expect(p.z).toBeCloseTo(1);
    }
  });

  it('keeps north straight up on screen', () => {
    for (const [lat, lng] of VIEWS) {
      const q = orientationFor(lat, lng);
      const pole = new Vector3(0, 1, 0).applyQuaternion(q);
      expect(pole.x).toBeCloseTo(0);
      expect(pole.y).toBeGreaterThan(0);
      // A point a little north of the centre is straight above it on screen.
      const n = turned(q, lat + 1, lng);
      expect(n.x).toBeCloseTo(0);
      expect(n.y).toBeGreaterThan(0);
    }
  });

  it('matches the earlier basis construction', () => {
    for (const [lat, lng] of VIEWS) {
      const a = orientationFor(lat, lng);
      const b = basisOrientation(lat, lng);
      expect(Math.abs(a.dot(b))).toBeCloseTo(1, 6);
    }
  });

  it('writes into the out quaternion', () => {
    const out = new Quaternion();
    expect(orientationFor(10, 20, out)).toBe(out);
  });
});

describe('fitRadius', () => {
  const deg = (r: number) => (r * 180) / Math.PI;
  // Antarctica as the world data keeps it: a small ring round the pole, then the coastline.
  const poleRing = Array.from({ length: 37 }, (_, i) => [-180 + i * 10, -89.999]);
  const coast = Array.from({ length: 37 }, (_, i) => [180 - i * 10, -70]);

  it('reads every ring: Antarctica fits its coastline, not the ring round the pole', () => {
    expect(deg(fitRadius([-90, 0], [poleRing]))).toBeLessThan(0.01);
    expect(deg(fitRadius([-90, 0], [poleRing, coast]))).toBeCloseTo(20, 5);
  });

  it('a hole inside the outer ring does not change the radius', () => {
    const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
    expect(fitRadius([5, 5], [outer, hole])).toBeCloseTo(fitRadius([5, 5], [outer]), 12);
  });
});
