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

describe('SatelliteTexture after a context loss', () => {
  beforeEach(() => {
    vi.stubGlobal('ImageBitmap', FakeBitmap);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const internals = (t: SatelliteTexture) => t as unknown as { level: number; busy: boolean; pending: unknown; tiers: TextureFile[] };

  it('keeps the image on screen open in a new texture, so three.js can upload it again', () => {
    const shown = new FakeBitmap();
    const t = make(shown, 1);
    const tex = t.uniform.value!;
    const dispose = vi.spyOn(tex, 'dispose');
    t.contextLost();
    t.contextRestored(3);
    // The old texture has the dispose listener of the lost context: it must not get dispose().
    expect(t.uniform.value).not.toBe(tex);
    expect(t.uniform.value?.image).toBe(shown);
    expect(dispose).not.toHaveBeenCalled();
    expect(shown.closed).toBe(false);
    expect(internals(t).level).toBe(1);
    // A later texture swap frees the texture from after the restore.
    const after = t.uniform.value!;
    const disposeAfter = vi.spyOn(after, 'dispose');
    decoded(t, 2, new FakeBitmap());
    t.upload(atRest);
    expect(disposeAfter).toHaveBeenCalledTimes(1);
    expect(dispose).not.toHaveBeenCalled();
    expect(shown.closed).toBe(true);
  });

  it('holds a decoded tier while the context is lost, and uploads it after the restore', () => {
    const load = vi.spyOn(SatelliteTexture.prototype as unknown as { loadLevel(): void }, 'loadLevel').mockImplementation(() => {});
    const t = new SatelliteTexture(renderer, { tiers, reducedMotion, onChange() {} });
    t.ensure();
    expect(load).toHaveBeenCalledTimes(1);
    t.contextLost();
    const first = new FakeBitmap();
    decoded(t, 0, first);
    expect(t.uniform.value).toBeNull();
    t.upload(atRest);
    expect(t.uniform.value).toBeNull();
    t.contextRestored(2);
    t.upload(atRest);
    expect(t.uniform.value?.image).toBe(first);
  });

  it('drops the 8192 tier on screen after the restore and loads tier 0 again', () => {
    const load = vi.spyOn(SatelliteTexture.prototype as unknown as { loadLevel(level: number): void }, 'loadLevel').mockImplementation(() => {});
    const large = new FakeBitmap();
    const t = make(large, 2);
    const dispose = vi.spyOn(t.uniform.value!, 'dispose');
    t.contextLost();
    t.contextRestored(2);
    expect(dispose).not.toHaveBeenCalled(); // three.js discarded its GL objects on the loss
    expect(large.closed).toBe(true);
    expect(t.uniform.value).toBeNull();
    expect(t.mix).toBe(0);
    expect(internals(t).tiers.map((f) => f.width)).toEqual([2048, 4096]);
    expect(load).toHaveBeenCalledWith(0);
  });

  it('closes an 8192 decode that waits or arrives after the restore', () => {
    const t = make(new FakeBitmap(), 1);
    t.contextLost();
    const waiting = new FakeBitmap();
    decoded(t, 2, waiting);
    t.contextRestored(2);
    expect(waiting.closed).toBe(true);
    expect(internals(t).pending).toBeNull();
    expect(internals(t).busy).toBe(false);
    const late = new FakeBitmap();
    decoded(t, 2, late);
    expect(late.closed).toBe(true);
    expect(internals(t).level).toBe(1);
  });

  it('does not use a handover above its tier limit (the 8192 tier after a loss)', () => {
    const large = new FakeBitmap();
    const t = new SatelliteTexture(renderer, {
      tiers: tiers.slice(0, 2),
      reducedMotion,
      onChange() {},
      handover: { level: 2, image: large as unknown as ImageBitmap },
    });
    expect(t.uniform.value).toBeNull();
    expect(t.mix).toBe(0);
    expect(internals(t).level).toBe(-1);
    expect(large.closed).toBe(true); // this view owns the image: the old view does not close it
  });

  it('gives no handover while the context is lost, and closes the image on dispose', () => {
    const shown = new FakeBitmap();
    const t = make(shown, 2);
    t.contextLost();
    expect(t.handover()).toBeNull();
    expect(shown.closed).toBe(false);
    t.dispose();
    expect(shown.closed).toBe(true);
  });
});
