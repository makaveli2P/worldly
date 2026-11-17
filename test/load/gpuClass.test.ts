// The GPU class from the WebGL renderer string (src/globe/gpuClass.ts). The strings come from real browsers.

import { describe, expect, it } from 'vitest';
import { classifyGpu, type GpuClass } from '../../src/globe/gpuClass';

const cases: [string, GpuClass][] = [
  // Software renderers.
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software'],
  ['Google SwiftShader', 'software'],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software'],
  ['ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)', 'software'],
  ['softpipe', 'software'],
  // Integrated GPUs.
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0), or similar', 'integrated'],
  ['ANGLE (Intel, Intel(R) Arc(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics 655, OpenGL 4.1)', 'integrated'],
  ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (AMD, AMD Radeon(TM) RX Vega 10 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (AMD, AMD Radeon 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (Qualcomm, Qualcomm(R) Adreno(TM) X1-85 GPU Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['Adreno (TM) 740', 'integrated'],
  ['Mali-G78', 'integrated'],
  ['PowerVR Rogue GE8320', 'integrated'],
  ['NVIDIA Tegra X1', 'integrated'],
  // Discrete GPUs.
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
  ['ANGLE (NVIDIA, NVIDIA GeForce GTX 980 Direct3D11 vs_5_0 ps_5_0), or similar', 'discrete'],
  ['ANGLE (NVIDIA, NVIDIA Quadro P1000 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
  ['ANGLE (AMD, AMD Radeon RX 6800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
  ['ANGLE (AMD, ANGLE Metal Renderer: AMD Radeon Pro 5500M, Unspecified Version)', 'discrete'],
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
  ['ANGLE (Intel, Intel(R) Arc(TM) B580 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
  // Apple silicon on macOS.
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 'apple-silicon'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)', 'apple-silicon'],
  ['Apple M1, or similar', 'apple-silicon'],
  // Firefox buckets that hold integrated GPUs and cards together: the class is not known.
  ['ANGLE (AMD, Radeon R9 200 Series Direct3D11 vs_5_0 ps_5_0), or similar', 'unknown'],
  ['ANGLE (Intel, Intel(R) Arc(TM) A750 Graphics Direct3D11 vs_5_0 ps_5_0), or similar', 'unknown'],
  ['Radeon R9 200 Series, or similar', 'unknown'],
  // No name: Safari, or a lost context.
  ['Apple GPU', 'unknown'],
  ['WebKit WebGL', 'unknown'],
  ['', 'unknown'],
  ['   ', 'unknown'],
];

describe('classifyGpu', () => {
  it.each(cases)('%s -> %s', (renderer, expected) => {
    expect(classifyGpu(renderer)).toBe(expected);
  });
});
