// Data types that the globe, the flat map and the view host share.

import type { GlobeOptions, GlobeView, ProjectedPoint } from '../globe/Globe';
import type { OverlayGlobe } from '../overlay/Overlay';
import type { MapStyle, ThemeName } from '../theme';
import type { CountryId } from '../types';

export type ViewKind = 'globe' | 'map';

/** The space that the panels cover on each side of the view, in CSS px. */
export interface Insets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * The place that a view shows, to carry it to the other view. kmPerPx is the ground scale at the centre;
 * null means "the home zoom of the target view".
 */
export interface ViewState {
  lat: number;
  lng: number;
  kmPerPx: number | null;
  /**
   * The focus point of a focus flight that did not end at the switch. lat/lng are then the end of the flight.
   * The next view calls focus() with it, so it fits the selected country there.
   */
  focus?: [number, number];
}

/** The part of the screen that shows the world, in client px. */
export type Surface = { kind: 'disc'; x: number; y: number; r: number } | { kind: 'rect'; x0: number; y0: number; x1: number; y1: number };

/**
 * A decoded satellite tier that one view gives to the next, so the next view does not decode it again.
 * The receiver owns the image after the handover.
 */
export interface TextureHandover {
  level: number;
  image: ImageBitmap | HTMLImageElement;
}

/** The state that a new view shows in its first frame, from the view before (src/view/ViewHost.ts). */
export interface ViewInitial {
  state?: ViewState;
  insets?: Insets;
  selected?: CountryId | null;
  preview?: CountryId | null;
  texture?: TextureHandover;
}

/** The options of a view (the globe and the flat map): GlobeOptions holds them all, with the first-frame state. */
export type ViewOptions = GlobeOptions;

/** The API that the globe and the flat map share. src/main.ts and the overlay use only this API. */
export interface WorldView extends OverlayGlobe {
  readonly kind: ViewKind;
  readonly canvas: HTMLCanvasElement;
  setSelected(id: CountryId | null): void;
  setPreview(id: CountryId | null): void;
  focus(latlng: [number, number]): void;
  resetView(): void;
  setViewportInsets(insets: Insets): void;
  setMapStyle(style: MapStyle): void;
  setTheme(theme: ThemeName): void;
  focusCanvas(): void;
  project(lat: number, lng: number, lift?: number): ProjectedPoint;
  getView(): GlobeView & { scaleDenominator?: number };
  rect(): DOMRect;
  screenRadius(id: CountryId): number;
  /** The part of the screen that shows the world. The globe has none: the overlay then uses its disc code. */
  surface?(): Surface | null;
  /** The ground scale at lat over the ground scale at the view centre. The globe has none (1). */
  groundScale?(lat: number): number;
  /** The place on view, for the next view. */
  getState(): ViewState;
  /** Gives the satellite image on screen to the next view, or null. */
  takeTexture(): TextureHandover | null;
  dispose(): void;
}
