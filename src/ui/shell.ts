// Page frame: globe container, label overlay, header (brand, search slot, view, map style and
// theme toggles), first-use hint, instrument readout and the panel layer.

import { h, svgIcon } from './dom';
import { getLayout, isMobileViewport } from './layout';
import { Prefs, type MapStyle, type ThemeName, type ViewKind } from './prefs';
import { Readout, type ReadoutView } from './readout';

export type { MapStyle, ThemeName, ViewKind } from './prefs';
export type { ReadoutView } from './readout';

/** Dispatch on window after the first drag, click or tap; the hint fades out. */
export const INTERACTED_EVENT = 'worldly:interacted';
export const RESET_EVENT = 'worldly:reset';

/** Space the readout keeps clear under the globe on desktop. */
const READOUT_CLEARANCE = 48;

export interface Shell {
  globe: HTMLElement;
  /** Full-viewport layer above the globe and below the panels: labels and leader lines. */
  overlay: HTMLElement;
  ui: HTMLElement;
  /** Header slot for the breaking-news chip: grid column 2 on desktop, a third header row on mobile. */
  breakingSlot: HTMLElement;
  readout: { update(view: ReadoutView, selectedId: string | null): void };
  panelInsets(): { left: number; right: number; top: number; bottom: number };
  /** Screen rects of the open panels (mobile: the sheet is "details"). Null when closed. */
  panelRects(): { details: DOMRect | null; news: DOMRect | null };
  /** The readout and the hint text while it shows, in client px. The overlay keeps map labels out of them. */
  chromeRects(): DOMRect[];
  isMobile(): boolean;
  mapStyle(): MapStyle;
  setMapStyle(s: MapStyle): void;
  onMapStyleChange(cb: (s: MapStyle) => void): () => void;
  theme(): ThemeName;
  setTheme(t: ThemeName): void;
  onThemeChange(cb: (t: ThemeName) => void): () => void;
  view(): ViewKind;
  setView(v: ViewKind): void;
  onViewChange(cb: (v: ViewKind) => void): () => void;
}

const SUN = 'M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7ZM8 0.5v2M8 13.5v2M0.5 8h2M13.5 8h2M2.7 2.7l1.4 1.4M11.9 11.9l1.4 1.4M2.7 13.3l1.4-1.4M11.9 4.1l1.4-1.4';
const MOON = 'M13.5 10.2A6 6 0 0 1 5.8 2.5a6 6 0 1 0 7.7 7.7Z';
// The view glyphs: a globe with a meridian and the equator, and a folded map.
const GLOBE = 'M8 1.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13ZM1.5 8h13M8 1.5c-3.2 3.6-3.2 9.4 0 13M8 1.5c3.2 3.6 3.2 9.4 0 13';
const MAP = 'M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5ZM5.5 2v10.5M10.5 3.5V14';

const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * A radio group of buttons in the header. The arrow keys move the choice; only the checked button is
 * in the Tab order. An option with an icon shows only the icon (src/styles.css); the button keeps the
 * text as its name (aria-label and title).
 */
function radioToggle<T extends string>(
  label: string,
  options: [T, string, string?][],
  get: () => T,
  set: (v: T) => void,
  onChange: (cb: (v: T) => void) => void,
): HTMLElement {
  const buttons = options.map(([value, text, icon]) => {
    const b = h('button', { type: 'button', role: 'radio', 'data-value': value }, icon ? [svgIcon(icon, 16), h('span', { class: 'toggle-text' }, text)] : text);
    if (icon) {
      b.setAttribute('aria-label', text);
      b.title = text;
    }
    b.addEventListener('click', () => set(value));
    return b;
  });
  const group = h('div', { class: 'toggle', role: 'radiogroup', 'aria-label': label }, buttons);
  group.addEventListener('keydown', (e) => {
    if (!ARROWS.includes(e.key)) return;
    e.preventDefault();
    const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
    const i = options.findIndex(([v]) => v === get());
    const next = (i + step + options.length) % options.length;
    set(options[next][0]);
    buttons[next].focus();
  });
  const sync = (v: T) => {
    buttons.forEach((b) => {
      const on = b.dataset.value === v;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
  };
  sync(get());
  onChange(sync);
  return group;
}

export function mountShell(app: HTMLElement): Shell {
  const prefs = new Prefs();

  const globe = h('div', { class: 'globe' });
  const overlay = h('div', { class: 'overlay', 'aria-hidden': 'true' });

  // ---- view and map style: two-option radio groups ----
  const viewGroup = radioToggle<ViewKind>(
    'View',
    [
      ['globe', 'Globe', GLOBE],
      ['map', 'Map', MAP],
    ],
    () => prefs.view,
    (v) => prefs.setView(v),
    (cb) => prefs.onViewChange(cb),
  );
  viewGroup.classList.add('view-toggle');
  const styleGroup = radioToggle<MapStyle>(
    'Map style',
    [
      ['satellite', 'Satellite'],
      ['atlas', 'Atlas'],
    ],
    () => prefs.mapStyle,
    (s) => prefs.setMapStyle(s),
    (cb) => prefs.onMapStyleChange(cb),
  );

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

  // Empty until an alert comes. Tab order: brand, search, breaking, view, style, theme.
  const breakingSlot = h('div', { class: 'brk-slot', 'data-breaking-slot': true });

  const header = h(
    'header',
    { class: 'bar' },
    h(
      'h1',
      { class: 'brand' },
      h(
        'a',
        { class: 'brand-link', href: '/', title: 'Reset the view' },
        h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
        'Worldly',
      ),
    ),
    h('div', { class: 'search-slot', 'data-search-slot': true }),
    breakingSlot,
    h('div', { class: 'bar-tools' }, viewGroup, styleGroup, themeButton),
  );

  // A plain click on the wordmark resets the app in place; modified clicks open "/" as usual.
  header.querySelector('.brand-link')?.addEventListener('click', (e) => {
    const me = e as MouseEvent;
    if (me.button !== 0 || me.metaKey || me.ctrlKey || me.shiftKey || me.altKey) return;
    e.preventDefault();
    window.dispatchEvent(new Event(RESET_EVENT));
  });

  const touch = window.matchMedia('(hover: none)').matches;
  const hintText = (v: ViewKind) =>
    touch ? 'Tap a country · Double-tap to reset' : `Drag to ${v === 'map' ? 'pan' : 'spin'} · Click a country · Double-click to reset`;
  const hint = h('p', { class: 'hint' }, hintText(prefs.view));
  prefs.onViewChange((v) => (hint.textContent = hintText(v)));
  const readout = new Readout();
  const ui = h('div', { class: 'ui', 'data-ui-host': true }, header, hint, readout.el);
  app.append(globe, overlay, ui);

  const layout = getLayout(ui);
  // The plates come before the readout and its credit links in the Tab order, as on the screen.
  // .panels has z-index 2, so the change of DOM order does not change the paint order.
  ui.append(readout.el);
  // The credit wraps to 2 or 3 lines, so the readout height changes with the width.
  // The satellite hint sits above the readout through --readout-h (src/styles.css).
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => ui.style.setProperty('--readout-h', `${readout.el.offsetHeight}px`)).observe(readout.el);
  }
  syncTheme(prefs.theme);
  prefs.onThemeChange(syncTheme);
  window.addEventListener(INTERACTED_EVENT, () => hint.setAttribute('data-hidden', ''), { once: true });

  return {
    globe,
    overlay,
    ui,
    breakingSlot,
    readout,
    panelInsets: () => {
      const insets = layout.insets();
      insets.top = header.offsetHeight;
      if (!isMobileViewport()) insets.bottom = Math.max(insets.bottom, READOUT_CLEARANCE);
      return insets;
    },
    panelRects: () => layout.rects(),
    chromeRects: () => {
      const out = [readout.el.getBoundingClientRect()];
      if (!hint.hasAttribute('data-hidden')) {
        // The text only: the hint element spans the full width.
        const range = document.createRange();
        range.selectNodeContents(hint);
        out.push(range.getBoundingClientRect());
      }
      return out;
    },
    isMobile: isMobileViewport,
    mapStyle: () => prefs.mapStyle,
    setMapStyle: (s) => prefs.setMapStyle(s),
    onMapStyleChange: (cb) => prefs.onMapStyleChange(cb),
    theme: () => prefs.theme,
    setTheme: (t) => prefs.setTheme(t),
    onThemeChange: (cb) => prefs.onThemeChange(cb),
    view: () => prefs.view,
    setView: (v) => prefs.setView(v),
    onViewChange: (cb) => prefs.onViewChange(cb),
  };
}
