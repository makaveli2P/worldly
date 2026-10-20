// Theme and map style preferences. index.html sets both on <html> before first paint;
// this module keeps them in sync, persists overrides and tells listeners.

import type { MapStyle, ThemeName } from '../theme';

export type { MapStyle, ThemeName };

const STYLE_KEY = 'worldly:style';
const THEME_KEY = 'worldly:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const META_COLOR: Record<ThemeName, string> = { light: '#F4F4F1', dark: '#0E0E0E' };

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the choice lasts for this visit only.
  }
}

type Listener<T> = (value: T) => void;

export class Prefs {
  private styleValue: MapStyle;
  private themeValue: ThemeName;
  private themeOverride: boolean;
  private readonly styleListeners = new Set<Listener<MapStyle>>();
  private readonly themeListeners = new Set<Listener<ThemeName>>();

  constructor() {
    this.styleValue = read(STYLE_KEY) === 'atlas' ? 'atlas' : 'satellite';
    const saved = read(THEME_KEY);
    this.themeOverride = saved === 'light' || saved === 'dark';
    const media = window.matchMedia(DARK_QUERY);
    this.themeValue = this.themeOverride ? (saved as ThemeName) : media.matches ? 'dark' : 'light';
    // Without an override, the page follows the system setting live.
    media.addEventListener('change', (e) => {
      if (!this.themeOverride) this.applyTheme(e.matches ? 'dark' : 'light');
    });
    this.applyDom();
  }

  get mapStyle(): MapStyle {
    return this.styleValue;
  }

  get theme(): ThemeName {
    return this.themeValue;
  }

  setMapStyle(s: MapStyle): void {
    write(STYLE_KEY, s);
    if (s === this.styleValue) return;
    this.styleValue = s;
    this.applyDom();
    for (const cb of this.styleListeners) cb(s);
  }

  /** An explicit choice: it overrides the system setting and persists. */
  setTheme(t: ThemeName): void {
    this.themeOverride = true;
    write(THEME_KEY, t);
    this.applyTheme(t);
  }

  onMapStyleChange(cb: Listener<MapStyle>): () => void {
    this.styleListeners.add(cb);
    return () => this.styleListeners.delete(cb);
  }

  onThemeChange(cb: Listener<ThemeName>): () => void {
    this.themeListeners.add(cb);
    return () => this.themeListeners.delete(cb);
  }

  private applyTheme(t: ThemeName): void {
    if (t === this.themeValue) return;
    this.themeValue = t;
    this.applyDom();
    for (const cb of this.themeListeners) cb(t);
  }

  private applyDom(): void {
    const root = document.documentElement;
    root.dataset.theme = this.themeValue;
    root.dataset.style = this.styleValue;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[this.themeValue]);
  }
}
