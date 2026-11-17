// The class of the GPU, from the WebGL renderer string. A pure function, so the tests can drive it.
// chooseTextureTiers (textureTiers.ts) uses the class: only a strong GPU gets the 8192 tier.
//
// Chromium gives the real name through WEBGL_debug_renderer_info (src/globe/gpu.ts), for example
// "ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)".
// Firefox gives a sanitized name with ", or similar": the name of a bucket of GPUs, not the real GPU.
// Safari gives "Apple GPU" on macOS and on iOS: that is 'unknown'.

export type GpuClass = 'software' | 'integrated' | 'discrete' | 'apple-silicon' | 'unknown';

const SOFTWARE = /swiftshader|llvmpipe|softpipe|lavapipe|microsoft basic render|software (rasterizer|renderer)/i;
// Apple M1 to M4 (and later) on macOS. Chrome: "ANGLE Metal Renderer: Apple M2". Firefox: "Apple M1, or similar".
const APPLE_SILICON = /\bapple m\d+\b/i;
// NVIDIA desktop and laptop GPUs (not Tegra), AMD Radeon RX, Pro, FirePro and R9, Intel Arc A and B cards.
const DISCRETE = /geforce|quadro|\brtx\b|\btesla\b|titan|radeon\s*(\(tm\)\s*)?(rx|pro|r9|vii)\b|firepro|\barc(\(tm\))?\s+[ab]\d{3}/i;
// AMD APUs: "Radeon(TM) Graphics", "Radeon(TM) RX Vega 10 Graphics", "Radeon 780M". The "RX" in some APU names is not a card.
const AMD_APU = /radeon\s*(\(tm\)\s*)?graphics|radeon.*\bvega\s*\d+\s*graphics|radeon\s*(\(tm\)\s*)?\d{3}m\b/i;
// Intel HD, UHD, Iris and Arc on the CPU, other AMD and ATI GPUs, phone and tablet GPUs.
const INTEGRATED = /intel|radeon|\bamd\b|\bati\b|mali|adreno|powervr|tegra|videocore|immortalis|xclipse|apple a\d+/i;
// Firefox buckets (dom/canvas/SanitizeRenderer.cpp) that hold integrated GPUs and cards together.
// "Radeon R9 200 Series" holds the AMD APUs (Vega, 680M, 780M) and the cards. "Arc(TM) A750" holds the
// Arc GPU on the CPU (Meteor Lake, Lunar Lake) and the Arc cards. The real class is not known.
const FIREFOX_MIXED_BUCKET = /radeon r9 200 series|arc\(tm\) a750/i;
const FIREFOX_BUCKET = /, or similar$/i;

/** The GPU class for a WebGL renderer string. An empty or generic string gives 'unknown'. */
export function classifyGpu(renderer: string): GpuClass {
  const s = renderer.trim();
  if (!s) return 'unknown';
  if (SOFTWARE.test(s)) return 'software';
  if (APPLE_SILICON.test(s)) return 'apple-silicon';
  if (FIREFOX_BUCKET.test(s) && FIREFOX_MIXED_BUCKET.test(s)) return 'unknown';
  if (/nvidia/i.test(s) && !/tegra/i.test(s)) return 'discrete';
  if (AMD_APU.test(s)) return 'integrated';
  if (DISCRETE.test(s)) return 'discrete';
  // "Apple GPU" is Safari on a Mac or on an iPhone: Safari does not give the chip name.
  if (/^apple gpu$/i.test(s)) return 'unknown';
  if (INTEGRATED.test(s)) return 'integrated';
  return 'unknown';
}
