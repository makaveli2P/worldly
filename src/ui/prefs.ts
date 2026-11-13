// Theme and map style preferences. index.html sets both on <html> before first paint;
// this module keeps them in sync, persists the visitor's choices and tells listeners.
// With no saved choice, the page uses the dark theme and the Atlas style.

import type { MapStyle, ThemeName } from '../theme';

export type { MapStyle, ThemeName };

const STYLE_KEY = 'worldly:style';
const THEME_KEY = 'worldly:theme';
// The browser bar matches the header, which uses the panel colour. index.html has the same values.
const META_COLOR: Record<ThemeName, string> = { light: '#FFFFFF', dark: '#1A1A1A' };

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
  private readonly styleListeners = new Set<Listener<MapStyle>>();
  private readonly themeListeners = new Set<Listener<ThemeName>>();

  constructor() {
    this.styleValue = read(STYLE_KEY) === 'satellite' ? 'satellite' : 'atlas';
    this.themeValue = read(THEME_KEY) === 'light' ? 'light' : 'dark';
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

  /** The visitor's choice: it persists. */
  setTheme(t: ThemeName): void {
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
