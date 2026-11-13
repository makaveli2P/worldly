// The 3D globe: rendering, raise and blur effects, picking and camera framing.
// Two map styles (satellite, atlas) and two themes (light, dark); colours come from src/theme.ts.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LinearSRGBColorSpace,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Ray,
  Raycaster,
  Scene,
  ShaderMaterial,
  Sphere,
  SphereGeometry,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  DoubleSide,
  type IUniform,
} from 'three';
import { globePalettes, systemTheme, type GlobePalette, type MapStyle, type ThemeName } from '../theme';
import type { CountryFeature, CountryId } from '../types';
import { globeZoomRatio, handOnKmPerPx, kmPerPxGlobe } from '../view/carry';
import type { Insets, TextureHandover, ViewInitial, ViewState } from '../view/types';
import { worldAssets } from './assets';
import { BlurPass } from './blurPass';
import {
  EARTH_KM,
  FOCUS_FILL,
  FOCUS_MS,
  FOV,
  FRAME_TAU,
  LIFT,
  MARKER_PX,
  MIN_DIST,
  NUDGES,
  OUTLINE_PX,
  SMALL_CAP,
  TAP_HOLD_PX,
  easeInOut,
  rgb,
} from './constants';
import { GlobeControls } from './controls';
import { lonLatToVec, type BoundingCap, type Range } from './geometry';
import type { CountryLabels } from './labels';
import { nearestSmall, pickWithSlop, type SmallCandidate } from './pick';
import type { CountryPicker } from './picker';
import { SatelliteTexture } from './satelliteTexture';
import { SlotAnimator } from './slots';
import { clampLat, dragLatLimit, dragView, lerpView, orientationFor, visibleArc, wrapLng, type ViewCentre } from './view';
import { TEXTURES } from './textureManifest';
import { chooseTextureTiers, neededTextureWidth } from './textureTiers';
import {
  SLOTS,
  landFragment,
  landVertex,
  lineFragment,
  limbVertex,
  lineVertex,
  oceanFragment,
  oceanVertex,
  plainLineFragment,
  plainLineVertex,
} from './shaders';

export type { MapStyle, ThemeName } from '../theme';

export interface GlobeOptions {
  container: HTMLElement;
  features: CountryFeature[];
  onHover: (id: CountryId | null, screen: { x: number; y: number } | null) => void; // screen = client px for the tooltip
  onSelect: (id: CountryId | null) => void; // null = click on ocean/space. Fired only for clicks, not drags (<5px movement).
  onReset?: () => void; // double-click or double-tap on the canvas. Globe already called resetView(); deselect here.
  mapStyle?: MapStyle; // default 'satellite'
  theme?: ThemeName; // default: prefers-color-scheme
  /** Ids of features with a reversed ring winding, from the build (/data/labels.json). Without it, the picker computes them. */
  inverted?: ReadonlySet<CountryId>;
  /** The first texture tier that index.html started to download (a null Blob: it did not start). */
  firstTexture?: { url: string; blob: Promise<Blob | null> };
  /** The state to show in the first frame, from the view before (src/view/ViewHost.ts). */
  initial?: ViewInitial;
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

const MAX_DIST = 6;
const BASE_RADIUS = 1.002;
const LINE_OFFSET = 0.0006;
const GRATICULE_RADIUS = 1.0008;
const FIT = 0.42; // globe radius as a share of the smaller side of the free rect
const IDLE_MS = 1500;
const SPIN = 0.1; // rad/s, idle rotation (about 6°/s)

/** The meshes of one raise slot (src/globe/slots.ts). */
interface SlotMeshes {
  mesh: Mesh;
  lines: LineSegments[];
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
  readonly kind = 'globe' as const;
  readonly canvas: HTMLCanvasElement;

  private readonly opts: GlobeOptions;
  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(FOV, 1, 0.02, 40);
  private readonly scene = new Scene();
  private readonly overlay = new Scene();
  private readonly limbScene = new Scene(); // drawn last, sharp, also over the blur
  private readonly globe = new Group();
  private readonly overlayGlobe = new Group();
  private readonly controls: GlobeControls;
  private readonly picker: CountryPicker;
  private readonly idToIndex: Map<CountryId, number>;
  private readonly triangleRanges: Range[];
  private readonly lineRanges: Range[];
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly caps: BoundingCap[];
  private readonly capRadius: number[]; // true angular radius per country, rad
  private readonly smallCountries: number[];
  private readonly labels: CountryLabels;
  private readonly marker: HTMLDivElement;
  private dpr = 1; // the devicePixelRatio of the last resize

  // Style.
  private mapStyle: MapStyle;
  private themeName: ThemeName;
  private palette: GlobePalette;
  private readonly satellite: SatelliteTexture;
  private zoomedOrSelected = false; // the largest tier waits for the first zoom or selection
  // Phones and tablets: fewer pixels for the same look (about 44% fewer than DPR 2).
  private readonly maxDpr = window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2;

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
  private readonly slotAnimator = new SlotAnimator();
  private readonly styleUniforms: {
    tMap: IUniform<Texture | null>;
    uTex: IUniform<number>;
    uSatellite: IUniform<number>;
    uLand: IUniform<Vector3>;
    uWall: IUniform<Vector3>;
    uColor: IUniform<Vector3>; // border colour
    uAlpha: IUniform<number>; // border alpha
  };
  private readonly slotMeshes: SlotMeshes[] = [];

  // Post-processing for the blur.
  private readonly blurPass = new BlurPass();

  // Interaction state.
  private hoverIndex = -1;
  private previewIndex = -1;
  private selectedIndex = -1;
  private pointer: { x: number; y: number } | null = null;
  private pointerMoved = false;
  private lastActivity = -Infinity; // spin from the first frame
  private spin = 0; // 0..1 ramp of the idle rotation
  // The lat/lng at the centre of the view. globe.quaternion always follows it, with north up (see view.ts).
  private view: ViewCentre = { lat: 0, lng: 0 };
  // latlng is the focus point of a focus flight (null for the flight home), for getState().
  private focusAnim: { from: ViewCentre; to: ViewCentre; start: number; latlng: [number, number] | null } | null = null;
  private home: ViewCentre = { lat: 0, lng: 0 }; // view on first load, for resetView()
  // Lat of the surface point that the last drag grabbed. Undefined when the grab was off the globe.
  // The inertia of the throw uses it too, so the turn speed does not jump at release.
  private grabLat: number | undefined;
  private hoverHold: { x: number; y: number } | null = null; // no hover pick after a reset until the pointer moves

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

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = LinearSRGBColorSpace; // shaders write sRGB values as they are
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    this.renderer.autoClear = false;
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    const tiers = chooseTextureTiers(TEXTURES, {
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      finePointer: window.matchMedia('(pointer: fine)').matches,
      saveData: nav.connection?.saveData === true,
      deviceMemory: nav.deviceMemory,
    });
    this.canvas = this.renderer.domElement;
    Object.assign(this.canvas.style, {
      display: 'block',
      width: '100%',
      height: '100%',
      touchAction: 'none',
      userSelect: 'none',
      webkitUserSelect: 'none',
      cursor: 'grab',
    });
    this.canvas.tabIndex = -1; // focus target after a panel closes
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Globe. Press / to search for a country.');
    this.container.appendChild(this.canvas);
    this.marker = document.createElement('div');
    this.marker.className = 'globe-marker';
    this.marker.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.marker);

    // Land, walls and borders: one merged geometry. worldAssets() builds it one time for these features.
    const assets = worldAssets(opts.features, opts.inverted);
    const data = assets.geometry;
    this.idToIndex = assets.idToIndex;
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
      // Known bounds (unit directions, raised in the shader): the renderer does not walk 245k vertices for each geometry.
      g.boundingSphere = new Sphere(new Vector3(), BASE_RADIUS + LIFT + LINE_OFFSET);
      return g;
    };
    this.landGeometry = makeGeometry(triIndex);
    this.lineGeometry = makeGeometry(lineIndex);
    this.picker = assets.picker;
    this.caps = assets.caps;
    this.capRadius = assets.capRadius;
    this.smallCountries = assets.smallCountries;
    this.labels = assets.labels;
    this.satellite = new SatelliteTexture(this.renderer, {
      tiers,
      firstTexture: opts.firstTexture,
      handover: opts.initial?.texture,
      reducedMotion: this.reducedMotion,
      onChange: () => {
        this.updateTextureUniforms();
        this.needsRender = true;
      },
    });

    this.styleUniforms = {
      tMap: this.satellite.uniform,
      uTex: { value: 0 },
      uSatellite: { value: 0 },
      uLand: { value: new Vector3() },
      uWall: { value: new Vector3() },
      uColor: { value: new Vector3() },
      uAlpha: { value: 1 },
    };
    const landShared = {
      ...this.slotAnimator.uniforms,
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
      this.slotMeshes.push({ mesh, lines });
    }

    this.applyPalette();

    // Start with the viewer's own longitude, from the time zone.
    const lon = -new Date().getTimezoneOffset() / 4;
    this.home = { lat: 20, lng: wrapLng(lon) };
    this.setView(this.home);

    this.controls = new GlobeControls(this.canvas, {
      turn: (dx, dy) => {
        this.focusAnim = null;
        this.setView(dragView(this.view, dx, dy, { maxLat: this.dragLimit(), grabLat: this.grabLat }));
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
        this.zoomedOrSelected = true;
        this.needsRender = true;
      },
      tap: (x, y) => {
        const i = this.pickAt(x, y);
        this.opts.onSelect(i >= 0 ? this.opts.features[i].id : null);
      },
      doubleTap: (x, y, type) => {
        this.resetView();
        if (type !== 'touch') this.hoverHold = { x, y };
        this.opts.onReset?.();
      },
      hover: (x, y) => {
        if (this.hoverHold) {
          if (Math.hypot(x - this.hoverHold.x, y - this.hoverHold.y) < TAP_HOLD_PX) return;
          this.hoverHold = null;
        }
        this.pointer = { x, y };
        this.pointerMoved = true;
      },
      leave: () => {
        this.pointer = null;
        this.setHover(-1, null);
      },
      dragStart: (x, y) => {
        this.grabLat = this.surfaceLatAt(x, y);
        this.focusAnim = null;
        this.hoverHold = null;
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
    if (opts.initial) this.applyInitial(opts.initial);
    this.distance = this.targetDistance();
    this.updateCamera();
    // The view before was in a focus flight: fly on to its end and fit the selected country there.
    if (opts.initial?.state?.focus) this.focus(opts.initial.state.focus);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The first frame shows the state of the view before: the place, the zoom, the insets and the raise. */
  private applyInitial(init: ViewInitial): void {
    if (init.insets) {
      Object.assign(this.insets, init.insets);
      Object.assign(this.insetsTarget, init.insets);
    }
    this.selectedIndex = this.indexOf(init.selected ?? null);
    this.previewIndex = this.indexOf(init.preview ?? null);
    if (this.selectedIndex >= 0) this.zoomedOrSelected = true;
    // The raise and the blur start at their end state, so the first frame matches the view before.
    if (this.selectedIndex >= 0 || this.previewIndex >= 0) this.animateSlots(0, true);
    if (init.state) {
      const { lat, lng, kmPerPx } = init.state;
      this.setView({ lat, lng });
      this.focusRadius = null;
      const fit = this.fitDistance();
      this.zoomRatio = globeZoomRatio(kmPerPx, this.height, fit, this.maxDistance(fit));
      if (kmPerPx !== null) this.zoomedOrSelected = true;
      // The view came from a user action: the idle spin waits as after any other input.
      this.lastActivity = performance.now();
    }
    this.needsRender = true;
  }

  setSelected(id: CountryId | null): void {
    const index = this.indexOf(id);
    // No change: do not restart the idle timer (a reset lets the spin resume at once).
    if (index === this.selectedIndex && index < 0) return;
    this.selectedIndex = index;
    if (this.selectedIndex < 0) this.focusRadius = null;
    else this.zoomedOrSelected = true;
    this.lastActivity = performance.now();
    this.needsRender = true;
  }

  /**
   * Turns the globe back to its first-load orientation and zoom, and clears hover, preview and
   * selection. The idle spin starts when the turn ends. Insets stay: the owner clears them with the panels.
   */
  resetView(): void {
    this.controls.cancelPendingTap();
    this.controls.stopInertia();
    this.previewIndex = -1;
    this.selectedIndex = -1;
    this.focusRadius = null;
    this.zoomRatio = 1;
    this.pointer = null;
    this.setHover(-1, null);
    if (this.reducedMotion.matches) {
      this.setView(this.home);
      this.focusAnim = null;
      this.distance = this.targetDistance();
      this.updateCamera();
    } else {
      this.focusAnim = { from: { ...this.view }, to: { ...this.home }, start: performance.now(), latlng: null };
    }
    this.lastActivity = -Infinity;
    this.updateCursor();
    this.needsRender = true;
  }

  /**
   * Turns lat/lng to face the camera. With a selected country, also zooms to fit it.
   * The target can be past the drag limit (Antarctica is at 90°S). A drag then only moves the view away from the pole.
   */
  focus(latlng: [number, number]): void {
    // Fit the main polygon, not the whole feature: overseas territories must not stop the zoom.
    this.focusRadius =
      this.selectedIndex >= 0 ? this.labels.mainRadius(this.selectedIndex, latlng, this.capRadius[this.selectedIndex]) : null;
    const to = { lat: clampLat(latlng[0]), lng: wrapLng(latlng[1]) };
    this.controls.stopInertia();
    if (this.reducedMotion.matches) {
      this.setView(to);
      this.focusAnim = null;
      this.pointerMoved = true; // the jump does not count as a move: pick the hover again
    } else {
      this.focusAnim = { from: { ...this.view }, to, start: performance.now(), latlng };
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
    const index = this.indexOf(id);
    if (index === this.previewIndex && index < 0) return;
    this.previewIndex = index;
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
    return {
      lat: this.view.lat,
      lng: this.view.lng,
      altitudeKm: Math.max(0, this.distance - 1) * EARTH_KM,
      distance: this.distance,
    };
  }

  /**
   * The place on view, for the next view. kmPerPx is null at the home zoom (no fit, and a zoom near 1).
   * During a flight, the place is the end of the flight and the zoom is the target zoom; a focus flight also
   * gives its focus point.
   */
  getState(): ViewState {
    const a = this.focusAnim;
    const at = a ? a.to : this.view;
    const ratio = this.focusRadius === null ? this.zoomRatio : null;
    const distance = a ? this.targetDistance() : this.distance;
    const state: ViewState = { lat: at.lat, lng: at.lng, kmPerPx: handOnKmPerPx(ratio, kmPerPxGlobe(distance, this.height)) };
    if (a?.latlng) state.focus = a.latlng;
    return state;
  }

  /** Gives the satellite image on screen to the next view (see SatelliteTexture.handover). */
  takeTexture(): TextureHandover | null {
    return this.satellite.handover();
  }

  /** The canvas rect in client px (cached; refreshed on resize, scroll and each rendered frame). */
  rect(): DOMRect {
    return this.canvasRect;
  }

  /** Label point of the selected country, where the leader lines start. Null with no selection. */
  selectedAnchor(): [number, number] | null {
    return this.selectedIndex >= 0 ? this.labels.labelOf(this.selectedIndex).latlng : null;
  }

  /** Current raise of the selected country in earth radii (0..Globe.RAISE), for project(). */
  selectedLift(): number {
    return this.liftAt(this.selectedIndex);
  }

  /**
   * Current raise of any country in earth radii (0..Globe.RAISE), for project(). A hovered, previewed or
   * selected country rises, and a country that rose falls back. 0 for a country with no raise.
   */
  liftOf(id: CountryId): number {
    return this.liftAt(this.indexOf(id));
  }

  private liftAt(index: number): number {
    return this.slotAnimator.liftAt(index);
  }

  /** Label point [lat, lng] of a country: the centroid of its largest polygon, kept inside the shape. */
  labelPoint(id: CountryId): [number, number] | null {
    const i = this.indexOf(id);
    return i < 0 ? null : this.labels.labelOf(i).latlng;
  }

  /** Approximate on-screen radius in CSS px of the country's main polygon at its label point. 0 on the far side. */
  screenRadius(id: CountryId): number {
    const i = this.indexOf(id);
    if (i < 0) return 0;
    const l = this.labels.labelOf(i);
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
    for (const s of this.slotMeshes) {
      s.mesh.geometry.dispose();
      s.lines[0].geometry.dispose();
    }
    this.landGeometry.dispose();
    this.lineGeometry.dispose();
    this.oceanGeometry.dispose();
    this.graticuleGeometry.dispose();
    this.limbGeometry.dispose();
    for (const m of [
      this.landMaterial,
      this.lineMaterial,
      ...this.outlineMaterials,
      this.oceanMaterial,
      this.graticuleMaterial,
      this.limbMaterial,
      this.depthMaterial,
    ])
      m.dispose();
    this.blurPass.dispose();
    this.satellite.dispose();
    // Free the GL context now: a browser keeps only a few, and a view switch makes a new one.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- style ----

  private readonly vecScratch = [0, 0, 0];

  private applyPalette(): void {
    const p = globePalettes[this.themeName][this.mapStyle];
    this.palette = p;
    const sat = this.mapStyle === 'satellite';
    if (sat) this.satellite.ensure();
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
    const g = this.graticuleMaterial.uniforms;
    g.uColor.value.copy(rgb(p.graticule));
    g.uAlpha.value = p.graticuleAlpha;
    this.blurPass.setPalette(p);
    const bg = rgb(p.paper);
    this.clearColor.setRGB(bg.x, bg.y, bg.z, LinearSRGBColorSpace);
    this.updateTextureUniforms();
    this.needsRender = true;
  }

  private updateTextureUniforms(): void {
    const t = this.mapStyle === 'satellite' ? this.satellite.mix : 0;
    this.oceanMaterial.uniforms.uTex.value = t;
    this.styleUniforms.uTex.value = t;
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
    let inertia = false;
    // ResizeObserver misses a DPR change at the same CSS size (window moved to another screen).
    if ((window.devicePixelRatio || 1) !== this.dpr) this.resize();

    const upgrade = {
      idleMs: now - this.lastActivity,
      moving: this.focusAnim !== null || this.controls.isDragging,
      zoomedOrSelected: this.zoomedOrSelected,
      // The target distance: a selection starts the download while the camera still moves in.
      needWidth: neededTextureWidth(this.height, this.renderer.getPixelRatio(), Math.min(this.distance, this.targetDistance()), FOV),
    };
    if (this.satellite.tick(now, dt, { satellite: this.mapStyle === 'satellite', upgrade })) this.needsRender = true;

    if (this.focusAnim) {
      const t = Math.min(1, (now - this.focusAnim.start) / FOCUS_MS);
      this.setView(lerpView(this.focusAnim.from, this.focusAnim.to, easeInOut(t)));
      if (t >= 1) this.focusAnim = null;
      moved = true;
    } else if (this.controls.update(dt)) {
      moved = true;
      inertia = true;
    }

    // Idle spin about the polar axis, with a soft start. North stays up. The surface moves to the
    // right, so the view centre goes west.
    const active = this.hoverIndex >= 0 || this.previewIndex >= 0 || this.selectedIndex >= 0;
    const canSpin = !reduced && !active && !this.focusAnim && !this.controls.isDragging && now - this.lastActivity > IDLE_MS;
    this.spin = canSpin ? Math.min(1, this.spin + dt / 1500) : 0;
    if (this.spin > 0) {
      const step = (((SPIN * this.spin * dt) / 1000) * 180) / Math.PI;
      this.setView({ lat: this.view.lat, lng: this.view.lng - step });
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

    // A larger texture tier goes to the GPU only in a frame at rest: its upload is a main-thread task.
    this.satellite.upload({
      dragging: this.controls.isDragging,
      focusAnim: this.focusAnim !== null,
      inertia,
      framing,
      spinning: this.spin > 0,
      idleMs: now - this.lastActivity,
    });

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
    const want = new Map<number, 'sel' | 'hover'>();
    if (this.selectedIndex >= 0) want.set(this.selectedIndex, 'sel');
    const hover = this.previewIndex >= 0 ? this.previewIndex : this.hoverIndex;
    if (hover >= 0 && !want.has(hover)) want.set(hover, 'hover');
    return this.slotAnimator.step(dt, reduced, want, this.palette);
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
    const amount = easeInOut(this.slotAnimator.blurT);
    this.overlayGlobe.quaternion.copy(this.globe.quaternion);

    if (amount < 0.002) {
      r.setRenderTarget(null);
      r.setClearColor(this.clearColor, 1);
      r.clear();
      r.render(this.scene, this.camera);
      r.render(this.limbScene, this.camera);
      return;
    }

    this.blurPass.render(r, () => r.render(this.scene, this.camera), amount, this.clearColor);

    // Active countries, sharp, hidden behind the ocean sphere where they turn away.
    r.clearDepth();
    this.slotAnimator.slots.forEach((s, i) => {
      const m = this.slotMeshes[i];
      const on = s.index >= 0 && s.t > 0;
      m.mesh.visible = on;
      for (const l of m.lines) l.visible = on;
      if (!on) return;
      const tr = this.triangleRanges[s.index];
      const lr = this.lineRanges[s.index];
      m.mesh.geometry.setDrawRange(tr.start, tr.count);
      m.lines[0].geometry.setDrawRange(lr.start, lr.count);
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
    const dpr = Math.min(this.dpr, this.maxDpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.blurPass.resize(w, h, dpr);
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

  /** Sets the view centre (lat clamped to ±90, lng wrapped) and turns the globe to it with north up. */
  private setView(v: ViewCentre): void {
    this.view = { lat: clampLat(v.lat), lng: wrapLng(v.lng) };
    orientationFor(this.view.lat, this.view.lng, this.globe.quaternion);
  }

  /** Max |lat| that a drag can bring to the view centre at this zoom. The pole stays in the free rect. */
  private dragLimit(): number {
    const { h } = this.freeRect();
    const tanEdge = (h / this.height) * Math.tan((FOV * Math.PI) / 360);
    return dragLatLimit(visibleArc(this.distance, tanEdge));
  }

  // ---- picking ----

  /** The camera ray through a client point. */
  private rayAt(clientX: number, clientY: number): Ray {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray;
  }

  /** Lat of the surface point under a client point, or undefined off the globe. */
  private surfaceLatAt(clientX: number, clientY: number): number | undefined {
    this.tmpSphere.radius = BASE_RADIUS;
    if (!this.rayAt(clientX, clientY).intersectSphere(this.tmpSphere, this.tmpV)) return undefined;
    const v = this.tmpV.normalize().applyQuaternion(this.tmpQ.copy(this.globe.quaternion).invert());
    return (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI;
  }

  private pickAt(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const ray = this.rayAt(clientX, clientY);
    const inv = this.tmpQ.copy(this.globe.quaternion).invert();

    const at = (amount: number): number => {
      this.tmpSphere.radius = BASE_RADIUS + amount * LIFT;
      if (!ray.intersectSphere(this.tmpSphere, this.tmpV)) return -2;
      const v = this.tmpV.normalize().applyQuaternion(inv);
      const lon = (Math.atan2(v.x, v.z) * 180) / Math.PI;
      const lat = (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI;
      return this.picker.pick(lon, lat);
    };
    return pickWithSlop({
      slots: this.slotAnimator.amounts(),
      capRadius: this.capRadius,
      smallCap: SMALL_CAP,
      at,
      near: () => this.nearSmallCountry(clientX - rect.left, clientY - rect.top),
    });
  }

  /** The small country whose projected bounding cap is nearest the point and within the pick slop, or -1 (pick.ts). */
  private nearSmallCountry(x: number, y: number): number {
    const camZ = this.camera.position.z;
    const v = new Vector3();
    const candidates: SmallCandidate[] = [];
    for (const i of this.smallCountries) {
      const cap = this.caps[i];
      v.set(cap.x, cap.y, cap.z).applyQuaternion(this.globe.quaternion);
      if (v.z <= 1 / camZ) continue; // on the far side
      const radiusPx = this.projectedRadius(this.capRadius[i], v);
      v.multiplyScalar(BASE_RADIUS).project(this.camera);
      candidates.push({ index: i, x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, radiusPx });
    }
    return nearestSmall(x, y, candidates);
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
