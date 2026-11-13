// The flat map: a Web Mercator view of the same world as the globe, drawn with WebGL.
// It has the public API of Globe, so the overlay and the page work with either view.
// It shares the geometry (src/globe/assets.ts), the raise slots, the blur pass and the satellite tiers with the globe.
// The pure camera math is in mapView.ts.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LinearSRGBColorSpace,
  LineSegments,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Sphere,
  Texture,
  Vector2,
  Vector3,
  WebGLRenderer,
  type IUniform,
} from 'three';
import { worldAssets } from '../globe/assets';
import { BlurPass } from '../globe/blurPass';
import {
  EARTH_KM,
  FOCUS_MS,
  FOV,
  FRAME_TAU,
  MARKER_PX,
  NUDGES,
  OUTLINE_PX,
  RAISE,
  SMALL_CAP,
  TAP_HOLD_PX,
  easeInOut,
  rgb,
} from '../globe/constants';
import { GlobeControls } from '../globe/controls';
import { capCentre, type BoundingCap, type Range } from '../globe/geometry';
import type { GlobeView, ProjectedPoint } from '../globe/Globe';
import type { CountryLabels } from '../globe/labels';
import { nearestSmall, pickWithSlop } from '../globe/pick';
import type { CountryPicker } from '../globe/picker';
import { SatelliteTexture } from '../globe/satelliteTexture';
import { SLOTS, plainLineFragment, plainLineVertex, lineFragment } from '../globe/shaders';
import { SlotAnimator } from '../globe/slots';
import { TEXTURES } from '../globe/textureManifest';
import { chooseTextureTiers, mapNeededTextureWidth } from '../globe/textureTiers';
import { globePalettes, systemTheme, type GlobePalette, type MapStyle, type ThemeName } from '../theme';
import type { CountryId } from '../types';
import { handOnKmPerPx, mapScale } from '../view/carry';
import type { Insets, Surface, TextureHandover, ViewOptions, ViewState } from '../view/types';
import { mapLandFragment, mapLandVertex, mapLineVertex, mapOceanFragment, mapOceanVertex } from './mapShaders';
import {
  anchorCamera,
  cameraBounds,
  clampY,
  copyOffsets,
  fitScale,
  focusExtent,
  freeRect,
  fromScreen,
  homeY,
  kmPerPxMap,
  lerpCenter,
  MAX_COPIES,
  panBy,
  sHome,
  sMax,
  sMin,
  scaleDenominator,
  targetScale,
  toScreen,
  type FocusExtent,
  type MapCamera,
  type MapFrame,
  type ZoomAnchor,
} from './mapView';
import { MAX_LAT, latOfY, mercY, wrapRad } from './mercator';
import { mercatorPositions } from './plane';

/** The raise of a country on the map, in CSS px up the screen. The same at every zoom. */
export const LIFT_PX = 6;

const RAD = Math.PI / 180;
const OCEAN_Z = -0.002;
const GRATICULE_Z = -0.001;

/** The geometries of one raise slot (src/globe/slots.ts): one draw range in the shared index arrays. */
interface SlotGeometry {
  triangles: BufferGeometry;
  lines: BufferGeometry;
}

/** Straight lines every 15°: latitudes -75..75 and meridians from map edge to map edge, in world units. */
function graticuleGeometry(): BufferGeometry {
  const pts: number[] = [];
  for (let lon = -180; lon < 180; lon += 15) pts.push(lon * RAD, -Math.PI, GRATICULE_Z, lon * RAD, Math.PI, GRATICULE_Z);
  for (let lat = -75; lat <= 75; lat += 15) {
    const y = mercY(lat);
    pts.push(-Math.PI, y, GRATICULE_Z, Math.PI, y, GRATICULE_Z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  g.boundingSphere = new Sphere(new Vector3(), Math.PI * Math.SQRT2 + 0.1);
  return g;
}

/** The two map edges (y = ±π), one unit wide. Each frame scales them to the camera bounds. */
function edgeGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, Math.PI, 0, 0.5, Math.PI, 0, -0.5, -Math.PI, 0, 0.5, -Math.PI, 0]), 3));
  return g;
}

export class FlatMap {
  /** Height of a raised country in earth radii, as on the globe: project(lat, lng, FlatMap.RAISE) hits the raised cap. */
  static readonly RAISE = RAISE;
  readonly kind = 'map' as const;
  readonly canvas: HTMLCanvasElement;

  private readonly opts: ViewOptions;
  private readonly container: HTMLElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  private readonly scene = new Scene();
  private readonly overlay = new Scene();
  private readonly sharpScene = new Scene(); // drawn last, sharp, also over the blur
  private readonly copies: Group[] = [];
  private readonly overlayCopies: Group[] = [];
  private readonly landMeshes: Mesh[] = [];
  private readonly controls: GlobeControls;
  private readonly picker: CountryPicker;
  private readonly idToIndex: Map<CountryId, number>;
  private readonly triangleRanges: Range[];
  private readonly lineRanges: Range[];
  private readonly caps: BoundingCap[];
  private readonly capRadius: number[];
  private readonly smallCountries: number[];
  private readonly labels: CountryLabels;
  private readonly xMin: number; // world x range of the mesh (the unwrapped lon goes past ±π)
  private readonly xMax: number;
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly marker: HTMLDivElement;
  private readonly maxDpr = window.matchMedia('(pointer: coarse)').matches ? 1.5 : 2;
  private dpr = 1;

  // Style.
  private mapStyle: MapStyle;
  private themeName: ThemeName;
  private palette: GlobePalette;
  private readonly satellite: SatelliteTexture;
  private zoomedOrSelected = false;

  // Geometry and materials (kept for dispose). The typed arrays belong to worldAssets() and stay.
  private readonly landGeometry: BufferGeometry;
  private readonly lineGeometry: BufferGeometry;
  private readonly oceanGeometry = new PlaneGeometry(1, 1);
  private readonly graticuleGeometry = graticuleGeometry();
  private readonly edgeGeometry = edgeGeometry();
  private readonly landMaterial: ShaderMaterial;
  private readonly lineMaterial: ShaderMaterial;
  private readonly outlineMaterials: ShaderMaterial[];
  private readonly oceanMaterial: ShaderMaterial;
  private readonly graticuleMaterial: ShaderMaterial;
  private readonly edgeMaterial: ShaderMaterial;
  private readonly ocean: Mesh;
  private readonly edges: LineSegments;
  private readonly liftWorld: IUniform<number> = { value: 0 };
  private readonly styleUniforms: {
    tMap: IUniform<Texture | null>;
    uTex: IUniform<number>;
    uSatellite: IUniform<number>;
    uLand: IUniform<Vector3>;
    uWall: IUniform<Vector3>;
    uColor: IUniform<Vector3>;
    uAlpha: IUniform<number>;
  };
  private readonly slotAnimator = new SlotAnimator();
  private readonly slotGeometries: SlotGeometry[] = [];
  private readonly blurPass = new BlurPass();

  // Interaction state.
  private hoverIndex = -1;
  private previewIndex = -1;
  private selectedIndex = -1;
  private pointer: { x: number; y: number } | null = null;
  private pointerMoved = false;
  private lastActivity = -Infinity;
  private hoverHold: { x: number; y: number } | null = null;
  // A flight of the camera centre. to.y is not clamped: each frame clamps it at the live target scale.
  // latlng is the focus point of a focus flight (null for the flight home).
  private focusAnim: { from: { x: number; y: number }; to: { x: number; y: number }; start: number; latlng: [number, number] | null } | null =
    null;
  private zoomAnchor: ZoomAnchor | null = null;
  private homeX = 0;

  // Framing.
  private width = 1;
  private height = 1;
  private canvasRect = new DOMRect();
  private readonly insetsTarget: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private readonly insets: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
  private cam: MapCamera = { x: 0, y: 0, s: 1 };
  private zoomRatio = 1; // s / sHome for a user zoom (more than 1 = closer)
  // The half size of the focused country. Each frame fits it to the free rect of that frame, so the fit follows
  // the panels as they open (as focusRadius on the globe). null = user zoom.
  private focusFit: FocusExtent | null = null;

  private raf = 0;
  private lastFrame = performance.now();
  private needsRender = true;
  private disposed = false;
  private readonly frameListeners = new Set<() => void>();
  private readonly clearColor = new Color();

  constructor(opts: ViewOptions) {
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
    this.canvas.setAttribute('aria-label', 'Map. Press / to search for a country.');
    this.container.appendChild(this.canvas);
    this.marker = document.createElement('div');
    this.marker.className = 'globe-marker';
    this.marker.setAttribute('aria-hidden', 'true');
    this.container.appendChild(this.marker);

    const assets = worldAssets(opts.features, opts.inverted);
    const data = assets.geometry;
    this.idToIndex = assets.idToIndex;
    this.picker = assets.picker;
    this.caps = assets.caps;
    this.capRadius = assets.capRadius;
    this.smallCountries = assets.smallCountries;
    this.labels = assets.labels;
    this.triangleRanges = data.triangleRanges;
    this.lineRanges = data.lineRanges;
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

    // Land, walls and borders: the globe's index arrays on the Mercator positions (xy; GL sets z = 0).
    const merc = mercatorPositions(data);
    let xMin = Infinity;
    let xMax = -Infinity;
    for (let i = 0; i < merc.length; i += 2) {
      if (merc[i] < xMin) xMin = merc[i];
      if (merc[i] > xMax) xMax = merc[i];
    }
    this.xMin = xMin;
    this.xMax = xMax;
    const position = new BufferAttribute(merc, 2);
    const countryIndex = new BufferAttribute(data.countryIndex, 1);
    const kind = new BufferAttribute(data.kind, 1);
    const triIndex = new BufferAttribute(data.triangles, 1);
    const lineIndex = new BufferAttribute(data.lines, 1);
    // Known bounds: the renderer does not walk 245k vertices for each geometry. The pad covers the raise.
    const bounds = new Sphere(new Vector3((xMin + xMax) / 2, 0, 0), Math.hypot((xMax - xMin) / 2, Math.PI) + 0.1);
    const makeGeometry = (index: BufferAttribute) => {
      const g = new BufferGeometry();
      g.setAttribute('position', position);
      g.setAttribute('countryIndex', countryIndex);
      g.setAttribute('kind', kind);
      g.setIndex(index);
      g.boundingSphere = bounds.clone();
      return g;
    };
    this.landGeometry = makeGeometry(triIndex);
    this.lineGeometry = makeGeometry(lineIndex);

    this.styleUniforms = {
      tMap: this.satellite.uniform,
      uTex: { value: 0 },
      uSatellite: { value: 0 },
      uLand: { value: new Vector3() },
      uWall: { value: new Vector3() },
      uColor: { value: new Vector3() },
      uAlpha: { value: 1 },
    };
    const landShared = { ...this.slotAnimator.uniforms, ...this.styleUniforms, uLiftWorld: this.liftWorld };
    this.landMaterial = new ShaderMaterial({
      vertexShader: mapLandVertex,
      fragmentShader: mapLandFragment,
      uniforms: landShared,
      side: DoubleSide,
    });
    const makeLineMaterial = () =>
      new ShaderMaterial({
        vertexShader: mapLineVertex,
        fragmentShader: lineFragment,
        uniforms: { ...landShared, uNudge: { value: new Vector2() } },
        transparent: true,
        depthWrite: false,
      });
    this.lineMaterial = makeLineMaterial();
    // Active countries get their outline drawn five times, a fraction of a pixel apart.
    this.outlineMaterials = NUDGES.map(() => makeLineMaterial());
    this.oceanMaterial = new ShaderMaterial({
      vertexShader: mapOceanVertex,
      fragmentShader: mapOceanFragment,
      uniforms: { tMap: this.styleUniforms.tMap, uTex: { value: 0 }, uColor: { value: new Vector3() } },
    });
    this.graticuleMaterial = new ShaderMaterial({
      vertexShader: plainLineVertex,
      fragmentShader: plainLineFragment,
      uniforms: { uColor: { value: new Vector3() }, uAlpha: { value: 0 } },
      transparent: true,
      depthWrite: false,
    });
    this.edgeMaterial = new ShaderMaterial({
      vertexShader: plainLineVertex,
      fragmentShader: plainLineFragment,
      uniforms: { uColor: { value: new Vector3() }, uAlpha: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });

    // One ocean plane under all copies, cut to the map edges. Each render fits it to the camera bounds.
    this.ocean = new Mesh(this.oceanGeometry, this.oceanMaterial);
    this.ocean.frustumCulled = false;
    this.ocean.renderOrder = -1;
    this.scene.add(this.ocean);
    // The edges of the map: the analogue of the limb of the globe, sharp over the blur.
    this.edges = new LineSegments(this.edgeGeometry, this.edgeMaterial);
    this.edges.frustumCulled = false;
    this.edges.renderOrder = 10;
    this.sharpScene.add(this.edges);

    for (let i = 0; i < SLOTS; i++) this.slotGeometries.push({ triangles: makeGeometry(triIndex), lines: makeGeometry(lineIndex) });
    // The copies of the world side by side. They share the geometry and the materials.
    for (let c = 0; c < MAX_COPIES; c++) {
      const land = new Mesh(this.landGeometry, this.landMaterial);
      const graticule = new LineSegments(this.graticuleGeometry, this.graticuleMaterial);
      const borders = new LineSegments(this.lineGeometry, this.lineMaterial);
      graticule.renderOrder = 1;
      borders.renderOrder = 2;
      const group = new Group();
      group.add(land, graticule, borders);
      this.landMeshes.push(land);
      this.copies.push(group);
      this.scene.add(group);

      // Overlay: the active countries drawn sharp over the blurred map. Per slot: the mesh, then the outline passes.
      const over = new Group();
      for (const g of this.slotGeometries) {
        const mesh = new Mesh(g.triangles, this.landMaterial);
        const lines = this.outlineMaterials.map((m) => new LineSegments(g.lines, m));
        for (const o of [mesh, ...lines]) o.visible = false;
        lines.forEach((l) => (l.renderOrder = 2));
        over.add(mesh, ...lines);
      }
      this.overlayCopies.push(over);
      this.overlay.add(over);
    }

    this.applyPalette();

    // Start with the viewer's own longitude, from the time zone.
    const lon = -new Date().getTimezoneOffset() / 4;
    this.homeX = wrapRad(lon * RAD);

    this.controls = new GlobeControls(this.canvas, {
      turn: (dx, dy) => {
        this.focusAnim = null;
        this.zoomAnchor = null;
        this.cam = panBy(this.cam, dx, dy, this.frame());
        this.needsRender = true;
      },
      zoom: (f, clientX, clientY) => this.zoomBy(f, clientX, clientY),
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
      dragStart: () => {
        this.focusAnim = null;
        this.zoomAnchor = null;
        this.hoverHold = null;
        this.setHover(-1, null);
        this.updateCursor();
      },
      dragEnd: () => this.updateCursor(),
      activity: () => {
        this.lastActivity = performance.now();
      },
      radiansPerPixel: () => 1 / this.cam.s,
    });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    window.addEventListener('scroll', this.onScroll, { passive: true, capture: true });
    this.width = Math.max(1, this.container.clientWidth);
    this.height = Math.max(1, this.container.clientHeight);

    // The first frame: the state of the view before, or the home view.
    const init = opts.initial;
    if (init?.insets) {
      Object.assign(this.insets, init.insets);
      Object.assign(this.insetsTarget, init.insets);
    }
    this.selectedIndex = this.indexOf(init?.selected ?? null);
    this.previewIndex = this.indexOf(init?.preview ?? null);
    if (this.selectedIndex >= 0) this.zoomedOrSelected = true;
    // The raise and the blur start at their end state, so the first frame matches the view before.
    if (this.selectedIndex >= 0 || this.previewIndex >= 0) this.animateSlots(0, true);
    const f = this.frame();
    if (init?.state) {
      const { lat, lng, kmPerPx } = init.state;
      const home = sHome(f);
      const s = mapScale(kmPerPx, lat, { home, min: sMin(f), max: sMax(f) });
      this.zoomRatio = s / home;
      this.cam = { x: wrapRad(lng * RAD), y: clampY(mercY(lat), s, f), s };
    } else {
      const s = sHome(f);
      this.cam = { x: this.homeX, y: clampY(homeY(), s, f), s };
    }
    this.resize();
    // The view before was in a focus flight: fly on to its end and fit the selected country there.
    if (init?.state?.focus) this.focus(init.state.focus);
    this.raf = requestAnimationFrame(this.tick);
  }

  setSelected(id: CountryId | null): void {
    const index = this.indexOf(id);
    if (index === this.selectedIndex && index < 0) return;
    this.selectedIndex = index;
    if (this.selectedIndex < 0) this.focusFit = null;
    else this.zoomedOrSelected = true;
    this.lastActivity = performance.now();
    this.needsRender = true;
  }

  /**
   * Moves the map back to the home view and zoom, and clears hover, preview and selection.
   * Insets stay: the owner clears them with the panels.
   */
  resetView(): void {
    this.controls.cancelPendingTap();
    this.controls.stopInertia();
    this.previewIndex = -1;
    this.selectedIndex = -1;
    this.focusFit = null;
    this.zoomRatio = 1;
    this.zoomAnchor = null;
    this.pointer = null;
    this.setHover(-1, null);
    const f = this.frame();
    const to = { x: this.homeX, y: homeY() };
    if (this.reducedMotion.matches) {
      this.focusAnim = null;
      this.cam = { x: to.x, y: clampY(to.y, sHome(f), f), s: sHome(f) };
      this.updateCamera();
    } else {
      this.focusAnim = { from: { x: this.cam.x, y: this.cam.y }, to, start: performance.now(), latlng: null };
    }
    this.lastActivity = -Infinity;
    this.updateCursor();
    this.needsRender = true;
  }

  /** Moves lat/lng to the centre of the free rect. With a selected country, also zooms to fit it. */
  focus(latlng: [number, number]): void {
    const i = this.selectedIndex;
    this.focusFit = i >= 0 ? focusExtent(this.labels.mainRings(i) ?? this.capRing(i), latlng) : null;
    const to = { x: wrapRad(latlng[1] * RAD), y: mercY(latlng[0]) };
    this.controls.stopInertia();
    this.zoomAnchor = null;
    if (this.reducedMotion.matches) {
      this.cam = { ...this.cam, x: to.x, y: clampY(to.y, this.targetScale(), this.frame()) };
      this.focusAnim = null;
      this.pointerMoved = true; // the jump does not count as a move: pick the hover again
    } else {
      this.focusAnim = { from: { x: this.cam.x, y: this.cam.y }, to, start: performance.now(), latlng };
    }
    this.lastActivity = performance.now();
    this.needsRender = true;
  }

  setViewportInsets(insets: Insets): void {
    Object.assign(this.insetsTarget, insets);
    if (this.reducedMotion.matches) {
      Object.assign(this.insets, insets);
      const f = this.frame();
      const s = this.targetScale();
      this.cam = { x: this.cam.x, y: clampY(this.cam.y, s, f), s };
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
   * Projects lat/lng to client px at the copy nearest the view centre. lift is in earth radii, as on the
   * globe (FlatMap.RAISE = top of a raised country). The lat stops at the map edge. Every point is visible.
   */
  project(lat: number, lng: number, lift = 0): ProjectedPoint {
    const p = toScreen(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)), lng, this.cam, this.frame(), (lift / RAISE) * LIFT_PX);
    return { x: this.canvasRect.left + p.x, y: this.canvasRect.top + p.y, visible: true, facing: 1 };
  }

  /** Calls cb after each rendered frame (the camera, map or style changed). Returns the unsubscribe. */
  onFrame(cb: () => void): () => void {
    this.frameListeners.add(cb);
    return () => {
      this.frameListeners.delete(cb);
    };
  }

  /**
   * The point at the centre of the view. distance and altitudeKm are the globe camera with the same ground
   * scale at the centre, so the readout and the overlay can use either view. scaleDenominator is the map scale.
   */
  getView(): GlobeView & { scaleDenominator: number } {
    const lat = latOfY(this.cam.y);
    const distance = 1 + (this.focal() * Math.cos(lat * RAD)) / this.cam.s;
    return {
      lat,
      lng: this.cam.x / RAD,
      altitudeKm: (distance - 1) * EARTH_KM,
      distance,
      scaleDenominator: scaleDenominator(kmPerPxMap(this.cam.s, lat)),
    };
  }

  /**
   * The place on view, for the next view. kmPerPx is null near the home zoom. During a flight, the place is the
   * end of the flight and the zoom is the target zoom; a focus flight also gives its focus point.
   */
  getState(): ViewState {
    const a = this.focusAnim;
    const s = a ? this.targetScale() : this.cam.s;
    const lat = a ? (a.latlng?.[0] ?? latOfY(a.to.y)) : latOfY(this.cam.y);
    const lng = a ? (a.latlng?.[1] ?? a.to.x / RAD) : this.cam.x / RAD;
    const home = sHome(this.frame());
    // A fit is never "home", as on the globe.
    const ratio = this.focusFit ? null : s / home;
    const state: ViewState = { lat, lng, kmPerPx: handOnKmPerPx(ratio, kmPerPxMap(s, Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)))) };
    if (a?.latlng) state.focus = a.latlng;
    return state;
  }

  /** Gives the satellite image on screen to the next view (see SatelliteTexture.handover). */
  takeTexture(): TextureHandover | null {
    return this.satellite.handover();
  }

  /** The part of the screen that shows the map: the canvas rect, cut at the two map edges. */
  surface(): Surface {
    const r = this.canvasRect;
    const { cy } = freeRect(this.frame());
    const top = cy - (Math.PI - this.cam.y) * this.cam.s;
    const bottom = cy + (this.cam.y + Math.PI) * this.cam.s;
    return { kind: 'rect', x0: r.left, x1: r.right, y0: r.top + Math.max(0, top), y1: r.top + Math.min(r.height, bottom) };
  }

  /** The ground scale at lat over the ground scale at the view centre: Mercator grows by 1/cos(lat). */
  groundScale(lat: number): number {
    return Math.cos(latOfY(this.cam.y) * RAD) / Math.cos(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD);
  }

  /** The canvas rect in client px (cached; refreshed on resize, scroll and each rendered frame). */
  rect(): DOMRect {
    return this.canvasRect;
  }

  /** Label point of the selected country, where the leader lines start. Null with no selection. */
  selectedAnchor(): [number, number] | null {
    return this.selectedIndex >= 0 ? this.labels.labelOf(this.selectedIndex).latlng : null;
  }

  /** Current raise of the selected country in earth radii (0..FlatMap.RAISE), for project(). */
  selectedLift(): number {
    return this.slotAnimator.liftAt(this.selectedIndex);
  }

  /** Current raise of any country in earth radii (0..FlatMap.RAISE), for project(). */
  liftOf(id: CountryId): number {
    return this.slotAnimator.liftAt(this.indexOf(id));
  }

  /** Label point [lat, lng] of a country: the centroid of its largest polygon, kept inside the shape. */
  labelPoint(id: CountryId): [number, number] | null {
    const i = this.indexOf(id);
    return i < 0 ? null : this.labels.labelOf(i).latlng;
  }

  /** Approximate on-screen radius in CSS px of the country's main polygon at its label point. */
  screenRadius(id: CountryId): number {
    const i = this.indexOf(id);
    if (i < 0) return 0;
    const l = this.labels.labelOf(i);
    return this.arcPx(l.radius, l.latlng[0]);
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
    const slots = this.slotGeometries.flatMap((g) => [g.triangles, g.lines]);
    for (const g of [this.landGeometry, this.lineGeometry, ...slots, this.oceanGeometry, this.graticuleGeometry, this.edgeGeometry]) g.dispose();
    for (const m of [this.landMaterial, this.lineMaterial, ...this.outlineMaterials, this.oceanMaterial, this.graticuleMaterial, this.edgeMaterial])
      m.dispose();
    this.blurPass.dispose();
    this.satellite.dispose();
    // Free the GL context now: a browser keeps only a few, and a view switch makes a new one.
    this.renderer.forceContextLoss();
    this.renderer.dispose();
    this.canvas.remove();
  }

  // ---- style ----

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
    this.oceanMaterial.uniforms.uColor.value.copy(rgb(p.ocean));
    const e = this.edgeMaterial.uniforms;
    e.uColor.value.copy(rgb(p.limb));
    e.uAlpha.value = p.limbAlpha;
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

  private readonly tick = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(50, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    const reduced = this.reducedMotion.matches;
    let moved = false;
    let inertia = false;
    // ResizeObserver misses a DPR change at the same CSS size (window moved to another screen).
    if ((window.devicePixelRatio || 1) !== this.dpr) this.resize();

    const sTarget = this.targetScale();
    const upgrade = {
      idleMs: now - this.lastActivity,
      moving: this.focusAnim !== null || this.controls.isDragging,
      zoomedOrSelected: this.zoomedOrSelected,
      // The larger of the two scales: a selection starts the download while the map still zooms in.
      needWidth: mapNeededTextureWidth(Math.max(this.cam.s, sTarget), this.renderer.getPixelRatio(), latOfY(this.cam.y)),
    };
    if (this.satellite.tick(now, dt, { satellite: this.mapStyle === 'satellite', upgrade })) this.needsRender = true;

    if (this.focusAnim) {
      const a = this.focusAnim;
      const t = Math.min(1, (now - a.start) / FOCUS_MS);
      const to = { x: a.to.x, y: clampY(a.to.y, this.targetScale(), this.frame()) };
      const c = lerpCenter(a.from, to, easeInOut(t));
      this.cam = { ...this.cam, ...c };
      if (t >= 1) this.focusAnim = null;
      moved = true;
    } else if (this.controls.update(dt)) {
      moved = true;
      inertia = true;
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
    const f = this.frame();
    const want = this.targetScale();
    let s = this.cam.s;
    if (Math.abs(want / s - 1) > 1e-4) {
      s += (want - s) * k;
      framing = true;
    } else s = want;
    let cam: MapCamera = this.zoomAnchor ? anchorCamera(this.zoomAnchor, s, f) : { ...this.cam, s };
    cam = { ...cam, y: clampY(cam.y, s, f) };
    if (!framing) this.zoomAnchor = null;
    if (framing || cam.x !== this.cam.x || cam.y !== this.cam.y || cam.s !== this.cam.s) {
      this.cam = cam;
      this.updateCamera();
      this.needsRender = true;
    }

    this.satellite.upload({
      dragging: this.controls.isDragging,
      focusAnim: this.focusAnim !== null,
      inertia,
      framing,
      spinning: false,
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
    const b = cameraBounds(this.cam, this.frame());
    this.camera.position.set(this.cam.x, this.cam.y, 5);
    this.camera.updateMatrixWorld();

    // The ocean plane and the edges span the canvas, cut to the map in y.
    const top = Math.min(Math.PI, b.top);
    const bottom = Math.max(-Math.PI, b.bottom);
    this.ocean.position.set((b.left + b.right) / 2, (top + bottom) / 2, OCEAN_Z);
    this.ocean.scale.set(b.right - b.left, Math.max(1e-6, top - bottom), 1);
    this.edges.position.set((b.left + b.right) / 2, 0, 0);
    this.edges.scale.set(b.right - b.left, 1, 1);

    // The copies of the world that the canvas shows.
    const offsets = copyOffsets(b.left, b.right, this.xMin, this.xMax);
    const active = this.slotAnimator.slots.some((s) => s.index >= 0);
    // Satellite at rest: the ocean plane carries the imagery, so the GPU skips the land mesh.
    const landOn = this.mapStyle !== 'satellite' || active;
    for (let i = 0; i < MAX_COPIES; i++) {
      const on = i < offsets.length;
      const x = on ? offsets[i] * 2 * Math.PI : 0;
      this.copies[i].visible = on;
      this.copies[i].position.x = x;
      this.overlayCopies[i].visible = on;
      this.overlayCopies[i].position.x = x;
      this.landMeshes[i].visible = landOn;
    }

    if (amount < 0.002) {
      r.setRenderTarget(null);
      r.setClearColor(this.clearColor, 1);
      r.clear();
      r.render(this.scene, this.camera);
      r.render(this.sharpScene, this.camera);
      return;
    }

    this.blurPass.render(r, () => r.render(this.scene, this.camera), amount, this.clearColor);

    // Active countries, sharp, in each copy.
    r.clearDepth();
    const per = 1 + NUDGES.length;
    this.slotAnimator.slots.forEach((s, i) => {
      const on = s.index >= 0 && s.t > 0;
      for (const group of this.overlayCopies)
        for (let j = 0; j < per; j++) group.children[i * per + j].visible = on;
      if (!on) return;
      const g = this.slotGeometries[i];
      const tr = this.triangleRanges[s.index];
      const lr = this.lineRanges[s.index];
      g.triangles.setDrawRange(tr.start, tr.count);
      g.lines.setDrawRange(lr.start, lr.count);
    });
    r.render(this.overlay, this.camera);
    r.render(this.sharpScene, this.camera);
  }

  /** A ring around a selected country too small to see at the current zoom. */
  private updateMarker(): void {
    const i = this.selectedIndex;
    let show = false;
    if (i >= 0) {
      const { lat, lng } = capCentre(this.caps[i]);
      if (this.arcPx(this.capRadius[i], lat) < MARKER_PX) {
        const p = toScreen(lat, lng, this.cam, this.frame(), LIFT_PX);
        this.marker.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        show = true;
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
    // A new size changes the limits: keep the scale and y inside them. The frame loop eases s to the new target.
    const f = this.frame();
    const s = Math.min(sMax(f), Math.max(sMin(f), this.cam.s));
    this.cam = { x: this.cam.x, y: clampY(this.cam.y, s, f), s };
    this.updateCamera();
    this.needsRender = true;
    this.render(); // avoid one blank frame after the canvas resizes
  }

  // ---- framing ----

  private frame(): MapFrame {
    return { width: this.width, height: this.height, insets: this.insets, focal: this.focal() };
  }

  /** The focal length of the globe camera in CSS px: the zoom limits of the map follow the globe. */
  private focal(): number {
    return this.height / 2 / Math.tan((FOV * Math.PI) / 360);
  }

  /** The scale that the framing eases to. A focus fit uses the free rect of this frame. */
  private targetScale(): number {
    const f = this.frame();
    return targetScale(f, { zoomRatio: this.zoomRatio, fit: this.focusFit ? fitScale(this.focusFit, f) : null });
  }

  /** The orthographic frustum for the scale and the free rect. The camera position follows cam in draw(). */
  private updateCamera(): void {
    const { cx, cy } = freeRect(this.frame());
    const s = this.cam.s;
    const c = this.camera;
    c.left = -cx / s;
    c.right = (this.width - cx) / s;
    c.top = cy / s;
    c.bottom = -(this.height - cy) / s;
    c.updateProjectionMatrix();
    this.liftWorld.value = LIFT_PX / s;
  }

  private zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const f = this.frame();
    const home = sHome(f);
    // A manual zoom ends the zoom that fits the selected country. Start from where it is.
    if (this.focusFit !== null) {
      this.zoomRatio = this.targetScale() / home;
      this.focusFit = null;
    }
    this.zoomRatio = Math.min(sMax(f) / home, Math.max(sMin(f) / home, this.zoomRatio / factor));
    if (clientX !== undefined && clientY !== undefined) {
      // Keep the world point under the pointer while the scale eases.
      const px = clientX - this.canvasRect.left;
      const py = clientY - this.canvasRect.top;
      const { cx, cy } = freeRect(f);
      this.zoomAnchor = { wx: this.cam.x + (px - cx) / this.cam.s, wy: this.cam.y - (py - cy) / this.cam.s, px, py };
    }
    this.zoomedOrSelected = true;
    this.needsRender = true;
  }

  // ---- picking ----

  /** CSS px of an arc of r radians at lat: Mercator grows by 1/cos(lat). */
  private arcPx(r: number, lat: number): number {
    return (r * this.cam.s) / Math.cos(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * RAD);
  }

  /** A square ring round the bounding cap, for a country with no main polygon. */
  private capRing(i: number): number[][][] {
    const { lat, lng } = capCentre(this.caps[i]);
    const r = this.capRadius[i] / RAD;
    const dl = r / Math.max(0.05, Math.cos(lat * RAD));
    return [[[lng - dl, lat - r], [lng + dl, lat + r]]];
  }

  private pickAt(clientX: number, clientY: number): number {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const f = this.frame();
    const at = (amount: number): number => {
      // A raised cap shows amount · LIFT_PX higher: its ground point is that far below the pointer.
      const ll = fromScreen(x, y + amount * LIFT_PX, this.cam, f);
      if (!ll || Math.abs(ll.lat) > MAX_LAT) return -1;
      return this.picker.pick(ll.lng, ll.lat);
    };
    return pickWithSlop({
      slots: this.slotAnimator.amounts(),
      capRadius: this.capRadius,
      smallCap: SMALL_CAP,
      at,
      near: () => this.nearSmallCountry(x, y),
    });
  }

  /** The small country whose bounding cap is nearest the canvas point and within PICK_SLOP_PX, or -1. */
  private nearSmallCountry(x: number, y: number): number {
    const f = this.frame();
    const candidates = this.smallCountries.map((i) => {
      const { lat, lng } = capCentre(this.caps[i]);
      const p = toScreen(lat, lng, this.cam, f);
      return { index: i, x: p.x, y: p.y, radiusPx: this.arcPx(this.capRadius[i], lat) };
    });
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
