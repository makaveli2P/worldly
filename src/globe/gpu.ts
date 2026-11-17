// The texture tiers for this device. The globe and the flat map call deviceTextureTiers() with their renderer.
// The page reads the GPU renderer string one time: the GPU does not change while the page is open.

import type { WebGLRenderer } from 'three';
import { contextLostInPage } from '../view/contextWatch';
import { classifyGpu, type GpuClass } from './gpuClass';
import { TEXTURES, type TextureFile } from './textureManifest';
import { chooseTextureTiers } from './textureTiers';

let rendererName: string | null = null;

/**
 * The GPU renderer string. Chromium (Chrome, Edge) and Safari give a generic RENDERER ("WebKit WebGL"):
 * the page then reads WEBGL_debug_renderer_info. Firefox gives a sanitized name in RENDERER.
 * Do not remove the extension read: without it, every Chromium GPU is 'unknown'. A lost context gives no name.
 */
export function gpuRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  if (rendererName !== null) return rendererName;
  let name = '';
  try {
    name = String(gl.getParameter(gl.RENDERER) ?? '');
    if (/^(webkit webgl|webkit|mozilla)?$/i.test(name.trim())) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) name = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? name);
    }
  } catch {
    name = '';
  }
  if (!gl.isContextLost()) rendererName = name;
  return name;
}

/** The GPU class of this device (gpuClass.ts). */
export function gpuClass(renderer: WebGLRenderer): GpuClass {
  return classifyGpu(gpuRenderer(renderer.getContext()));
}

/** The texture tiers that this device may use, smallest first (chooseTextureTiers). */
export function deviceTextureTiers(renderer: WebGLRenderer): TextureFile[] {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return chooseTextureTiers(TEXTURES, {
    maxTextureSize: renderer.capabilities.maxTextureSize,
    finePointer: window.matchMedia('(pointer: fine)').matches,
    saveData: nav.connection?.saveData === true,
    deviceMemory: nav.deviceMemory,
    gpu: gpuClass(renderer),
    contextLost: contextLostInPage(),
  });
}
