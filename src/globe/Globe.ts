// The 3D globe: rendering, raise and blur effects, picking and camera framing.
// Two map styles (satellite, atlas) and two themes (light, dark); colours come from src/theme.ts.

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
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  DoubleSide,
  type IUniform,
  type Texture,
} from 'three';
import { geoArea, geoCentroid } from 'd3-geo';
import type { Polygon } from 'geojson';
import { globePalettes, systemTheme, type GlobePalette, type MapStyle, type ThemeName } from '../theme';
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
  limbVertex,
  lineVertex,
  oceanFragment,
  oceanVertex,
  plainLineFragment,
  plainLineVertex,
  quadVertex,
} from './shaders';

export type { MapStyle, ThemeName } from '../theme';

export interface GlobeOptions {
  container: HTMLElement;
  features: CountryFeature[];
  onHover: (id: CountryId | null, screen: { x: number; y: number } | null) => void; // screen = client px for the tooltip
  onSelect: (id: CountryId | null) => void; // null = click on ocean/space. Fired only for clicks, not drags (<5px movement).
  mapStyle?: MapStyle; // default 'satellite'
  theme?: ThemeName; // default: prefers-color-scheme
}

export interface ProjectedPoint {
  x: number; // client px
  y: number;
  visible: boolean;
  facing: number; // dot(surface normal, direction to camera), -1..1; near 0 at the limb
}

export interface GlobeView {
  lat: number;
  lng: number;
  altitudeKm: number;
  distance: number; // camera distance from the globe centre, in earth radii
}

const TEXTURE_URL = '/textures/earth-4k.jpg';
const EARTH_KM = 6371;
const FOV = 30;
const MIN_DIST = 1.3; // ~1900 km: closer than this the 4k texture turns to mush
const MAX_DIST = 6;
const BASE_RADIUS = 1.002;
const LIFT = 0.033;
const LINE_OFFSET = 0.0006;
const GRATICULE_RADIUS = 1.0008;
const FIT = 0.42; // globe radius as a share of the smaller side of the free rect
const RAISE_MS = 200;
const BLUR_MS = 200;
const FOCUS_MS = 700;
const TEXTURE_FADE_MS = 400;
const FRAME_TAU = 110; // ms, smoothing for zoom and inset changes
const IDLE_MS = 1500;
const SPIN = 0.1; // rad/s, idle rotation (about 6°/s)
const FOCUS_FILL = 0.25; // selected country radius as a share of the smaller side of the free rect
const SMALL_CAP = (0.6 * Math.PI) / 180; // countries smaller than this get a pick tolerance
const PICK_SLOP_PX = 6;
const SLOP_MAX_RADIUS_PX = 10; // small countries larger than this on screen get no slop
const MARKER_PX = 5; // below this projected radius the selected country gets a ring marker
const OUTLINE_PX = 0.45; // CSS px offset of the extra passes that make active outlines about 2px wide
const NUDGES: [number, number][] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function rgb(hex: string): Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface Slot {
  index: number;
  t: number; // linear progress 0..1
  kind: 'sel' | 'hover' | null;
  mesh: Mesh;
  lines: LineSegments[];
}

interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface LabelData {
  lat: number;
  lng: number;
  radius: number; // angular radius (rad) of a disc with the area of the main polygon
  ring: number[][] | null; // outer ring [lng, lat] of the main polygon
}

function limbGeometry(segments = 256): BufferGeometry {
  const pos: number[] = [];
  const side: number[] = [];
  const index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), 0, Math.cos(a), Math.sin(a), 0);
    side.push(0, 1);
    if (i < segments) {
      const k = i * 2;
      index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('side', new BufferAttribute(new Float32Array(side), 1));
  g.setIndex(index);
  return g;
}

function graticuleGeometry(r: number): BufferGeometry {
  const pts: number[] = [];
  const v = [0, 0, 0];
  const push = (lon: number, lat: number) => {
    lonLatToVec(lon, lat, v);
    pts.push(v[0] * r, v[1] * r, v[2] * r);
  };
  for (let lon = -180; lon < 180; lon += 15)
    for (let lat = -75; lat < 75; lat += 2) {
      push(lon, lat);
      push(lon, Math.min(75, lat + 2));
    }
  for (let lat = -75; lat <= 75; lat += 15)
    for (let lon = -180; lon < 180; lon += 2) {
      push(lon, lat);
      push(lon + 2, lat);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return g;
}

export class Globe {
  /** Height of a raised country, in earth radii. project(lat, lng, Globe.RAISE) hits the top of a raised cap. */
  static readonly RAISE = LIFT;

  private readonly opts: GlobeOptions;
  private readonly container: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.02, 40);
  private readonly scene = new Scene();
  private readonly overlay = new Scene();
  private readonly limbScene = new Scene(); // drawn last, sharp, also over the blur
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
  private readonly labels: (LabelData | undefined)[] = [];
  private readonly marker: HTMLDivElement;
  private dpr = 1; // the devicePixelRatio of the last resize

  // Style.
  private mapStyle: MapStyle;
  private themeName: ThemeName;
  private palette: GlobePalette;
  private texture: Texture | null = null;
  private textureState: 'none' | 'loading' | 'ready' = 'none';
  private texMix = 0; // 0..1 fade-in of the satellite texture

  // Geometry and materials (kept for dispose).
  private readonly landGeometry: BufferGeometry;
  private readonly lineGeometry: BufferGeometry;
  private readonly oceanGeometry = new SphereGeometry(1, 160, 120);
  private readonly graticuleGeometry = graticuleGeometry(GRATICULE_RADIUS);
  private readonly limbGeometry = limbGeometry();
  private readonly landMaterial: ShaderMaterial;
  private readonly lineMaterial: ShaderMaterial;
  private readonly outlineMaterials: ShaderMaterial[];
  private readonly oceanMaterial: ShaderMaterial;
  private readonly graticuleMaterial: ShaderMaterial;
  private readonly limbMaterial: ShaderMaterial;
  private readonly depthMaterial = new MeshBasicMaterial({ colorWrite: false });
  private readonly slotUniforms: {
    uSlotIndex: IUniform<number[]>;
    uSlotAmount: IUniform<number[]>;
    uSlotCap: IUniform<Vector3[]>;
    uSlotWall: IUniform<Vector3[]>;
    uSlotLine: IUniform<Vector3[]>;
  };
  private readonly styleUniforms: {
    tMap: IUniform<Texture | null>;
    uTex: IUniform<number>;
    uSatellite: IUniform<number>;
    uLand: IUniform<Vector3>;
    uWall: IUniform<Vector3>;
    uColor: IUniform<Vector3>; // border colour
    uAlpha: IUniform<number>; // border alpha
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
  private lastActivity = -Infinity; // spin from the first frame
  private spin = 0; // 0..1 ramp of the idle rotation
  private focusAnim: { from: Quaternion; to: Quaternion; start: number } | null = null;

  // Framing.
  private width = 1;
  private height = 1;
  private canvasRect = new DOMRect();
  private readonly insetsTarget: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private readonly insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private zoomRatio = 1;
  private distance = 3;
  private focusRadius: number | null = null; // angular radius of the focused country; null = user zoom

  private raf = 0;
  private lastFrame = performance.now();
  private needsRender = true;
  private disposed = false;
  private readonly frameListeners = new Set<() => void>();

  private readonly raycaster = new Raycaster();
  private readonly tmpV = new Vector3();
  private readonly tmpP = new Vector3();
  private readonly tmpQ = new Quaternion();
  private readonly tmpSphere = new Sphere(new Vector3(), 1);
  private readonly ndc = new Vector2();
  private readonly clearColor = new Color();

  constructor(opts: GlobeOptions) {
    this.opts = opts;
    this.container = opts.container;
    this.mapStyle = opts.mapStyle ?? 'satellite';
    this.themeName = opts.theme ?? systemTheme();
    this.palette = globePalettes[this.themeName][this.mapStyle];
    opts.features.forEach((f, i) => this.idToIndex.set(f.id, i));

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = LinearSRGBColorSpace; // shaders write sRGB values as they are
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.autoClear = false;
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
      uSlotLine: { value: Array.from({ length: SLOTS }, () => new Vector3()) },
    };
    this.styleUniforms = {
      tMap: { value: null },
      uTex: { value: 0 },
      uSatellite: { value: 0 },
      uLand: { value: new Vector3() },
      uWall: { value: new Vector3() },
      uColor: { value: new Vector3() },
      uAlpha: { value: 1 },
    };
    const landShared = {
      ...this.slotUniforms,
      ...this.styleUniforms,
      uBaseRadius: { value: BASE_RADIUS },
      uLift: { value: LIFT },
    };
    this.landMaterial = new ShaderMaterial({
      vertexShader: landVertex,
      fragmentShader: landFragment,
      uniforms: { ...landShared, uOffset: { value: 0 } },
      side: DoubleSide,
    });
    const lineOffset = { value: LINE_OFFSET };
    const makeLineMaterial = () =>
      new ShaderMaterial({
        vertexShader: lineVertex,
        fragmentShader: lineFragment,
        uniforms: { ...landShared, uOffset: lineOffset, uNudge: { value: new Vector2() } },
        transparent: true,
        depthWrite: false,
      });
    this.lineMaterial = makeLineMaterial();
    // Active countries get their outline drawn five times, a fraction of a pixel apart.
    this.outlineMaterials = NUDGES.map(() => makeLineMaterial());
    this.oceanMaterial = new ShaderMaterial({
      vertexShader: oceanVertex,
      fragmentShader: oceanFragment,
      uniforms: {
        tMap: this.styleUniforms.tMap,
        uTex: { value: 0 },
        uColor: { value: new Vector3() },
      },
    });
    this.graticuleMaterial = new ShaderMaterial({
      vertexShader: plainLineVertex,
      fragmentShader: plainLineFragment,
      uniforms: { uColor: { value: new Vector3() }, uAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });

    this.limbMaterial = new ShaderMaterial({
      vertexShader: limbVertex,
      fragmentShader: plainLineFragment,
      uniforms: {
        uColor: { value: new Vector3() },
        uAlpha: { value: 0 },
        uRadius: { value: 1 },
        uWidth: { value: 0.001 },
        uZ: { value: 0 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const limb = new Mesh(this.limbGeometry, this.limbMaterial);
    limb.frustumCulled = false;
    limb.renderOrder = 10;
    this.limbScene.add(limb);

    const ocean = new Mesh(this.oceanGeometry, this.oceanMaterial);
    const land = new Mesh(this.landGeometry, this.landMaterial);
    const graticule = new LineSegments(this.graticuleGeometry, this.graticuleMaterial);
    const borders = new LineSegments(this.lineGeometry, this.lineMaterial);
    for (const o of [ocean, land, graticule, borders]) o.frustumCulled = false;
    graticule.renderOrder = 1;
    borders.renderOrder = 2;
    this.globe.add(ocean, land, graticule, borders);
    this.scene.add(this.globe);

    // Overlay: the active countries drawn sharp over the blurred globe. The ocean writes depth only.
    const depthOcean = new Mesh(this.oceanGeometry, this.depthMaterial);
    depthOcean.renderOrder = -1;
    depthOcean.frustumCulled = false;
    this.overlayGlobe.add(depthOcean);
    this.overlay.add(this.overlayGlobe);
    for (let i = 0; i < SLOTS; i++) {
      const mesh = new Mesh(makeGeometry(triIndex), this.landMaterial);
      const lineGeo = makeGeometry(lineIndex);
      const lines = this.outlineMaterials.map((m) => new LineSegments(lineGeo, m));
      for (const o of [mesh, ...lines]) {
        o.frustumCulled = false;
        o.visible = false;
      }
      lines.forEach((l) => (l.renderOrder = 2));
      this.overlayGlobe.add(mesh, ...lines);
      this.slots.push({ index: -1, t: 0, kind: null, mesh, lines });
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

    this.applyPalette();

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
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
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
    // Fit the main polygon, not the whole feature: overseas territories must not stop the zoom.
    this.focusRadius = this.selectedIndex >= 0 ? this.mainRadius(this.selectedIndex, latlng) : null;
    const to = this.orientationFor(latlng[0], latlng[1]);
    this.controls.stopInertia();
    if (this.reducedMotion.matches) {
      this.globe.quaternion.copy(to);
      this.focusAnim = null;
      this.pointerMoved = true; // the jump does not count as a move: pick the hover again
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
      this.pointerMoved = true;
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

  /** Satellite loads the texture on first use; until it arrives the ocean shows a plain fill. */
  setMapStyle(style: MapStyle): void {
    if (style === this.mapStyle) return;
    this.mapStyle = style;
    this.applyPalette();
  }

  getMapStyle(): MapStyle {
    return this.mapStyle;
  }

  setTheme(theme: ThemeName): void {
    if (theme === this.themeName) return;
    this.themeName = theme;
    this.applyPalette();
  }

  getTheme(): ThemeName {
    return this.themeName;
  }

  /**
   * Projects lat/lng at radius 1 + lift (earth radii; Globe.RAISE = top of a raised country) to client px.
   * visible = facing > 0: the point is on the near side of the globe.
   */
  project(lat: number, lng: number, lift = 0): ProjectedPoint {
    const p = this.tmpP;
    const a = lonLatToVec(lng, lat, this.vecScratch);
    p.set(a[0], a[1], a[2]).applyQuaternion(this.globe.quaternion);
    const r = BASE_RADIUS + lift;
    // facing = n · normalize(cam - p·r); the camera sits on +z at this.distance.
    const cz = this.camera.position.z;
    const tx = -p.x * r;
    const ty = -p.y * r;
    const tz = cz - p.z * r;
    const facing = (p.x * tx + p.y * ty + p.z * tz) / Math.hypot(tx, ty, tz);
    p.multiplyScalar(r).project(this.camera);
    const rect = this.canvasRect;
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
      visible: facing > 0,
      facing,
    };
  }

  /** Calls cb after each rendered frame (the camera, globe or style changed). Returns the unsubscribe. */
  onFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => {
      this.frameListeners.delete(cb);
    };
  }

  /** The point at the centre of the view, and the camera height above the surface. */
  getView(): GlobeView {
    const v = this.tmpV.set(0, 0, 1).applyQuaternion(this.tmpQ.copy(this.globe.quaternion).invert());
    return {
      lat: (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI,
      lng: (Math.atan2(v.x, v.z) * 180) / Math.PI,
      altitudeKm: Math.max(0, this.distance - 1) * EARTH_KM,
      distance: this.distance,
    };
  }

  /** The canvas rect in client px (cached; refreshed on resize, scroll and each rendered frame). */
  rect(): DOMRect {
    return this.canvasRect;
  }

  /** Label point of the selected country, where the leader lines start. Null with no selection. */
  selectedAnchor(): [number, number] | null {
    return this.selectedIndex >= 0 ? this.labelOf(this.selectedIndex).latlng : null;
  }

  /** Current raise of the selected country in earth radii (0..Globe.RAISE), for project(). */
  selectedLift(): number {
    const i = this.slots.findIndex((s) => s.index === this.selectedIndex && s.index >= 0);
    return i < 0 ? 0 : this.slotUniforms.uSlotAmount.value[i] * LIFT;
  }

  /** Label point [lat, lng] of a country: the centroid of its largest polygon, kept inside the shape. */
  labelPoint(id: CountryId): [number, number] | null {
    const i = this.indexOf(id);
    return i < 0 ? null : this.labelOf(i).latlng;
  }

  /** Approximate on-screen radius in CSS px of the country's main polygon at its label point. 0 on the far side. */
  screenRadius(id: CountryId): number {
    const i = this.indexOf(id);
    if (i < 0) return 0;
    const l = this.labelOf(i);
    const a = lonLatToVec(l.latlng[1], l.latlng[0], this.vecScratch);
    const p = this.tmpV.set(a[0], a[1], a[2]).applyQuaternion(this.globe.quaternion);
    if (p.z <= 1 / this.camera.position.z) return 0;
    return this.projectedRadius(l.radius, p);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.resizeObserver.disconnect();
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    this.frameListeners.clear();
    this.marker.remove();
    for (const s of this.slots) {
      s.mesh.geometry.dispose();
      s.lines[0].geometry.dispose();
    }
    this.landGeometry.dispose();
    this.lineGeometry.dispose();
    this.oceanGeometry.dispose();
    this.graticuleGeometry.dispose();
    this.limbGeometry.dispose();
    this.quad.geometry.dispose();
    for (const m of [
      this.landMaterial,
      this.lineMaterial,
      ...this.outlineMaterials,
      this.oceanMaterial,
      this.graticuleMaterial,
      this.limbMaterial,
      this.depthMaterial,
      this.blurMaterial,
      this.compositeMaterial,
    ])
      m.dispose();
    for (const rt of [this.rtScene, this.rtA, this.rtB]) rt.dispose();
    this.texture?.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- style ----

  private readonly vecScratch = [0, 0, 0];

  private applyPalette(): void {
    const p = globePalettes[this.themeName][this.mapStyle];
    this.palette = p;
    const sat = this.mapStyle === 'satellite';
    if (sat && this.textureState === 'none') this.loadTexture();
    const s = this.styleUniforms;
    s.uSatellite.value = sat ? 1 : 0;
    s.uLand.value.copy(rgb(p.land));
    s.uWall.value.copy(rgb(p.hoverWall));
    s.uColor.value.copy(rgb(p.border));
    s.uAlpha.value = p.borderAlpha;
    const o = this.oceanMaterial.uniforms;
    o.uColor.value.copy(rgb(p.ocean));
    const l = this.limbMaterial.uniforms;
    l.uColor.value.copy(rgb(p.limb));
    l.uAlpha.value = p.limbAlpha;
    this.compositeMaterial.uniforms.uPaper.value.copy(rgb(p.paper));
    const g = this.graticuleMaterial.uniforms;
    g.uColor.value.copy(rgb(p.graticule));
    g.uAlpha.value = p.graticuleAlpha;
    const c = this.compositeMaterial.uniforms;
    c.uRecede.value.copy(rgb(p.recede));
    c.uRecedeAmount.value = p.recedeAmount;
    c.uDesaturate.value = p.desaturate;
    const bg = rgb(p.paper);
    this.clearColor.setRGB(bg.x, bg.y, bg.z, LinearSRGBColorSpace);
    this.updateTextureUniforms();
    this.needsRender = true;
  }

  private updateTextureUniforms(): void {
    const t = this.mapStyle === 'satellite' ? easeInOut(this.texMix) : 0;
    this.oceanMaterial.uniforms.uTex.value = t;
    this.styleUniforms.uTex.value = t;
  }

  private loadTexture(): void {
    this.textureState = 'loading';
    new TextureLoader().load(
      TEXTURE_URL,
      (tex) => {
        if (this.disposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = NoColorSpace; // raw sRGB values, like every other colour here
        tex.wrapS = RepeatWrapping;
        tex.minFilter = LinearMipmapLinearFilter;
        tex.generateMipmaps = true;
        tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
        this.renderer.initTexture(tex);
        this.texture = tex;
        this.styleUniforms.tMap.value = tex;
        this.textureState = 'ready';
        if (this.reducedMotion.matches) this.texMix = 1;
        this.updateTextureUniforms();
        this.needsRender = true;
      },
      undefined,
      (err) => {
        console.warn('[worldly] satellite texture failed', err);
        this.textureState = 'none';
      },
    );
  }

  // ---- frame loop ----

  private readonly onScroll = () => {
    this.canvasRect = this.canvas.getBoundingClientRect();
    this.needsRender = true;
  };

  private readonly frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(50, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    const reduced = this.reducedMotion.matches;
    let moved = false;
    // ResizeObserver misses a DPR change at the same CSS size (window moved to another screen).
    if ((window.devicePixelRatio || 1) !== this.dpr) this.resize();

    if (this.textureState === 'ready' && this.texMix < 1) {
      this.texMix = reduced ? 1 : Math.min(1, this.texMix + dt / TEXTURE_FADE_MS);
      this.updateTextureUniforms();
      this.needsRender = true;
    }

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
    const p = this.palette;
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
    const u = this.slotUniforms;
    this.slots.forEach((s, i) => {
      if (s.index < 0) return;
      const kind = want.get(s.index);
      if (kind) s.kind = kind; // a fading slot keeps the colours it had
      if (s.kind === 'sel') {
        u.uSlotCap.value[i].copy(rgb(p.selectedCap));
        u.uSlotWall.value[i].copy(rgb(p.selectedWall));
        u.uSlotLine.value[i].copy(rgb(p.selectedLine));
      } else if (s.kind === 'hover') {
        u.uSlotCap.value[i].copy(rgb(p.hoverCap));
        u.uSlotWall.value[i].copy(rgb(p.hoverWall));
        u.uSlotLine.value[i].copy(rgb(p.hoverLine));
      }
      const target = kind ? 1 : 0;
      if (s.t !== target) {
        s.t = target > s.t ? Math.min(1, s.t + step) : Math.max(0, s.t - step);
        changed = true;
      }
      if (s.t === 0 && !kind) {
        s.index = -1;
        s.kind = null;
      }
      u.uSlotIndex.value[i] = s.index;
      u.uSlotAmount.value[i] = s.index < 0 ? 0 : easeInOut(s.t);
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
    this.canvasRect = this.canvas.getBoundingClientRect();
    this.updateMarker();
    this.draw();
    for (const cb of this.frameListeners) {
      try {
        cb();
      } catch (err) {
        console.error('[worldly] frame listener failed', err);
      }
    }
  }

  private draw(): void {
    const r = this.renderer;
    const amount = easeInOut(this.blurT);
    this.overlayGlobe.quaternion.copy(this.globe.quaternion);

    if (amount < 0.002) {
      r.setRenderTarget(null);
      r.setClearColor(this.clearColor, 1);
      r.clear();
      r.render(this.scene, this.camera);
      r.render(this.limbScene, this.camera);
      return;
    }

    // Transparent black: the composite reads alpha as "this pixel is globe".
    r.setRenderTarget(this.rtScene);
    r.setClearColor(this.clearColor, 0);
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
    r.setClearColor(this.clearColor, 1);
    r.clear();
    r.render(this.quadScene, this.quadCamera);

    // Active countries, sharp, hidden behind the ocean sphere where they turn away.
    r.clearDepth();
    this.slots.forEach((s) => {
      const on = s.index >= 0 && s.t > 0;
      s.mesh.visible = on;
      for (const l of s.lines) l.visible = on;
      if (!on) return;
      const tr = this.triangleRanges[s.index];
      const lr = this.lineRanges[s.index];
      s.mesh.geometry.setDrawRange(tr.start, tr.count);
      s.lines[0].geometry.setDrawRange(lr.start, lr.count);
    });
    r.render(this.overlay, this.camera);
    r.render(this.limbScene, this.camera);
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
    // Outline passes: offsets in NDC for OUTLINE_PX CSS pixels.
    this.outlineMaterials.forEach((m, i) => {
      const [nx, ny] = NUDGES[i];
      (m.uniforms.uNudge.value as Vector2).set((nx * 2 * OUTLINE_PX) / w, (ny * 2 * OUTLINE_PX) / h);
    });
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
    // The silhouette of the unit sphere: a circle at z = 1/d with radius sqrt(1 - 1/d²), 1 CSS px wide.
    const d = this.distance;
    const l = this.limbMaterial.uniforms;
    l.uZ.value = 1 / d;
    l.uRadius.value = Math.sqrt(Math.max(0, 1 - 1 / (d * d)));
    l.uWidth.value = (2 * Math.tan((FOV * Math.PI) / 360) * (d - 1 / d)) / this.height;
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

  // ---- labels ----

  private labelData(index: number): LabelData {
    let l = this.labels[index];
    if (!l) {
      l = this.computeLabel(index);
      this.labels[index] = l;
    }
    return l;
  }

  private labelOf(index: number): { latlng: [number, number]; radius: number } {
    const l = this.labelData(index);
    return { latlng: [l.lat, l.lng], radius: l.radius };
  }

  /** Angular radius (rad) of the cap around lat/lng that holds the country's main polygon. */
  private mainRadius(index: number, latlng: [number, number]): number {
    const ring = this.labelData(index).ring;
    if (!ring || ring.length === 0) return this.capRadius[index];
    const c = lonLatToVec(latlng[1], latlng[0], [0, 0, 0]);
    let minDot = 1;
    const v = [0, 0, 0];
    for (const pt of ring) {
      lonLatToVec(pt[0], pt[1], v);
      minDot = Math.min(minDot, c[0] * v[0] + c[1] * v[1] + c[2] * v[2]);
    }
    return Math.acos(Math.max(-1, Math.min(1, minDot)));
  }

  private computeLabel(index: number): LabelData {
    const f = this.opts.features[index];
    const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best: Polygon | null = null;
    let bestArea = -1;
    for (const coordinates of polygons) {
      const poly: Polygon = { type: 'Polygon', coordinates };
      let a = geoArea(poly);
      if (a > 2 * Math.PI) a = 4 * Math.PI - a; // reversed winding
      if (a > bestArea) {
        bestArea = a;
        best = poly;
      }
    }
    const radius = Math.acos(Math.max(-1, 1 - Math.max(0, bestArea) / (2 * Math.PI)));
    const inside = (lng: number, lat: number) => this.picker.pick(lng, lat) === index;
    if (best) {
      const [lng, lat] = geoCentroid(best);
      if (Number.isFinite(lat) && inside(lng, lat)) return { lat, lng, radius, ring: best.coordinates[0] };
      // A crescent or ring shape: walk from the centroid toward each vertex until inside.
      const ring = best.coordinates[0];
      const stride = Math.max(1, Math.floor(ring.length / 24));
      for (let i = 0; i < ring.length; i += stride) {
        for (const t of [0.5, 0.75, 0.9]) {
          const x = lng + (ring[i][0] - lng) * t;
          const y = lat + (ring[i][1] - lat) * t;
          if (inside(x, y)) return { lat: y, lng: x, radius, ring };
        }
      }
    }
    const c = this.caps[index];
    return {
      lat: (Math.asin(Math.max(-1, Math.min(1, c.y))) * 180) / Math.PI,
      lng: (Math.atan2(c.x, c.z) * 180) / Math.PI,
      radius,
      ring: best ? best.coordinates[0] : null,
    };
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
