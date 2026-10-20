// Page frame: globe container, label overlay, header (brand, search slot, map style and
// theme toggles), first-use hint, instrument readout and the panel layer.

import { h, svgIcon } from './dom';
import { getLayout, isMobileViewport } from './layout';
import { Prefs, type MapStyle, type ThemeName } from './prefs';
import { Readout, type ReadoutView } from './readout';

export type { MapStyle, ThemeName } from './prefs';
export type { ReadoutView } from './readout';

/** Dispatch on window after the first drag, click or tap; the hint fades out. */
export const INTERACTED_EVENT = 'worldly:interacted';

/** Space the readout keeps clear under the globe on desktop. */
const READOUT_CLEARANCE = 48;

export interface Shell {
  globe: HTMLElement;
  /** Full-viewport layer above the globe and below the panels: labels and leader lines. */
  overlay: HTMLElement;
  ui: HTMLElement;
  readout: { update(view: ReadoutView, selectedId: string | null): void };
  panelInsets(): { left: number; right: number; top: number; bottom: number };
  /** Screen rects of the open panels (mobile: the sheet is "details"). Null when closed. */
  panelRects(): { details: DOMRect | null; news: DOMRect | null };
  isMobile(): boolean;
  mapStyle(): MapStyle;
  setMapStyle(s: MapStyle): void;
  onMapStyleChange(cb: (s: MapStyle) => void): () => void;
  theme(): ThemeName;
  setTheme(t: ThemeName): void;
  onThemeChange(cb: (t: ThemeName) => void): () => void;
}

const SUN = 'M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM8 0.5v2M8 13.5v2M0.5 8h2M13.5 8h2M2.7 2.7l1.4 1.4M11.9 11.9l1.4 1.4M2.7 13.3l1.4-1.4M11.9 4.1l1.4-1.4';
const MOON = 'M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7Z';

export function mountShell(app: HTMLElement): Shell {
  const prefs = new Prefs();

  const globe = h('div', { class: 'globe' });
  const overlay = h('div', { class: 'overlay', 'aria-hidden': 'true' });

  // ---- map style: a two-option radio group ----
  const styles: [MapStyle, string][] = [
    ['satellite', 'Satellite'],
    ['atlas', 'Atlas'],
  ];
  const styleButtons = styles.map(([value, label]) => {
    const b = h('button', { type: 'button', role: 'radio', 'data-style': value }, label);
    b.addEventListener('click', () => prefs.setMapStyle(value));
    return b;
  });
  const styleGroup = h('div', { class: 'toggle', role: 'radiogroup', 'aria-label': 'Map style' }, styleButtons);
  styleGroup.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const next: MapStyle = prefs.mapStyle === 'satellite' ? 'atlas' : 'satellite';
    prefs.setMapStyle(next);
    styleButtons[next === 'satellite' ? 0 : 1].focus();
  });
  const syncStyle = (s: MapStyle) => {
    styleButtons.forEach((b) => {
      const on = b.dataset.style === s;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };

  // ---- theme: one icon button ----
  const themeButton = h('button', { type: 'button', class: 'theme-toggle' });
  themeButton.addEventListener('click', () => prefs.setTheme(prefs.theme === 'dark' ? 'light' : 'dark'));
  const syncTheme = (t: ThemeName) => {
    // The icon shows the theme a click gives.
    const next = t === 'dark' ? 'light' : 'dark';
    themeButton.setAttribute('aria-label', `Use ${next} theme`);
    themeButton.title = `Use ${next} theme`;
    themeButton.replaceChildren(svgIcon(next === 'dark' ? MOON : SUN, 16));
  };

  const header = h(
    'header',
    { class: 'bar' },
    h('h1', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), 'Worldly'),
    h('div', { class: 'search-slot', 'data-search-slot': true }),
    h('div', { class: 'bar-tools' }, styleGroup, themeButton),
  );

  const touch = window.matchMedia('(hover: none)').matches;
  const hint = h('p', { class: 'hint' }, touch ? 'Tap a country · Double-tap to reset' : 'Drag to spin · Click a country · Double-click to reset');
  const readout = new Readout();
  const ui = h('div', { class: 'ui', 'data-ui-host': true }, header, hint, readout.el);
  app.append(globe, overlay, ui);

  const layout = getLayout(ui);
  syncStyle(prefs.mapStyle);
  syncTheme(prefs.theme);
  prefs.onMapStyleChange(syncStyle);
  prefs.onThemeChange(syncTheme);
  window.addEventListener(INTERACTED_EVENT, () => hint.setAttribute('data-hidden', ''), { once: true });

  return {
    globe,
    overlay,
    ui,
    readout,
    panelInsets: () => {
      const insets = layout.insets();
      insets.top = header.offsetHeight;
      if (!isMobileViewport()) insets.bottom = Math.max(insets.bottom, READOUT_CLEARANCE);
      return insets;
    },
    panelRects: () => layout.rects(),
    isMobile: isMobileViewport,
    mapStyle: () => prefs.mapStyle,
    setMapStyle: (s) => prefs.setMapStyle(s),
    onMapStyleChange: (cb) => prefs.onMapStyleChange(cb),
    theme: () => prefs.theme,
    setTheme: (t) => prefs.setTheme(t),
    onThemeChange: (cb) => prefs.onThemeChange(cb),
  };
}
