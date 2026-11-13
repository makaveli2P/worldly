// The blur of the world while a country is active: the scene goes to a target, a separable blur runs at
// half of CSS size, and the composite mixes the sharp and the blurred colour with the recede and desaturate
// of the palette. Alpha in the scene target is coverage, so the paper round the world stays sharp.
// Each view draws its sharp overlay after render().

import {
  Color,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { GlobePalette } from '../theme';
import { rgb } from './constants';
import { blurFragment, compositeFragment, quadVertex } from './shaders';

export class BlurPass {
  private readonly rtScene: WebGLRenderTarget;
  private readonly rtA: WebGLRenderTarget;
  private readonly rtB: WebGLRenderTarget;
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadScene = new Scene();
  private readonly quad: Mesh;
  private readonly blurMaterial: ShaderMaterial;
  private readonly compositeMaterial: ShaderMaterial;

  constructor() {
    // Mipmaps on the scene target give the blur a clean downsample.
    this.rtScene = new WebGLRenderTarget(1, 1, { samples: 4, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    this.rtA = new WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.rtB = new WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.blurMaterial = new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: blurFragment,
      uniforms: { tInput: { value: null }, uStep: { value: new Vector2() }, uLod: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    });
    this.compositeMaterial = new ShaderMaterial({
      vertexShader: quadVertex,
      fragmentShader: compositeFragment,
      uniforms: {
        tSharp: { value: this.rtScene.texture },
        tBlur: { value: this.rtB.texture },
        uAmount: { value: 0 },
        uPaper: { value: new Vector3() },
        uRecede: { value: new Vector3() },
        uRecedeAmount: { value: 0 },
        uDesaturate: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.blurMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** w, h in CSS px. dpr is the pixel ratio of the renderer. */
  resize(w: number, h: number, dpr: number): void {
    this.rtScene.setSize(Math.round(w * dpr), Math.round(h * dpr));
    // Blur buffers at half of CSS size: the blur radius stays the same on any screen.
    this.rtA.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.rtB.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
  }

  setPalette(p: GlobePalette): void {
    const c = this.compositeMaterial.uniforms;
    c.uPaper.value.copy(rgb(p.paper));
    c.uRecede.value.copy(rgb(p.recede));
    c.uRecedeAmount.value = p.recedeAmount;
    c.uDesaturate.value = p.desaturate;
  }

  /**
   * Draws the scene (drawScene renders into the current target), blurs it, and composites it to the
   * screen over the paper. amount is the eased blur, 0..1.
   */
  render(r: WebGLRenderer, drawScene: () => void, amount: number, clearColor: Color): void {
    // Transparent black: the composite reads alpha as "this pixel is globe".
    r.setRenderTarget(this.rtScene);
    r.setClearColor(clearColor, 0);
    r.clear();
    drawScene();

    // Separable blur at half resolution.
    const w = this.rtA.width;
    const h = this.rtA.height;
    this.quad.material = this.blurMaterial;
    const u = this.blurMaterial.uniforms;
    {
      u.tInput.value = this.rtScene.texture;
      u.uLod.value = Math.log2(Math.max(1, this.rtScene.width / w));
      u.uStep.value.set(1 / w, 0);
      r.setRenderTarget(this.rtA);
      r.render(this.quadScene, this.quadCamera);
      u.tInput.value = this.rtA.texture;
      u.uLod.value = 0;
      u.uStep.value.set(0, 1 / h);
      r.setRenderTarget(this.rtB);
      r.render(this.quadScene, this.quadCamera);
    }

    this.quad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.uAmount.value = amount;
    r.setRenderTarget(null);
    r.setClearColor(clearColor, 1);
    r.clear();
    r.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.quad.geometry.dispose();
    this.blurMaterial.dispose();
    this.compositeMaterial.dispose();
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.dispose();
  }
}
