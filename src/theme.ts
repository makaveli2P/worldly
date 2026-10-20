// Swiss palettes for the UI and the globe. styles.css mirrors the UI tokens as CSS custom
// properties on :root[data-theme=light|dark]. The globe reads its colours only from here.

export type ThemeName = 'light' | 'dark';
export type MapStyle = 'satellite' | 'atlas';

/** UI tokens. */
export interface UiTokens {
  paper: string;
  panel: string;
  ink: string;
  rule: string; // hairlines
  muted: string;
  accent: string;
}

/** Globe colours for one theme and one map style. Alpha values are 0..1. */
export interface GlobePalette {
  paper: string; // canvas background, and the colour the blurred globe recedes toward in atlas
  ocean: string; // atlas: ocean fill. satellite: the fill until the texture loads
  land: string; // atlas only: land fill (satellite land shows the texture)
  border: string;
  borderAlpha: number;
  graticule: string;
  graticuleAlpha: number;
  limb: string; // 1px outline of the globe
  limbAlpha: number;
  hoverCap: string; // atlas only (satellite caps show the texture)
  hoverWall: string;
  hoverLine: string;
  selectedCap: string; // atlas only
  selectedWall: string;
  selectedLine: string;
  /** Blur treatment of the rest of the globe while a country is active. */
  recede: string;
  recedeAmount: number;
  desaturate: number;
}

const RED_LIGHT = '#E5361B';
const RED_DARK = '#F24B2F'; // 5.3:1 on #0E0E0E

export const ui: Record<ThemeName, UiTokens> = {
  light: { paper: '#F4F4F1', panel: '#FFFFFF', ink: '#111111', rule: '#DCDCD7', muted: '#5C5C58', accent: RED_LIGHT },
  dark: { paper: '#0E0E0E', panel: '#161616', ink: '#F2F2EE', rule: '#2A2A2A', muted: '#9A9A94', accent: RED_DARK },
};

export const globePalettes: Record<ThemeName, Record<MapStyle, GlobePalette>> = {
  light: {
    atlas: {
      paper: ui.light.paper,
      ocean: '#FFFFFF',
      land: '#D9D9D4',
      border: '#FFFFFF',
      borderAlpha: 1,
      graticule: '#111111',
      graticuleAlpha: 0.09,
      limb: '#111111',
      limbAlpha: 1,
      hoverCap: '#C6C6C0',
      hoverWall: '#A9A9A3',
      hoverLine: '#A9A9A3',
      selectedCap: RED_LIGHT,
      selectedWall: '#9C2410',
      selectedLine: RED_LIGHT,
      recede: ui.light.paper,
      recedeAmount: 0.1,
      desaturate: 0.3,
    },
    satellite: {
      paper: ui.light.paper,
      ocean: '#13202E',
      land: '#13202E',
      border: '#FFFFFF',
      borderAlpha: 0.45,
      graticule: '#FFFFFF',
      graticuleAlpha: 0.1,
      limb: '#111111',
      limbAlpha: 0.6,
      hoverCap: '#FFFFFF',
      hoverWall: '#D9D9D4',
      hoverLine: '#FFFFFF',
      selectedCap: RED_LIGHT,
      selectedWall: RED_LIGHT,
      selectedLine: RED_LIGHT,
      recede: '#000000',
      recedeAmount: 0.24,
      desaturate: 0.35,
    },
  },
  dark: {
    atlas: {
      paper: ui.dark.paper,
      ocean: '#161616',
      land: '#2A2A2A',
      border: '#4A4A47',
      borderAlpha: 1,
      graticule: '#F2F2EE',
      graticuleAlpha: 0.07,
      limb: '#F2F2EE',
      limbAlpha: 0.55,
      hoverCap: '#3D3D3B',
      hoverWall: '#202020',
      hoverLine: '#6A6A66',
      selectedCap: RED_DARK,
      selectedWall: '#8E2312',
      selectedLine: RED_DARK,
      recede: ui.dark.paper,
      recedeAmount: 0.1,
      desaturate: 0.3,
    },
    satellite: {
      paper: ui.dark.paper,
      ocean: '#0B1520',
      land: '#0B1520',
      border: '#FFFFFF',
      borderAlpha: 0.4,
      graticule: '#FFFFFF',
      graticuleAlpha: 0.08,
      limb: '#F2F2EE',
      limbAlpha: 0.18,
      hoverCap: '#FFFFFF',
      hoverWall: '#BDBDB8',
      hoverLine: '#FFFFFF',
      selectedCap: RED_DARK,
      selectedWall: RED_DARK,
      selectedLine: RED_DARK,
      recede: '#000000',
      recedeAmount: 0.3,
      desaturate: 0.35,
    },
  },
};

/** The theme from the OS setting. */
export function systemTheme(): ThemeName {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Light tokens, kept for older imports. */
export const theme = { ...ui.light, background: ui.light.paper } as const;
