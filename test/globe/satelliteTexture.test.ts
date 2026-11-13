// The handover of the satellite image from one view to the next (src/globe/satelliteTexture.ts).
// The old view runs for the crossfade after handover(). It must not close the image that the new view holds.

import type { WebGLRenderer } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SatelliteTexture } from '../../src/globe/satelliteTexture';
import type { TextureFile } from '../../src/globe/textureManifest';

class FakeBitmap {
  closed = false;
  width = 4;
  height = 2;
  close() {
    this.closed = true;
  }
}

const renderer = { initTexture() {}, capabilities: { getMaxAnisotropy: () => 1 } } as unknown as WebGLRenderer;
const reducedMotion = { matches: true } as MediaQueryList;
const tiers = [
  { url: 'a', width: 2048 },
  { url: 'b', width: 4096 },
  { url: 'c', width: 8192 },
] as TextureFile[];
const atRest = { dragging: false, focusAnim: false, inertia: false, framing: false, spinning: false, idleMs: 5000 };

/** The loader callback: a decoded tier arrives. */
const decoded = (t: SatelliteTexture, level: number, image: FakeBitmap) =>
  (t as unknown as { onDecoded(level: number, image: unknown): void }).onDecoded(level, image);

const make = (image: FakeBitmap, level = 0) =>
  new SatelliteTexture(renderer, { tiers, reducedMotion, onChange() {}, handover: { level, image: image as unknown as ImageBitmap } });

describe('SatelliteTexture.handover', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageBitmap', FakeBitmap);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the handed image open when a decode of the old view arrives after the handover', () => {
    const shown = new FakeBitmap();
    const old = make(shown);
    const handed = old.handover()!;
    expect(handed.image).toBe(shown);
    const next = make(handed.image as unknown as FakeBitmap, handed.level);

    // The crossfade: a tier-1 decode that was in flight arrives, and the old view has a frame at rest.
    const late = new FakeBitmap();
    decoded(old, 1, late);
    old.upload(atRest);
    old.dispose();

    expect(shown.closed).toBe(false);
    expect(late.closed).toBe(true); // the late decode is not leaked
    // The new view can give the same open image to a third view.
    expect(next.handover()?.image).toBe(shown);
    expect(shown.closed).toBe(false);
  });

  it('closes a tier-0 decode that arrives after the handover', () => {
    const shown = new FakeBitmap();
    const old = make(shown);
    old.handover();
    const late = new FakeBitmap();
    decoded(old, 0, late);
    expect(late.closed).toBe(true);
    expect(shown.closed).toBe(false);
  });

  it('closes the image on dispose when there was no handover', () => {
    const shown = new FakeBitmap();
    const t = make(shown);
    t.dispose();
    expect(shown.closed).toBe(true);
  });
});
