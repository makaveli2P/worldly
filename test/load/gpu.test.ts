// The GPU renderer string from WebGL (src/globe/gpu.ts). Chromium and Safari give a generic RENDERER, so the
// page must read WEBGL_debug_renderer_info. The module keeps the first name, so each test loads it again.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const RENDERER = 0x1f01;
const UNMASKED_RENDERER_WEBGL = 0x9246;

/** A fake WebGL context: RENDERER gives `renderer`, and the extension (if any) gives `unmasked`. */
function fakeGl(renderer: string, unmasked: string | null, lost = false) {
  return {
    RENDERER,
    getParameter: (p: number) => (p === RENDERER ? renderer : p === UNMASKED_RENDERER_WEBGL ? unmasked : null),
    getExtension: (name: string) => (name === 'WEBGL_debug_renderer_info' && unmasked !== null ? { UNMASKED_RENDERER_WEBGL } : null),
    isContextLost: () => lost,
  } as unknown as WebGL2RenderingContext;
}

const load = async () => (await import('../../src/globe/gpu')).gpuRenderer;

describe('gpuRenderer', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reads the extension when Chromium gives "WebKit WebGL"', async () => {
    const gpuRenderer = await load();
    const angle = 'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)';
    expect(gpuRenderer(fakeGl('WebKit WebGL', angle))).toBe(angle);
  });

  it('keeps the Firefox name in RENDERER', async () => {
    const gpuRenderer = await load();
    const name = 'ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar';
    expect(gpuRenderer(fakeGl(name, 'other'))).toBe(name);
  });

  it('gives the generic name when the extension is not there', async () => {
    const gpuRenderer = await load();
    expect(gpuRenderer(fakeGl('WebKit WebGL', null))).toBe('WebKit WebGL');
  });

  it('does not keep the name of a lost context', async () => {
    const gpuRenderer = await load();
    expect(gpuRenderer(fakeGl('', null, true))).toBe('');
    expect(gpuRenderer(fakeGl('WebKit WebGL', 'Apple M2'))).toBe('Apple M2');
  });
});
