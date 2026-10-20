// The 3D globe: rendering, raise and blur effects, picking and camera framing.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Matrix4,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  DoubleSide,
  type IUniform,
} from 'three';
import { theme } from '../theme';
import type { CountryFeature, CountryId } from '../types';
import { TrackballControls } from './controls';
import { buildGlobeGeometry, lonLatToVec, type BoundingCap, type Range } from './geometry';
import { CountryPicker } from './picker';
import {
  SLOTS,
  blurFragment,
  compositeFragment,
  landFragment,
  landVertex,
  lineFragment,
  lineVertex,
  oceanFragment,
  oceanVertex,
  quadVertex,
} from './shaders';

export interface GlobeOptions {
  container: HTMLElement;
  features: CountryFeature[];
  onHover: (id: CountryId | null, screen: { x: number; y: number } | null) => void; // screen = client px for the tooltip
  onSelect: (id: CountryId | null) => void; // null = click on ocean/space. Fired only for clicks, not drags (<5px movement).
}

const FOV = 30;
const MIN_DIST = 1.1;
const MAX_DIST = 6;
const BASE_RADIUS = 1.002;
const LIFT = 0.033;
const LINE_OFFSET = 0.0006;
const FIT = 0.42; // globe radius as a share of the smaller side of the free rect
const RAISE_MS = 200;
const BLUR_MS = 200;
const FOCUS_MS = 700;
const FRAME_TAU = 110; // ms, smoothing for zoom and inset changes
const IDLE_MS = 4000;
const SPIN = 0.045; // rad/s, idle rotation
const FOCUS_FILL = 0.25; // selected country radius as a share of the smaller side of the free rect
const SMALL_CAP = (0.6 * Math.PI) / 180; // countries smaller than this get a pick tolerance
const PICK_SLOP_PX = 6;
const SLOP_MAX_RADIUS_PX = 10; // small countries larger than this on screen get no slop
const MARKER_PX = 5; // below this projected radius the selected country gets a ring marker

function rgb(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function shade(v: Vector3, k: number): Vector3 {
  return v.clone().multiplyScalar(k);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Slot {
  index: number;
  t: number; // linear progress 0..1
  cap: Vector3;
  wall: Vector3;
  mesh: Mesh;
  lines: LineSegments;
}

interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export class Globe {
  private readonly opts: GlobeOptions;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.02, 40);
  private readonly scene = new Scene();
  private readonly overlay = new Scene();
  private readonly globe = new Group();
  private readonly overlayGlobe = new Group();
  private readonly controls: TrackballControls;
  private readonly picker: CountryPicker;
  private readonly idToIndex = new Map<CountryId, number>();
  private readonly triangleRanges: Range[];
  private readonly lineRanges: Range[];
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly caps: BoundingCap[];
  private readonly capRadius: number[]; // true angular radius per country, rad
  private readonly smallCountries: number[];
  private readonly marker: HTMLDivElement;
  private dpr = 1; // the devicePixelRatio of the last resize

  // Geometry and materials (kept for dispose).
  private readonly landGeometry: BufferGeometry;
  private readonly lineGeometry: BufferGeometry;
  private readonly oceanGeometry = new SphereGeometry(1, 128, 96);
  private readonly landMaterial: ShaderMaterial;
  private readonly lineMaterial: ShaderMaterial;
  private readonly oceanMaterial: ShaderMaterial;
  private readonly depthMaterial = new MeshBasicMaterial({ colorWrite: false });
  private readonly slotUniforms: {
    uSlotIndex: IUniform<number[]>;
    uSlotAmount: IUniform<number[]>;
    uSlotCap: IUniform<Vector3[]>;
    uSlotWall: IUniform<Vector3[]>;
  };
  private readonly slots: Slot[] = [];

  // Post-processing for the blur.
  private readonly rtScene: WebGLRenderTarget;
  private readonly rtA: WebGLRenderTarget;
  private readonly rtB: WebGLRenderTarget;
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quadScene = new Scene();
  private readonly quad: Mesh;
  private readonly blurMaterial: ShaderMaterial;
  private readonly compositeMaterial: ShaderMaterial;

  // Interaction state.
  private hoverIndex = -1;
  private previewIndex = -1;
  private selectedIndex = -1;
  private blurT = 0;
  private pointer: { x: number; y: number } | null = null;
  private pointerMoved = false;
  private lastActivity = performance.now();
  private spin = 0; // 0..1 ramp of the idle rotation
  private focusAnim: { from: Quaternion; to: Quaternion; start: number } | null = null;

  // Framing.
  private width = 1;
  private height = 1;
  private readonly insetsTarget: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private readonly insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private zoomRatio = 1;
  private distance = 3;
  private focusRadius: number | null = null; // angular radius of the focused country; null = user zoom

  private raf = 0;
  private lastFrame = performance.now();
  private needsRender = true;
  private disposed = false;

  private readonly raycaster = new Raycaster();
  private readonly tmpV = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly tmpSphere = new Sphere(new Vector3(), 1);
  private readonly ndc = new Vector2();

  constructor(opts: GlobeOptions) {
    this.opts = opts;
    this.container = opts.container;
    opts.features.forEach((f, i) => this.idToIndex.set(f.id, i));

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = LinearSRGBColorSpace; // shaders write sRGB values as they are
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false;
    const bg = rgb(theme.background);
    this.renderer.setClearColor(new Color().setRGB(bg.x, bg.y, bg.z, LinearSRGBColorSpace), 1);
    this.canvas = this.renderer.domElement;
    Object.assign(this.canvas.style, { display: 'block', width: '100%', height: '100%', touchAction: 'none', cursor: 'grab' });
    this.canvas.tabIndex = -1; // focus target after a panel closes
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Globe. Press / to search for a country.');
    this.container.appendChild(this.canvas);
    this.marker = document.createElement('div');
    this.marker.className = 'globe-marker';
    this.marker.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.marker);

    // Land, walls and borders: one merged geometry.
    const data = buildGlobeGeometry(opts.features);
    this.triangleRanges = data.triangleRanges;
    this.lineRanges = data.lineRanges;
    const position = new BufferAttribute(data.positions, 3);
    const countryIndex = new BufferAttribute(data.countryIndex, 1);
    const kind = new BufferAttribute(data.kind, 1);
    const triIndex = new BufferAttribute(data.triangles, 1);
    const lineIndex = new BufferAttribute(data.lines, 1);
    const makeGeometry = (index: BufferAttribute) => {
      const g = new BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('countryIndex', countryIndex);
      g.setAttribute('kind', kind);
      g.setIndex(index);
      return g;
    };
    this.landGeometry = makeGeometry(triIndex);
    this.lineGeometry = makeGeometry(lineIndex);
    this.picker = new CountryPicker(opts.features, data.caps);
    this.caps = data.caps;
    // geometry.ts pads each cap by 0.001 in cosine; remove the pad for the true size.
    this.capRadius = data.caps.map((c) => (c.cosRadius > 1 ? 0 : Math.acos(Math.min(1, c.cosRadius + 0.001))));
    this.smallCountries = this.capRadius.flatMap((r, i) => (r < SMALL_CAP ? [i] : []));

    this.slotUniforms = {
      uSlotIndex: { value: new Array(SLOTS).fill(-1) },
      uSlotAmount: { value: new Array(SLOTS).fill(0) },
      uSlotCap: { value: Array.from({ length: SLOTS }, () => new Vector3()) },
      uSlotWall: { value: Array.from({ length: SLOTS }, () => new Vector3()) },
    };
    const landShared = {
      ...this.slotUniforms,
      uLand: { value: rgb(theme.land) },
      uWall: { value: rgb(theme.landSide) },
      uBaseRadius: { value: BASE_RADIUS },
      uLift: { value: LIFT },
    };
    this.landMaterial = new ShaderMaterial({
      vertexShader: landVertex,
      fragmentShader: landFragment,
      uniforms: { ...landShared, uOffset: { value: 0 } },
      side: DoubleSide,
    });
    this.lineMaterial = new ShaderMaterial({
      vertexShader: lineVertex,
      fragmentShader: lineFragment,
      uniforms: { ...landShared, uOffset: { value: LINE_OFFSET }, uColor: { value: rgb(theme.border) } },
    });
    this.oceanMaterial = new ShaderMaterial({
      vertexShader: oceanVertex,
      fragmentShader: oceanFragment,
      uniforms: { uColor: { value: rgb(theme.ocean) } },
    });

    const ocean = new Mesh(this.oceanGeometry, this.oceanMaterial);
    const land = new Mesh(this.landGeometry, this.landMaterial);
    const borders = new LineSegments(this.lineGeometry, this.lineMaterial);
    for (const o of [ocean, land, borders]) o.frustumCulled = false;
    this.globe.add(ocean, land, borders);
    this.scene.add(this.globe);

    // Overlay: the active countries drawn sharp over the blurred globe. The ocean writes depth only.
    const depthOcean = new Mesh(this.oceanGeometry, this.depthMaterial);
    depthOcean.renderOrder = -1;
    depthOcean.frustumCulled = false;
    this.overlayGlobe.add(depthOcean);
    this.overlay.add(this.overlayGlobe);
    for (let i = 0; i < SLOTS; i++) {
      const mesh = new Mesh(makeGeometry(triIndex), this.landMaterial);
      const lines = new LineSegments(makeGeometry(lineIndex), this.lineMaterial);
      mesh.frustumCulled = lines.frustumCulled = false;
      mesh.visible = lines.visible = false;
      this.overlayGlobe.add(mesh, lines);
      this.slots.push({ index: -1, t: 0, cap: new Vector3(), wall: new Vector3(), mesh, lines });
    }

    // Blur pipeline.
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
        uPaper: { value: rgb(theme.background) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.blurMaterial);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    // Start with the viewer's own longitude, from the time zone.
    const lon = -new Date().getTimezoneOffset() / 4;
    this.globe.quaternion.copy(this.orientationFor(20, ((lon + 540) % 360) - 180));

    this.controls = new TrackballControls(this.canvas, {
      rotate: (q) => {
        this.focusAnim = null;
        this.globe.quaternion.premultiply(q).normalize();
        this.needsRender = true;
      },
      zoom: (f) => {
        const fit = this.fitDistance();
        // A manual zoom ends the zoom that fits the selected country. Start from where it is.
        if (this.focusRadius !== null) {
          this.zoomRatio = this.targetDistance() / fit;
          this.focusRadius = null;
        }
        this.zoomRatio = Math.min(this.maxDistance(fit) / fit, Math.max(MIN_DIST / fit, this.zoomRatio * f));
        this.needsRender = true;
      },
      tap: (x, y) => {
        const i = this.pickAt(x, y);
        this.opts.onSelect(i >= 0 ? this.opts.features[i].id : null);
      },
      hover: (x, y) => {
        this.pointer = { x, y };
        this.pointerMoved = true;
      },
      leave: () => {
        this.pointer = null;
        this.setHover(-1, null);
      },
      dragStart: () => {
        this.focusAnim = null;
        this.setHover(-1, null);
        this.updateCursor();
      },
      dragEnd: () => this.updateCursor(),
      activity: () => {
        this.lastActivity = performance.now();
      },
      radiansPerPixel: () => (2 * Math.tan((FOV * Math.PI) / 360) * Math.max(0.08, this.distance - 0.97)) / this.height,
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.distance = this.targetDistance();
    this.updateCamera();
    this.raf = requestAnimationFrame(this.frame);
  }

  setSelected(id: CountryId | null): void {
    this.selectedIndex = this.indexOf(id);
    if (this.selectedIndex < 0) this.focusRadius = null;
    this.lastActivity = performance.now();
    this.needsRender = true;
  }

  /** Turns lat/lng to face the camera. With a selected country, also zooms to fit it. */
  focus(latlng: [number, number]): void {
    this.focusRadius = this.selectedIndex >= 0 ? this.capRadius[this.selectedIndex] : null;
    const to = this.orientationFor(latlng[0], latlng[1]);
    this.controls.stopInertia();
    if (this.reducedMotion.matches) {
      this.globe.quaternion.copy(to);
      this.focusAnim = null;
    } else {
      this.focusAnim = { from: this.globe.quaternion.clone(), to, start: performance.now() };
    }
    this.lastActivity = performance.now();
    this.needsRender = true;
  }

  setViewportInsets(insets: { left: number; right: number; top: number; bottom: number }): void {
    Object.assign(this.insetsTarget, insets);
    if (this.reducedMotion.matches) {
      Object.assign(this.insets, insets);
      this.distance = this.targetDistance();
      this.updateCamera();
    }
    this.needsRender = true;
  }

  setPreview(id: CountryId | null): void {
    this.previewIndex = this.indexOf(id);
    this.lastActivity = performance.now();
    this.needsRender = true;
  }

  /** Moves keyboard focus to the canvas without a scroll. */
  focusCanvas(): void {
    this.canvas.focus({ preventScroll: true });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.resizeObserver.disconnect();
    this.marker.remove();
    for (const s of this.slots) {
      s.mesh.geometry.dispose();
      s.lines.geometry.dispose();
    }
    this.landGeometry.dispose();
    this.lineGeometry.dispose();
    this.oceanGeometry.dispose();
    this.quad.geometry.dispose();
    for (const m of [this.landMaterial, this.lineMaterial, this.oceanMaterial, this.depthMaterial, this.blurMaterial, this.compositeMaterial]) m.dispose();
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- frame loop ----

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(50, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    const reduced = this.reducedMotion.matches;
    let moved = false;
    // ResizeObserver misses a DPR change at the same CSS size (window moved to another screen).
    if ((window.devicePixelRatio || 1) !== this.dpr) this.resize();

    if (this.focusAnim) {
      const t = Math.min(1, (now - this.focusAnim.start) / FOCUS_MS);
      this.globe.quaternion.slerpQuaternions(this.focusAnim.from, this.focusAnim.to, easeInOut(t));
      if (t >= 1) this.focusAnim = null;
      moved = true;
    } else if (this.controls.update(dt)) {
      this.globe.quaternion.normalize();
      moved = true;
    }

    // Idle spin about the globe's own axis, with a soft start.
    const active = this.hoverIndex >= 0 || this.previewIndex >= 0 || this.selectedIndex >= 0;
    const canSpin = !reduced && !active && !this.focusAnim && !this.controls.isDragging && now - this.lastActivity > IDLE_MS;
    this.spin = canSpin ? Math.min(1, this.spin + dt / 1500) : 0;
    if (this.spin > 0) {
      this.globe.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.tmpV.set(0, 1, 0), (SPIN * this.spin * dt) / 1000));
      moved = true;
    }
    if (moved) this.needsRender = true;

    // Zoom and inset framing ease toward their targets.
    const k = reduced ? 1 : 1 - Math.exp(-dt / FRAME_TAU);
    let framing = false;
    for (const key of ['left', 'right', 'top', 'bottom'] as const) {
      const d = this.insetsTarget[key] - this.insets[key];
      if (Math.abs(d) > 0.25) {
        this.insets[key] += d * k;
        framing = true;
      } else this.insets[key] = this.insetsTarget[key];
    }
    const dd = this.targetDistance() - this.distance;
    if (Math.abs(dd) > 1e-4) {
      this.distance += dd * k;
      framing = true;
    } else this.distance += dd;
    if (framing) {
      this.updateCamera();
      this.needsRender = true;
    }

    // Hover pick, at most once per frame.
    if (this.pointer && !this.controls.isDragging && (this.pointerMoved || moved || framing)) {
      this.pointerMoved = false;
      this.setHover(this.pickAt(this.pointer.x, this.pointer.y), this.pointer);
    }

    if (this.animateSlots(dt, reduced)) this.needsRender = true;

    if (this.needsRender) {
      this.needsRender = false;
      this.render();
    }
  };

  private animateSlots(dt: number, reduced: boolean): boolean {
    const accent = rgb(theme.accent);
    const want = new Map<number, 'sel' | 'hover'>();
    if (this.selectedIndex >= 0) want.set(this.selectedIndex, 'sel');
    const hover = this.previewIndex >= 0 ? this.previewIndex : this.hoverIndex;
    if (hover >= 0 && !want.has(hover)) want.set(hover, 'hover');

    // Give each wanted country a slot: its own, a free one, or the lowest fading one.
    for (const [index] of want) {
      if (this.slots.some((s) => s.index === index)) continue;
      const free = this.slots
        .filter((s) => !want.has(s.index))
        .sort((a, b) => (a.index < 0 ? -1 : b.index < 0 ? 1 : a.t - b.t))[0];
      if (free) {
        free.index = index;
        free.t = 0;
      }
    }

    let changed = false;
    const step = reduced ? 1 : dt / RAISE_MS;
    this.slots.forEach((s, i) => {
      if (s.index < 0) return;
      const kind = want.get(s.index);
      if (kind === 'sel') {
        s.cap.copy(accent);
        s.wall.copy(shade(accent, 0.8));
      } else if (kind === 'hover') {
        s.cap.copy(rgb(theme.hover));
        s.wall.copy(rgb(theme.landSide));
      }
      const target = kind ? 1 : 0;
      if (s.t !== target) {
        s.t = target > s.t ? Math.min(1, s.t + step) : Math.max(0, s.t - step);
        changed = true;
      }
      if (s.t === 0 && !kind) s.index = -1;
      this.slotUniforms.uSlotIndex.value[i] = s.index;
      this.slotUniforms.uSlotAmount.value[i] = s.index < 0 ? 0 : easeInOut(s.t);
      this.slotUniforms.uSlotCap.value[i].copy(s.cap);
      this.slotUniforms.uSlotWall.value[i].copy(s.wall);
    });

    const blurTarget = want.size ? 1 : 0;
    if (this.blurT !== blurTarget) {
      const b = reduced ? 1 : dt / BLUR_MS;
      this.blurT = blurTarget > this.blurT ? Math.min(1, this.blurT + b) : Math.max(0, this.blurT - b);
      changed = true;
    }
    return changed;
  }

  // ---- rendering ----

  private render(): void {
    this.updateMarker();
    const r = this.renderer;
    const amount = easeInOut(this.blurT);
    this.overlayGlobe.quaternion.copy(this.globe.quaternion);

    if (amount < 0.002) {
      r.setRenderTarget(null);
      r.clear();
      r.render(this.scene, this.camera);
      return;
    }

    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(this.scene, this.camera);

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
    r.clear();
    r.render(this.quadScene, this.quadCamera);

    // Active countries, sharp, hidden behind the ocean sphere where they turn away.
    r.clearDepth();
    this.slots.forEach((s) => {
      const on = s.index >= 0 && s.t > 0;
      s.mesh.visible = s.lines.visible = on;
      if (!on) return;
      const tr = this.triangleRanges[s.index];
      const lr = this.lineRanges[s.index];
      s.mesh.geometry.setDrawRange(tr.start, tr.count);
      s.lines.geometry.setDrawRange(lr.start, lr.count);
    });
    r.render(this.overlay, this.camera);
  }

  /** Approximate screen radius, in CSS px, of a cap of angular radius r centred at unit vector p (view space). */
  private projectedRadius(r: number, p: Vector3): number {
    const range = Math.hypot(p.x, p.y, this.camera.position.z - p.z);
    return (Math.sin(r) / range / Math.tan((FOV * Math.PI) / 360)) * (this.height / 2);
  }

  /** A ring around a selected country too small to see at the current zoom. */
  private updateMarker(): void {
    const i = this.selectedIndex;
    let show = false;
    if (i >= 0) {
      const cap = this.caps[i];
      const p = this.tmpV.set(cap.x, cap.y, cap.z).applyQuaternion(this.globe.quaternion);
      const camZ = this.camera.position.z;
      // On the near side when the point is in front of the horizon plane.
      if (p.z > 1 / camZ) {
        if (this.projectedRadius(this.capRadius[i], p) < MARKER_PX) {
          p.multiplyScalar(BASE_RADIUS + LIFT).project(this.camera);
          const x = ((p.x + 1) / 2) * this.width;
          const y = ((1 - p.y) / 2) * this.height;
          this.marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
          show = true;
        }
      }
    }
    this.marker.toggleAttribute('data-visible', show);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.width = w;
    this.height = h;
    this.dpr = window.devicePixelRatio || 1;
    const dpr = Math.min(this.dpr, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.rtScene.setSize(Math.round(w * dpr), Math.round(h * dpr));
    // Blur buffers at half of CSS size: the blur radius stays the same on any screen.
    this.rtA.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.rtB.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.updateCamera();
    this.needsRender = true;
    this.render(); // avoid one blank frame after the canvas resizes
  }

  // ---- framing ----

  private freeRect() {
    const { left, right, top, bottom } = this.insets;
    const w = Math.max(1, this.width - left - right);
    const h = Math.max(1, this.height - top - bottom);
    return { w, h, cx: left + w / 2, cy: top + h / 2 };
  }

  /** Camera distance that fits the globe in the free rect, for the current insets. */
  private fitDistance(): number {
    const { w, h } = this.freeRect();
    const radiusPx = FIT * Math.min(w, h);
    const k = (radiusPx * Math.tan((FOV * Math.PI) / 360)) / (this.height / 2);
    return 1 / Math.sin(Math.atan(k));
  }

  /** Tall, narrow screens need the camera further away than MAX_DIST to fit the globe. */
  private maxDistance(fit: number): number {
    return Math.max(MAX_DIST, fit * 1.6);
  }

  private targetDistance(): number {
    const fit = this.fitDistance();
    // A focused country fills about half the free rect. Never zoom out past the default fit.
    const want = this.focusRadius !== null ? Math.min(fit, this.distanceToFit(this.focusRadius)) : fit * this.zoomRatio;
    return Math.min(this.maxDistance(fit), Math.max(MIN_DIST, want));
  }

  /** Camera distance at which a cap of angular radius r has a radius of FOCUS_FILL of the free rect. */
  private distanceToFit(r: number): number {
    const { w, h } = this.freeRect();
    const targetPx = FOCUS_FILL * Math.min(w, h);
    return Math.cos(r) + (Math.sin(r) * (this.height / 2)) / (Math.tan((FOV * Math.PI) / 360) * targetPx);
  }

  private updateCamera(): void {
    const { cx, cy } = this.freeRect();
    const c = this.camera;
    c.aspect = this.width / this.height;
    // Shift the view so the globe centre lands in the middle of the free rect.
    c.setViewOffset(this.width, this.height, this.width / 2 - cx, this.height / 2 - cy, this.width, this.height);
    c.position.set(0, 0, this.distance);
    c.lookAt(0, 0, 0);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }

  /** Globe orientation that puts lat/lng in front of the camera with north up. */
  private orientationFor(lat: number, lng: number): Quaternion {
    const p = new Vector3(...lonLatToVec(lng, lat));
    const l = (lng * Math.PI) / 180;
    const east = new Vector3(Math.cos(l), 0, -Math.sin(l));
    const north = new Vector3().crossVectors(p, east);
    const m = new Matrix4().makeBasis(east, north, p);
    return new Quaternion().setFromRotationMatrix(m).invert();
  }

  // ---- picking ----

  private pickAt(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const ray = this.raycaster.ray;
    const inv = this.tmpQ.copy(this.globe.quaternion).invert();

    const at = (radius: number): number => {
      this.tmpSphere.radius = radius;
      if (!ray.intersectSphere(this.tmpSphere, this.tmpV)) return -2;
      const v = this.tmpV.normalize().applyQuaternion(inv);
      const lon = (Math.atan2(v.x, v.z) * 180) / Math.PI;
      const lat = (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI;
      return this.picker.pick(lon, lat);
    };

    // A raised country sits above the surface: test its cap first.
    const amounts = this.slotUniforms.uSlotAmount.value;
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i];
      if (s.index < 0 || amounts[i] < 0.05) continue;
      if (at(BASE_RADIUS + amounts[i] * LIFT) !== s.index) continue;
      if (this.capRadius[s.index] < SMALL_CAP) return s.index;
      const near = this.nearSmallCountry(clientX - rect.left, clientY - rect.top);
      return near >= 0 ? near : s.index;
    }
    const hit = at(BASE_RADIUS);
    if (hit >= 0 && this.capRadius[hit] < SMALL_CAP) return hit;
    // Micro-states (Vatican, Monaco) are a few px wide: accept a near miss.
    const near = this.nearSmallCountry(clientX - rect.left, clientY - rect.top);
    if (near >= 0) return near;
    return hit < 0 ? -1 : hit;
  }

  /** The small country whose projected bounding cap is nearest the point and within PICK_SLOP_PX, or -1. */
  private nearSmallCountry(x: number, y: number): number {
    let best = -1;
    let bestD = PICK_SLOP_PX;
    const camZ = this.camera.position.z;
    const v = new Vector3();
    for (const i of this.smallCountries) {
      const cap = this.caps[i];
      v.set(cap.x, cap.y, cap.z).applyQuaternion(this.globe.quaternion);
      if (v.z <= 1 / camZ) continue;
      const radiusPx = this.projectedRadius(this.capRadius[i], v);
      // Once a country is big on screen the exact pick is enough; its cap also covers neighbours.
      if (radiusPx > SLOP_MAX_RADIUS_PX) continue;
      v.multiplyScalar(BASE_RADIUS).project(this.camera);
      const d = Math.hypot(((v.x + 1) / 2) * this.width - x, ((1 - v.y) / 2) * this.height - y) - radiusPx;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private setHover(index: number, screen: { x: number; y: number } | null): void {
    const changed = index !== this.hoverIndex;
    this.hoverIndex = index;
    if (changed || index >= 0) {
      this.opts.onHover(index >= 0 ? this.opts.features[index].id : null, index >= 0 && screen ? { x: screen.x, y: screen.y } : null);
    }
    if (changed) {
      this.needsRender = true;
      this.updateCursor();
    }
  }

  private updateCursor(): void {
    this.canvas.style.cursor = this.controls.isDragging ? 'grabbing' : this.hoverIndex >= 0 ? 'pointer' : 'grab';
  }

  private indexOf(id: CountryId | null): number {
    return id == null ? -1 : (this.idToIndex.get(id) ?? -1);
  }
}
