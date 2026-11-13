// App wiring: loads the data, builds the globe and panels, and keeps the selection in sync.

import { worldFeatures, type LiteCountryInfo, type WorldTopology } from './data/precompute';
import { HOME_TITLE, countryTitle } from './data/site';
import { COUNTRY_PATH_PREFIX, countrySlug, slugFromPath } from './data/slug';
import { Globe } from './globe/Globe';
import { Overlay } from './overlay';
import { unpackLabelSites, usePrecomputedLabelSites, type LabelsFile } from './overlay/labelPoints';
import { CountrySearch, DetailsPanel, INTERACTED_EVENT, NewsPanel, PANELS_CHANGE_EVENT, RESET_EVENT, Tooltip, mountShell } from './ui';
import type { BreakingFeedOptions } from './ui/alerts';
import type { BreakingAlert, CountryId, CountryInfo, NewsResponse } from './types';

const app = document.querySelector<HTMLElement>('#app')!;
const shell = mountShell(app);

// index.html paints this text before the module runs (#boot). Make it only if it is missing.
const loader = document.querySelector<HTMLElement>('#boot') ?? document.createElement('p');
loader.className = 'loader';
loader.textContent = 'Loading the map';
shell.ui.append(loader);
// The crawler summary under the loader (src/data/seo.ts). It stays on screen with the loader, then goes.
const summary = document.querySelector<HTMLElement>('#seo');
if (summary) shell.ui.append(summary);

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

/** Label sites and picker flags from the build (vite.config.ts). Null if the file does not load. */
async function getLabels(): Promise<LabelsFile | null> {
  try {
    return await getJson<LabelsFile>('/data/labels.json');
  } catch {
    return null;
  }
}

/** The data requests that index.html starts with the HTML. Absent if that script did not run. */
interface BootData {
  world: Promise<WorldTopology>;
  lite: Promise<Record<CountryId, LiteCountryInfo>>;
  labels: Promise<LabelsFile | null>;
  /** The full countries.json. index.html asks for it after the files above, so it does not slow them. */
  countries: Promise<Record<CountryId, CountryInfo>>;
  /** The first satellite texture tier, asked for at the same time as the full countries.json. */
  texture?: { url: string; blob: Promise<Blob | null> };
}

async function start(): Promise<void> {
  // The start does not wait for the fonts: the overlay measures the labels again when they load.
  const boot = (window as Window & { __worldlyBoot?: BootData }).__worldlyBoot;
  const full = boot?.countries ?? getJson<Record<CountryId, CountryInfo>>('/data/countries.json');
  full.catch(() => undefined); // handled at the await below
  const [topo, lite, labels] = await Promise.all([
    boot?.world ?? getJson<WorldTopology>('/data/world.json'),
    (boot?.lite ?? getJson<Record<CountryId, LiteCountryInfo>>('/data/countries-lite.json')).catch(() => full),
    boot?.labels ?? getLabels(),
  ]);
  // Until the full file arrives (loadFacts below), the records hold only the lite fields.
  const countries: Record<CountryId, LiteCountryInfo & Partial<CountryInfo>> = lite;
  // The full records, for the panels. Null until the full file is in; select() keeps the last request until then.
  let facts: Record<CountryId, CountryInfo> | null = null;
  let factsLoad: Promise<void> | null = null;
  let pendingSelect: CountryId | null = null;
  const features = worldFeatures(topo);
  // Use the build's label sites only when they come from this world.json (the same arc count).
  const built = labels?.v === 1 && labels.arcs === topo.arcs.length ? labels : null;
  if (built) usePrecomputedLabelSites(unpackLabelSites(built.sites));
  const names = new Map(features.map((f) => [f.id, f.name]));
  const nameOf = (id: CountryId): string | null => countries[id]?.name ?? names.get(id) ?? null;
  // The URL of a selected country is /country/<slug> (src/data/slug.ts). The build makes a page for each slug.
  const slugOf = new Map(features.map((f) => [f.id, countrySlug(nameOf(f.id) ?? f.name)]));
  const idOfSlug = new Map([...slugOf].map(([id, slug]) => [slug, id]));

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
    mapStyle: shell.mapStyle(),
    theme: shell.theme(),
    inverted: built ? new Set(built.inverted) : undefined,
    firstTexture: boot?.texture,
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
    // Double-click or double-tap: the globe already turned home. Close the panels and set the URL to /.
    onReset: () => {
      tooltip.hide();
      deselect();
    },
  });

  // ---- overlay: labels, leader lines and the readout ----

  // The overlay reads only the lite fields (LITE_FIELDS), one time, in its constructor.
  const overlay = new Overlay(shell.overlay, { countries: countries as Record<CountryId, CountryInfo>, features, globe });
  overlay.setTheme(shell.theme());
  overlay.setMapStyle(shell.mapStyle());
  overlay.setMobile(shell.isMobile());
  shell.onThemeChange((t) => {
    globe.setTheme(t);
    overlay.setTheme(t);
  });
  shell.onMapStyleChange((s) => {
    globe.setMapStyle(s);
    overlay.setMapStyle(s);
  });

  // The readout writes text only when a value changes; limit it to ~15 updates a second.
  let lastReadout = 0;
  const updateReadout = (): void => {
    const now = performance.now();
    if (now - lastReadout < 66) return;
    lastReadout = now;
    shell.readout.update(globe.getView(), selected);
  };
  globe.onFrame(updateReadout);
  // Dev-only handle for browser tests; removed from the production bundle.
  if (import.meta.env.DEV) Object.assign(window, { __worldly: { globe, overlay } });

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

  // A cached list lives at most 10 minutes, so a later visit gets fresh news.
  const NEWS_CACHE_MS = 10 * 60 * 1000;
  const newsCache = new Map<CountryId, { data: NewsResponse; at: number }>();
  let newsRequest: AbortController | null = null;
  // The breaking alerts on screen (BreakingBar.visible()), most severe first. The feed starts at the end of start().
  let liveAlerts: readonly BreakingAlert[] = [];

  /** The news plate (the News tab on mobile) shows the live alert of the selected country in a BREAKING row. */
  function syncNewsBreaking(): void {
    news.setBreaking((selected && liveAlerts.find((a) => a.country === selected)) || null);
  }

  async function loadNews(id: CountryId, name: string): Promise<void> {
    newsRequest?.abort();
    const cached = newsCache.get(id);
    if (cached && Date.now() - cached.at < NEWS_CACHE_MS) {
      news.show(cached.data, name);
      return;
    }
    newsCache.delete(id);
    const ctrl = new AbortController();
    newsRequest = ctrl;
    news.showLoading(name);
    try {
      const res = await fetch(`/api/news?country=${encodeURIComponent(id)}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`news ${res.status}`);
      const data = (await res.json()) as NewsResponse;
      // Keep an empty result out of the cache, so a later visit tries again.
      if (data.articles.length > 0) newsCache.set(id, { data, at: Date.now() });
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
    if (!facts) {
      pendingSelect = raw;
      if (!factsLoad) void loadFacts(getJson<Record<CountryId, CountryInfo>>('/data/countries.json')); // a retry
      return;
    }
    const id = resolveId(raw);
    if (!id) return;
    const info = facts[id];
    setPreview(null);
    tooltip.hide();
    // The same country: only make the URL clean again (an unknown #hash on a country path).
    if (id === selected) return setUrl(id);
    selected = id;
    window.dispatchEvent(new Event(INTERACTED_EVENT));
    globe.setSelected(id);
    overlay.setSelected(id);
    lastReadout = 0;
    if (info?.latlng) globe.focus(info.latlng);
    const name = nameOf(id) ?? id;
    if (info) details.show(info);
    else details.hide();
    syncNewsBreaking();
    void loadNews(id, name);
    document.title = countryTitle(name);
    setUrl(id);
    syncInsets();
  }

  function deselect(): void {
    if (pendingSelect) {
      // The user's last action wins over a selection that waits for the facts.
      pendingSelect = null;
      setUrl(null);
    }
    setPreview(null);
    if (!selected) return;
    // The panels become inert. Keep keyboard focus on the page, not on <body>.
    const active = document.activeElement;
    const focusInPanels = active instanceof HTMLElement && active.closest('.panels') !== null;
    selected = null;
    newsRequest?.abort();
    newsRequest = null;
    globe.setSelected(null);
    overlay.setSelected(null);
    lastReadout = 0;
    shell.readout.update(globe.getView(), null);
    details.hide();
    news.hide();
    document.title = HOME_TITLE;
    setUrl(null);
    syncInsets();
    if (focusInPanels) globe.focusCanvas();
  }

  function resolveId(raw: string): CountryId | null {
    if (names.has(raw) || countries[raw]) return raw;
    const upper = raw.toUpperCase();
    if (names.has(upper) || countries[upper]) return upper;
    return null;
  }

  /** Writes /country/<slug> for a country, or / for none. It keeps the query and drops a hash. */
  function setUrl(id: CountryId | null): void {
    const slug = id ? slugOf.get(id) : null;
    const path = slug ? COUNTRY_PATH_PREFIX + slug : '/';
    if (location.pathname !== path || location.hash) history.replaceState(null, '', path + location.search);
  }

  /** The country in the URL: an old #JPN link first, then the /country/<slug> path. */
  function fromUrl(): void {
    let hash = '';
    try {
      hash = decodeURIComponent(location.hash.slice(1));
    } catch {
      // A bad % escape: no country.
    }
    const slug = slugFromPath(location.pathname);
    const id = (hash && resolveId(hash)) || (slug && idOfSlug.get(slug)) || null;
    if (id) return select(id);
    // An unknown country: show the plain globe at /.
    deselect();
    setUrl(null);
  }

  // ---- layout and input ----

  // Panels slide in and out with a CSS transition. Re-read their rects for a short time
  // after each change, so the leader lines end on the panel edge during the slide.
  let rectsUntil = 0;
  let rectsRaf = 0;
  function trackPanelRects(): void {
    overlay.setPanelRects(shell.panelRects());
    if (performance.now() < rectsUntil) rectsRaf = requestAnimationFrame(trackPanelRects);
    else rectsRaf = 0;
  }

  function syncInsets(): void {
    const insets = shell.panelInsets();
    globe.setViewportInsets(insets);
    overlay.setMobile(shell.isMobile());
    overlay.setTopInset(insets.top);
    rectsUntil = performance.now() + 600;
    if (!rectsRaf) trackPanelRects();
  }

  window.addEventListener(PANELS_CHANGE_EVENT, syncInsets);
  window.addEventListener('resize', syncInsets);
  // A typed #JPN fires hashchange. Back and Forward between two entries with no hash fire popstate only.
  // fromUrl() is safe to run twice, so both events call it.
  window.addEventListener('hashchange', fromUrl);
  window.addEventListener('popstate', fromUrl);
  window.addEventListener(RESET_EVENT, resetAll);

  // The wordmark and Home: back to the first-load state (view, selection, URL, search).
  function resetAll(): void {
    globe.resetView();
    tooltip.hide();
    deselect();
    const input = document.querySelector<HTMLInputElement>('.search-input');
    if (input) {
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.blur();
    }
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Home' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      // Home resets the view, like a double-click. Keep Home for text fields and the panel scroll.
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, select, .panels'))) return;
      e.preventDefault();
      resetAll();
      return;
    }
    if (e.key !== 'Escape') return;
    if (selected || pendingSelect) deselect();
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

  // The full countries.json usually arrives while the globe builds. On a slow link it can come
  // a little after the first frame: the globe turns, and a selection waits for the file.
  // If it fails, the loader text tells the user, and the next selection asks for the file again.
  function loadFacts(source: Promise<Record<CountryId, CountryInfo>>): Promise<void> {
    factsLoad = source.then(
      (all) => {
        Object.assign(countries, all);
        facts = all;
        factsLoad = null;
        if (loaderShown) hideLoader();
        if (pendingSelect) select(pendingSelect);
      },
      (err: unknown) => {
        factsLoad = null;
        console.error('[worldly] country facts failed', err);
        // This cancels the removal of the loader and the summary. Show the loader again; remove the summary now.
        clearTimeout(loaderTimer);
        summary?.remove();
        loader.textContent = 'Country details could not load. Reload the page to try again.';
        loader.setAttribute('data-error', '');
        loader.setAttribute('role', 'alert');
        loader.removeAttribute('data-hidden');
        shell.ui.append(loader);
        loaderShown = true;
      },
    );
    return factsLoad;
  }

  let loaderTimer = 0;
  let loaderShown = true;
  function hideLoader(): void {
    loaderShown = false;
    loader.setAttribute('data-hidden', '');
    summary?.setAttribute('data-hidden', '');
    clearTimeout(loaderTimer);
    loaderTimer = window.setTimeout(() => {
      loader.remove();
      summary?.remove();
    }, 600);
  }

  syncInsets();
  hideLoader();
  // One retry at once, then a retry with each selection (select()). Start it before fromUrl(),
  // so a selection from the URL waits for this request and does not start a second one.
  void loadFacts(full.catch(() => getJson<Record<CountryId, CountryInfo>>('/data/countries.json')));
  if (location.hash || location.pathname !== '/') fromUrl();

  // ---- breaking news: the header chip, the map markers and the 5-minute poll ----

  let hadAlerts = false;
  let source: BreakingFeedOptions['source'];
  if (import.meta.env.DEV) {
    // ?alerts=mock (or mock-critical, mock-major, mock-none): fake alerts. Not in the production build.
    const mock = new URLSearchParams(location.search).get('alerts');
    if (mock?.startsWith('mock')) source = () => import('./dev/breaking-mock').then((m) => m.mockBreaking(mock));
  }
  // After the first globe frame, and off the critical path. Safari has no requestIdleCallback.
  // The chip and the feed load as a separate chunk: the chip shows nothing before the first response.
  const beginFeed = () =>
    void import('./ui/alerts').then(
      ({ BreakingBar, startBreakingFeed }) => {
        const breaking = new BreakingBar(shell.breakingSlot, shell.ui, {
          nameOf,
          resolve: resolveId,
          onSelect: (a) => {
            // select() does nothing for the selected country: turn the globe back to it.
            const ll = countries[a.country]?.latlng;
            if (a.country === selected) {
              if (ll) globe.focus(ll);
            } else select(a.country);
            overlay.pulseAlert(a.country);
          },
          onPreview: (a) => overlay.pulseAlert(a.country),
          onRotate: (a) => overlay.pulseAlert(a.country, 1),
          onChange: (alerts, fresh) => {
            liveAlerts = alerts;
            syncNewsBreaking();
            overlay.setAlerts(alerts.map((a) => ({ id: a.country, key: a.key, level: a.level, fresh: fresh.has(a.key) })));
            // On mobile the header gains or loses a row: the globe and the labels follow its height.
            if (alerts.length > 0 !== hadAlerts) {
              hadAlerts = alerts.length > 0;
              syncInsets();
            }
          },
          focusFallback: () => globe.focusCanvas(),
        });
        startBreakingFeed({
          onAlerts: (alerts) => {
            breaking.set(alerts);
            // onChange runs only when the keys or levels change. A new headline or link for the same alert comes here.
            liveAlerts = breaking.visible();
            syncNewsBreaking();
          },
          source,
        });
      },
      (err: unknown) => console.warn('[worldly] breaking news did not load', err),
    );
  if ('requestIdleCallback' in window) requestIdleCallback(beginFeed, { timeout: 4000 });
  else setTimeout(beginFeed, 2000);

  // Visitor counts and real-user speed (Vercel). A separate chunk, in the production build only.
  if (import.meta.env.PROD) {
    const beginVitals = () =>
      void import('./vitals').then(
        ({ startVitals }) => startVitals(),
        (err: unknown) => console.warn('[worldly] analytics did not load', err),
      );
    if ('requestIdleCallback' in window) requestIdleCallback(beginVitals, { timeout: 5000 });
    else setTimeout(beginVitals, 2500);
  }
}

start().catch((err) => {
  console.error('[worldly] failed to start', err);
  loader.textContent = 'Could not load the map. Reload the page to try again.';
});
