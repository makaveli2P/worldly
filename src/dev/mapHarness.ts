// DEV only: mounts the flat map alone, for checks in a browser. Open http://localhost:5173/dev/map.html.
// The build does not contain it: the build input is index.html only.
//
// Query string:
//   style=atlas|satellite   theme=dark|light   sel=FRA (select a country, no focus)   focus=1 (also focus it)
//   insets=left,right,top,bottom (CSS px)      lat=..&lng=..&km=.. (the initial state; km = km per CSS px)
// window.__map is the FlatMap. window.__log holds the onHover and onSelect events.

import { buildLabelsFile, worldFeatures, type WorldTopology } from '../data/precompute';
import { FlatMap } from '../map';
import type { MapStyle, ThemeName } from '../theme';
import type { CountryId } from '../types';
import type { Insets, ViewState } from '../view/types';

const q = new URLSearchParams(location.search);
const container = document.getElementById('map') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;
const events: string[] = [];
const log = (line: string) => {
  events.push(line);
  logEl.textContent = events.slice(-4).join('\n');
  console.log('[map]', line);
};

async function start(): Promise<void> {
  const topo = (await (await fetch('/data/world.json')).json()) as WorldTopology;
  const features = worldFeatures(topo);
  const inverted = new Set(buildLabelsFile(topo).inverted);
  const [l, r, t, b] = (q.get('insets') ?? '0,0,0,0').split(',').map(Number);
  const insets: Insets = { left: l || 0, right: r || 0, top: t || 0, bottom: b || 0 };
  Object.assign((document.getElementById('insets') as HTMLElement).style, {
    left: `${insets.left}px`,
    right: `${insets.right}px`,
    top: `${insets.top}px`,
    bottom: `${insets.bottom}px`,
  });
  const lat = q.get('lat');
  const lng = q.get('lng');
  const state: ViewState | undefined =
    lat !== null && lng !== null ? { lat: Number(lat), lng: Number(lng), kmPerPx: q.get('km') ? Number(q.get('km')) : null } : undefined;
  const selected = (q.get('sel') as CountryId | null) ?? null;
  const map = new FlatMap({
    container,
    features,
    inverted,
    mapStyle: (q.get('style') as MapStyle | null) ?? 'atlas',
    theme: (q.get('theme') as ThemeName | null) ?? 'dark',
    initial: { insets, state, selected },
    onHover: (id, screen) => log(`hover ${id ?? '-'} ${screen ? `${Math.round(screen.x)},${Math.round(screen.y)}` : ''}`),
    onSelect: (id) => {
      log(`select ${id ?? '-'}`);
      map.setSelected(id);
      const p = id ? map.labelPoint(id) : null;
      if (p) map.focus(p);
    },
    onReset: () => log('reset'),
  });
  if (selected && q.get('focus')) {
    const p = map.labelPoint(selected);
    if (p) map.focus(p);
  }
  Object.assign(window, { __map: map, __log: events });
}

void start();
