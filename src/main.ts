// App wiring: loads the data, builds the globe and panels, and keeps the selection in sync.

import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { MultiPolygon, Polygon } from 'geojson';
import { Globe } from './globe/Globe';
import { CountrySearch, DetailsPanel, INTERACTED_EVENT, NewsPanel, PANELS_CHANGE_EVENT, Tooltip, mountShell } from './ui';
import type { CountryFeature, CountryId, CountryInfo, NewsResponse } from './types';

type WorldTopology = Topology<{ countries: GeometryCollection<{ id: CountryId; name: string }> }>;

const app = document.querySelector<HTMLElement>('#app')!;
const shell = mountShell(app);

const loader = document.createElement('p');
loader.className = 'loader';
loader.textContent = 'Loading the map';
shell.ui.append(loader);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

function toFeatures(topo: WorldTopology): CountryFeature[] {
  const fc = feature(topo, topo.objects.countries);
  const out: CountryFeature[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    out.push({ id: f.properties.id, name: f.properties.name, geometry: g as Polygon | MultiPolygon });
  }
  return out;
}

async function start(): Promise<void> {
  const [topo, countries] = await Promise.all([
    getJson<WorldTopology>('/data/world.json'),
    getJson<Record<CountryId, CountryInfo>>('/data/countries.json'),
  ]);
  const features = toFeatures(topo);
  const names = new Map(features.map((f) => [f.id, f.name]));
  const nameOf = (id: CountryId): string | null => countries[id]?.name ?? names.get(id) ?? null;

  let selected: CountryId | null = null;
  let preview: CountryId | null = null;
  let lastPointer = { type: 'mouse', x: 0, y: 0 };

  const tooltip = new Tooltip(shell.ui);
  const details = new DetailsPanel(shell.ui, { onSelectCountry: (id) => select(id), onClose: () => deselect(), nameOf });
  const news = new NewsPanel(shell.ui, { onClose: () => deselect() });
  new CountrySearch(shell.ui, {
    countries: features.map((f) => ({ id: f.id, name: nameOf(f.id) ?? f.name })),
    onSelect: (id) => select(id),
  });

  const globe = new Globe({
    container: shell.globe,
    features,
    onHover: (id, screen) => {
      // The selected country already has its name in the panels.
      const name = id && id !== selected ? nameOf(id) : null;
      if (name && screen) tooltip.show(name, screen.x, screen.y);
      else tooltip.hide();
    },
    onSelect: (id) => {
      if (lastPointer.type !== 'touch') {
        if (id) select(id);
        else deselect();
        return;
      }
      // Touch has no hover: the first tap raises the country, the second tap opens it.
      if (!id) {
        setPreview(null);
        deselect();
      } else if (id === preview || id === selected) {
        select(id);
      } else {
        setPreview(id);
      }
    },
  });

  function setPreview(id: CountryId | null): void {
    preview = id;
    globe.setPreview(id);
    const name = id ? nameOf(id) : null;
    if (id && name) {
      // Touch: a tap on the label opens the previewed country.
      tooltip.setAction(() => select(id));
      tooltip.show(name, lastPointer.x, lastPointer.y);
    } else tooltip.hide();
  }

  // ---- news ----

  const newsCache = new Map<CountryId, NewsResponse>();
  let newsRequest: AbortController | null = null;

  async function loadNews(id: CountryId, name: string): Promise<void> {
    newsRequest?.abort();
    const cached = newsCache.get(id);
    if (cached) {
      news.show(cached, name);
      return;
    }
    const ctrl = new AbortController();
    newsRequest = ctrl;
    news.showLoading(name);
    try {
      const res = await fetch(`/api/news?country=${encodeURIComponent(id)}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`news ${res.status}`);
      const data = (await res.json()) as NewsResponse;
      // Keep an empty result out of the cache, so a later visit tries again.
      if (data.articles.length > 0) newsCache.set(id, data);
      if (selected === id) news.show(data, name);
    } catch (err) {
      if (ctrl.signal.aborted) return;
      console.warn('[worldly] news failed', err);
      if (selected === id) news.showError(name, () => void loadNews(id, name));
    } finally {
      if (newsRequest === ctrl) newsRequest = null;
    }
  }

  // ---- selection ----

  function select(raw: CountryId): void {
    const id = resolveId(raw);
    if (!id) return;
    const info = countries[id];
    setPreview(null);
    tooltip.hide();
    if (id === selected) return;
    selected = id;
    window.dispatchEvent(new Event(INTERACTED_EVENT));
    globe.setSelected(id);
    if (info?.latlng) globe.focus(info.latlng);
    const name = nameOf(id) ?? id;
    if (info) details.show(info);
    else details.hide();
    void loadNews(id, name);
    document.title = `${name} · Worldly`;
    if (decodeURIComponent(location.hash.slice(1)) !== id) history.replaceState(null, '', `#${id}`);
    syncInsets();
  }

  function deselect(): void {
    setPreview(null);
    if (!selected) return;
    // The panels become inert. Keep keyboard focus on the page, not on <body>.
    const active = document.activeElement;
    const focusInPanels = active instanceof HTMLElement && active.closest('.panels') !== null;
    selected = null;
    newsRequest?.abort();
    newsRequest = null;
    globe.setSelected(null);
    details.hide();
    news.hide();
    document.title = 'Worldly';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    syncInsets();
    if (focusInPanels) globe.focusCanvas();
  }

  function resolveId(raw: string): CountryId | null {
    if (names.has(raw) || countries[raw]) return raw;
    const upper = raw.toUpperCase();
    if (names.has(upper) || countries[upper]) return upper;
    return null;
  }

  function fromHash(): void {
    const raw = decodeURIComponent(location.hash.slice(1));
    if (raw && resolveId(raw)) select(raw);
    else deselect();
  }

  // ---- layout and input ----

  function syncInsets(): void {
    globe.setViewportInsets(shell.panelInsets());
  }

  window.addEventListener(PANELS_CHANGE_EVENT, syncInsets);
  window.addEventListener('resize', syncInsets);
  window.addEventListener('hashchange', fromHash);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (selected) deselect();
    else setPreview(null);
  });
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = { type: e.pointerType, x: e.clientX, y: e.clientY };
    },
    { capture: true },
  );
  shell.globe.addEventListener('pointerdown', () => window.dispatchEvent(new Event(INTERACTED_EVENT)), {
    once: true,
  });

  loader.setAttribute('data-hidden', '');
  setTimeout(() => loader.remove(), 600);
  if (location.hash) fromHash();
}

start().catch((err) => {
  console.error('[worldly] failed to start', err);
  loader.textContent = 'Could not load the map. Reload the page to try again.';
});
