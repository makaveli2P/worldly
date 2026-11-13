// The view host: one stable WorldView for src/main.ts and the overlay. It forwards each call to the
// active view (the globe or the flat map) and switches between them with a short crossfade.
// It keeps its own copy of the selection, the preview, the insets, the style and the theme, and gives
// them to a new view in its first frame. The overlay and the readout subscribe to the host one time.

import { Globe, type GlobeView, type ProjectedPoint } from '../globe/Globe';
import type { MapStyle, ThemeName } from '../theme';
import type { CountryId } from '../types';
import type { Insets, Surface, TextureHandover, ViewKind, ViewOptions, ViewState, WorldView } from './types';

/** A view class: Globe or FlatMap. */
export type ViewConstructor = new (opts: ViewOptions) => WorldView;

/** The time that the new view takes to fade in. The old view goes after this time. */
export const FADE_MS = 180;
const DISPOSE_MS = 200;

let mapModule: Promise<ViewConstructor> | null = null;

/**
 * Loads the flat map chunk one time. Only an import() reaches src/map, so a globe visitor does not
 * download it. A failed load is not cached: the next call tries again.
 */
export function loadMap(): Promise<ViewConstructor> {
  mapModule ??= import('../map').then(
    (m): ViewConstructor => m.FlatMap,
    (err: unknown) => {
      mapModule = null;
      throw err;
    },
  );
  return mapModule;
}

/** The constructors for each view. Tests give fakes, so they need no WebGL. */
export interface ViewSources {
  globe: () => ViewConstructor | Promise<ViewConstructor>;
  map: () => ViewConstructor | Promise<ViewConstructor>;
}

const defaultSources: ViewSources = {
  globe: () => Globe,
  map: loadMap,
};

export class ViewHost implements WorldView {
  private active: WorldView;
  /** The view before a switch, while the new view fades in. */
  private fading: WorldView | null = null;
  private fadeTimer = 0;
  private offFirstFrame: (() => void) | null = null;
  private unsubscribe: () => void;
  private seq = 0;
  private disposed = false;
  private readonly listeners = new Set<() => void>();
  private readonly base: ViewOptions;

  // The state that a new view gets.
  private selected: CountryId | null = null;
  private preview: CountryId | null = null;
  private insets: Insets | null = null;
  private mapStyle: MapStyle | undefined;
  private theme: ThemeName | undefined;

  /**
   * Makes the first view. The globe class loads with the page; the map class loads with import().
   * When the map does not load, the host shows the globe. The caller sets the toggle to host.kind.
   */
  static async create(kind: ViewKind, opts: ViewOptions, sources: ViewSources = defaultSources): Promise<ViewHost> {
    let Ctor: ViewConstructor;
    try {
      Ctor = await sources[kind]();
    } catch (err) {
      if (kind === 'globe') throw err;
      console.warn('[worldly] the map did not load; showing the globe', err);
      Ctor = await sources.globe();
    }
    return new ViewHost(new Ctor(opts), opts, sources);
  }

  private constructor(
    first: WorldView,
    opts: ViewOptions,
    private readonly sources: ViewSources,
  ) {
    this.active = first;
    // The boot texture is for the first view only. A later view gets the image on screen (takeTexture).
    this.base = { ...opts, firstTexture: undefined, initial: undefined };
    this.mapStyle = opts.mapStyle;
    this.theme = opts.theme;
    this.unsubscribe = first.onFrame(this.dispatch);
  }

  get kind(): ViewKind {
    return this.active.kind;
  }

  get canvas(): HTMLCanvasElement {
    return this.active.canvas;
  }

  /**
   * Shows the other view. The new view starts with the place, the zoom, the selection and the texture of
   * the old view, and fades in over it. A later call wins over a call that still waits for the map chunk.
   * The result is the kind on screen after the call: the old kind when the new view did not load or start.
   * It is null when a later call or dispose() replaced this call. The caller sets the toggle to the result.
   */
  async switchTo(kind: ViewKind): Promise<ViewKind | null> {
    const token = ++this.seq;
    // A second switch during a crossfade: the old view goes at once.
    this.endFade();
    if (kind === this.active.kind) return kind;
    let Ctor: ViewConstructor;
    try {
      Ctor = await this.sources[kind]();
    } catch (err) {
      console.warn(`[worldly] the ${kind} view did not load`, err);
      return token === this.seq && !this.disposed ? this.active.kind : null;
    }
    if (token !== this.seq || this.disposed) return null;

    // No await from here to the end: the old view gives its state and its texture to the new view in one task.
    const old = this.active;
    let next: WorldView;
    const state: ViewState = old.getState();
    const texture: TextureHandover | null = old.takeTexture();
    try {
      next = new Ctor({
        ...this.base,
        mapStyle: this.mapStyle,
        theme: this.theme,
        initial: {
          state,
          insets: this.insets ?? undefined,
          selected: this.selected,
          preview: this.preview,
          texture: texture ?? undefined,
        },
      });
    } catch (err) {
      // The old view keeps the image on the GPU, so it continues to show it.
      console.error(`[worldly] the ${kind} view failed to start`, err);
      return old.kind;
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    next.canvas.style.opacity = '0';
    next.canvas.style.transition = reduced ? '' : `opacity ${FADE_MS}ms`;

    this.unsubscribe();
    this.unsubscribe = next.onFrame(this.dispatch);
    this.active = next;
    this.fading = old;

    // The first frame of the new view: fade it in, then remove the old view.
    const off = next.onFrame(() => {
      off();
      this.offFirstFrame = null;
      next.canvas.style.opacity = '1';
      this.fadeTimer = window.setTimeout(() => this.endFade(), reduced ? 0 : DISPOSE_MS);
    });
    this.offFirstFrame = off;

    if (document.activeElement === old.canvas) next.focusCanvas();
    return kind;
  }

  // ---- WorldView: the state that a new view gets ----

  setSelected(id: CountryId | null): void {
    this.selected = id;
    this.active.setSelected(id);
  }

  setPreview(id: CountryId | null): void {
    this.preview = id;
    this.active.setPreview(id);
  }

  setViewportInsets(insets: Insets): void {
    this.insets = { ...insets };
    this.active.setViewportInsets(insets);
  }

  setMapStyle(style: MapStyle): void {
    this.mapStyle = style;
    this.active.setMapStyle(style);
  }

  setTheme(theme: ThemeName): void {
    this.theme = theme;
    this.active.setTheme(theme);
  }

  /** The view also clears its hover, preview and selection. */
  resetView(): void {
    this.selected = null;
    this.preview = null;
    this.active.resetView();
  }

  /** Calls cb after each rendered frame of the active view, also after a switch. Returns the unsubscribe. */
  onFrame(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // ---- WorldView: calls to the active view ----

  focus(latlng: [number, number]): void {
    this.active.focus(latlng);
  }

  focusCanvas(): void {
    this.active.focusCanvas();
  }

  project(lat: number, lng: number, lift?: number): ProjectedPoint {
    return this.active.project(lat, lng, lift);
  }

  getView(): GlobeView & { scaleDenominator?: number } {
    return this.active.getView();
  }

  rect(): DOMRect {
    return this.active.rect();
  }

  screenRadius(id: CountryId): number {
    return this.active.screenRadius(id);
  }

  selectedAnchor(): [number, number] | null {
    return this.active.selectedAnchor();
  }

  selectedLift(): number {
    return this.active.selectedLift?.() ?? 0;
  }

  labelPoint(id: CountryId): [number, number] | null {
    return this.active.labelPoint?.(id) ?? null;
  }

  liftOf(id: CountryId): number {
    return this.active.liftOf?.(id) ?? 0;
  }

  surface(): Surface | null {
    return this.active.surface?.() ?? null;
  }

  groundScale(lat: number): number {
    return this.active.groundScale?.(lat) ?? 1;
  }

  getState(): ViewState {
    return this.active.getState();
  }

  takeTexture(): TextureHandover | null {
    return this.active.takeTexture();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.seq++;
    this.endFade();
    this.unsubscribe();
    this.listeners.clear();
    this.active.dispose();
  }

  // ---- internals ----

  /** One listener on the active view calls each listener of the host. */
  private readonly dispatch = (): void => {
    for (const cb of this.listeners) {
      try {
        cb();
      } catch (err) {
        console.error('[worldly] frame listener failed', err);
      }
    }
  };

  /** Ends a crossfade now: the new view shows at full opacity, and the old view goes. */
  private endFade(): void {
    clearTimeout(this.fadeTimer);
    this.fadeTimer = 0;
    this.offFirstFrame?.();
    this.offFirstFrame = null;
    const old = this.fading;
    if (!old) return;
    this.fading = null;
    this.active.canvas.style.opacity = '1';
    old.dispose();
  }
}
