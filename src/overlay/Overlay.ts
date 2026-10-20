// Globe overlay: always-on country and capital labels, and the leader lines from the selected country to the panels.
// The globe calls back after each frame; the overlay projects the label sites, places them greedily by priority,
// and writes only transforms and opacity to a fixed pool of DOM nodes.

import './overlay.css';
import type { CountryFeature, CountryId, CountryInfo } from '../types';
import { CAPITAL_LATLNG } from './capitals';
import { computeLabelSites } from './labelPoints';

export type OverlayTheme = 'light' | 'dark';
export type OverlayMapStyle = 'satellite' | 'atlas';

export interface ProjectedPoint {
  x: number;
  y: number;
  visible: boolean;
  facing: number;
}

/** The part of the Globe API that the overlay uses. */
export interface OverlayGlobe {
  project(lat: number, lng: number, lift?: number): ProjectedPoint;
  onFrame(cb: () => void): () => void;
  getView(): { lat: number; lng: number; altitudeKm: number; distance: number };
  selectedAnchor(): [number, number] | null;
  /** Optional: raise of the selected country in earth radii, so the anchor dot sits on the raised cap. */
  selectedLift?(): number;
}

export interface OverlayOptions {
  countries: Record<CountryId, CountryInfo>;
  features: CountryFeature[];
  globe: OverlayGlobe;
}

export interface PanelRects {
  details: DOMRect | null;
  news: DOMRect | null;
}

const NS = 'http://www.w3.org/2000/svg';
const FONT = "'Inter Tight', system-ui, -apple-system, 'Segoe UI', sans-serif";
const KM_PER_DEG = 111.195;
const FADE_MS = 160;
const DRAW_MS = 250;
const LABEL_H = 12;
const SEL_H = 16;
const CAP_SQ = 4;
const CAP_GAP = 5;
const RISE = 56; // vertical run of a leader line, px
const BIG_KM2 = 2e6;

/** Short forms for names that are too long to label on a globe. */
const SHORT: Record<string, string> = {
  ARE: 'UAE',
  ATF: 'Fr. Southern Lands',
  BIH: 'Bosnia & Herz.',
  CAF: 'Central African Rep.',
  COD: 'DR Congo',
  COG: 'Congo',
  DOM: 'Dominican Rep.',
  HMD: 'Heard Island',
  IOT: 'Br. Indian Ocean Terr.',
  KNA: 'St Kitts & Nevis',
  MNP: 'N. Mariana Islands',
  SGS: 'South Georgia',
  SPM: 'St Pierre & Miquelon',
  TCA: 'Turks & Caicos',
  TTO: 'Trinidad & Tobago',
  VCT: 'St Vincent',
  VGB: 'Br. Virgin Islands',
  VIR: 'US Virgin Islands',
  PRK: 'North Korea',
  KOR: 'South Korea',
  'X-ashmore-and-cartier': 'Ashmore & Cartier',
  'X-indian-ocean-territories': 'Indian Ocean Terr.',
};

interface Node {
  el: HTMLElement | null;
  x: number; // last written, px
  y: number;
  op: number;
  shown: boolean;
  fade: number; // 0..1, eased toward 1 while placed
  placed: boolean;
  px: number; // top-left this frame
  py: number;
  limb: number; // 0..1 limb fade this frame
}

interface CapitalItem extends Node {
  name: string;
  lat: number;
  lng: number;
  w: number;
  wSel: number;
  rev: boolean; // name to the left of the square
  side: number; // selected capital: 0 right, 1 left, 2 above, 3 below
  noName: boolean;
}

interface CountryItem extends Node {
  id: CountryId;
  text: string;
  lat: number;
  lng: number;
  areaKm2: number;
  score: number;
  big: boolean;
  w: number;
  wSel: number;
  cap: CapitalItem | null;
  extra: [number, number][];
  site: number; // -1 = the main site, else an index into extra
}

interface LineSide {
  g: SVGGElement;
  out: SVGPathElement;
  inn: SVGPathElement;
  tick: SVGPathElement;
  d: string;
  tickD: string;
  on: boolean;
}

const newNode = (): Node => ({ el: null, x: NaN, y: NaN, op: -1, shown: false, fade: 0, placed: false, px: 0, py: 0, limb: 0 });
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

let seq = 0;

export class Overlay {
  /** Frame cost of the overlay update, for measurement. */
  readonly perf = { frames: 0, totalMs: 0, maxMs: 0 };

  private readonly globe: OverlayGlobe;
  private readonly el: HTMLDivElement;
  private readonly labelsEl: HTMLDivElement;
  private readonly svg: SVGSVGElement;
  private readonly discIn: SVGCircleElement;
  private readonly discOut: SVGCircleElement;
  private readonly sides: [LineSide, LineSide];
  private readonly dot: SVGCircleElement;
  private readonly items: CountryItem[]; // sorted by priority, highest first
  private readonly byId = new Map<CountryId, CountryItem>();
  private readonly measureCtx: CanvasRenderingContext2D | null;
  private readonly unsubscribe: () => void;
  private readonly reducedMotion: MediaQueryList;

  private selected: CountryId | null = null;
  private panels: PanelRects = { details: null, news: null };
  private mobile = false;
  private topInset = 0;
  private width = window.innerWidth;
  private height = window.innerHeight;
  private lastUpdate = -Infinity;
  private raf = 0;
  private disposed = false;
  private linesOn = false;
  private linesOp = -1;
  private dotXY = '';
  private drawPending = false;

  // Occupied screen boxes for this frame: [x0, y0, x1, y1] * n.
  private boxes = new Float64Array(4 * 256);
  private nBoxes = 0;
  // Boxes [lineFrom, lineTo) of this frame are the leader lines.
  private lineFrom = 0;
  private lineTo = 0;
  private discX = 0;
  private discY = 0;
  private discR = 0;

  constructor(root: HTMLElement, opts: OverlayOptions) {
    this.globe = opts.globe;
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.el = document.createElement('div');
    this.el.className = 'wo-overlay';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.dataset.theme = 'light';
    this.el.dataset.style = 'satellite';

    // Leader lines: two strokes per line, one clipped to the globe disc and one masked outside it.
    const id = `wo-${++seq}`;
    this.svg = document.createElementNS(NS, 'svg');
    this.svg.setAttribute('class', 'wo-lines');
    this.svg.style.display = 'none';
    const defs = this.svgEl('defs', {}, this.svg);
    const clip = this.svgEl('clipPath', { id: `${id}-in` }, defs);
    this.discIn = this.svgEl('circle', { cx: 0, cy: 0, r: 0 }, clip) as SVGCircleElement;
    const mask = this.svgEl('mask', { id: `${id}-out`, maskUnits: 'userSpaceOnUse', x: -1e4, y: -1e4, width: 2e4, height: 2e4 }, defs);
    this.svgEl('rect', { x: -1e4, y: -1e4, width: 2e4, height: 2e4, fill: '#fff' }, mask);
    this.discOut = this.svgEl('circle', { cx: 0, cy: 0, r: 0, fill: '#000' }, mask) as SVGCircleElement;
    const side = (): LineSide => {
      const g = this.svgEl('g', {}, this.svg) as SVGGElement;
      const out = this.svgEl('path', { class: 'wo-line-out', mask: `url(#${id}-out)`, pathLength: 1 }, g) as SVGPathElement;
      const inn = this.svgEl('path', { class: 'wo-line-in', 'clip-path': `url(#${id}-in)`, pathLength: 1 }, g) as SVGPathElement;
      const tick = this.svgEl('path', { class: 'wo-tick' }, g) as SVGPathElement;
      g.style.display = 'none';
      return { g, out, inn, tick, d: '', tickD: '', on: false };
    };
    this.sides = [side(), side()];
    this.dot = this.svgEl('circle', { class: 'wo-dot', r: 3.5, cx: 0, cy: 0 }, this.svg) as SVGCircleElement;

    this.labelsEl = document.createElement('div');
    this.labelsEl.className = 'wo-labels';
    this.el.append(this.svg, this.labelsEl);
    root.appendChild(this.el);

    // Label items, computed once.
    const sites = computeLabelSites(opts.features);
    const items: CountryItem[] = [];
    for (const f of opts.features) {
      const site = sites.get(f.id);
      if (!site) continue;
      const info = opts.countries[f.id];
      const name = SHORT[f.id] ?? info?.name ?? f.name;
      const areaKm2 = info?.area && info.area > 0 ? info.area : site.areaKm2;
      const pop = info?.population ?? 0;
      let cap: CapitalItem | null = null;
      const capName = info?.capital?.[0];
      const capLL = info?.capitalLatLng ?? CAPITAL_LATLNG[f.id] ?? null;
      if (capName && capLL) cap = { ...newNode(), name: capName, lat: capLL[0], lng: capLL[1], w: 0, wSel: 0, rev: false, side: 0, noName: false };
      items.push({
        ...newNode(),
        id: f.id,
        text: name.toUpperCase(),
        lat: site.lat,
        lng: site.lng,
        areaKm2,
        score: areaKm2 * Math.log10(pop + 10),
        big: areaKm2 > BIG_KM2,
        w: 0,
        wSel: 0,
        cap,
        extra: site.extra,
        site: -1,
      });
    }
    items.sort((a, b) => b.score - a.score);
    this.items = items;
    for (const it of items) this.byId.set(it.id, it);

    this.measureCtx = document.createElement('canvas').getContext('2d');
    this.measureAll();
    document.fonts?.ready.then(() => this.remeasure());
    document.fonts?.addEventListener('loadingdone', this.remeasure);

    window.addEventListener('resize', this.onResize);
    this.unsubscribe = this.globe.onFrame(this.onFrame);
    this.kick();
  }

  setSelected(id: CountryId | null): void {
    if (id === this.selected) return;
    const prev = this.selected ? this.byId.get(this.selected) : undefined;
    if (prev) this.setSelClass(prev, false);
    this.selected = id;
    const next = id ? this.byId.get(id) : undefined;
    if (next) this.setSelClass(next, true);
    this.drawPending = id !== null;
    this.kick();
  }

  setPanelRects(r: PanelRects): void {
    this.panels = { details: r.details, news: r.news };
    this.kick();
  }

  /** Height of the header in px: labels stay below it. */
  setTopInset(px: number): void {
    if (px === this.topInset) return;
    this.topInset = px;
    this.kick();
  }

  setTheme(t: OverlayTheme): void {
    this.el.dataset.theme = t;
  }

  setMapStyle(s: OverlayMapStyle): void {
    this.el.dataset.style = s;
  }

  setMobile(m: boolean): void {
    if (m === this.mobile) return;
    this.mobile = m;
    this.kick();
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    document.fonts?.removeEventListener('loadingdone', this.remeasure);
    this.el.remove();
  }

  // ---------- events ----------

  private readonly onFrame = (): void => {
    if (this.disposed) return;
    this.update();
  };

  private readonly onResize = (): void => {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.kick();
  };

  private readonly remeasure = (): void => {
    if (this.disposed) return;
    this.measureAll();
    this.kick();
  };

  /** Runs one update on the next animation frame unless the globe calls first. Keeps running while labels fade. */
  private kick(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (performance.now() - this.lastUpdate > 8) this.update();
      else if (this.animating()) this.kick();
    });
  }

  // ---------- measurement ----------

  private measure(text: string, weight: number, size: number, trackEm: number): number {
    const ctx = this.measureCtx;
    const base = ctx ? ((ctx.font = `${weight} ${size}px ${FONT}`), ctx.measureText(text).width) : text.length * size * 0.6;
    return Math.ceil(base + text.length * trackEm * size) + 1;
  }

  private measureAll(): void {
    for (const it of this.items) {
      it.w = it.big ? this.measure(it.text, 500, 11, 0.14) : this.measure(it.text, 500, 10, 0.12);
      it.wSel = this.measure(it.text, 600, 13, 0.16);
      if (it.cap) {
        it.cap.w = CAP_SQ + CAP_GAP + this.measure(it.cap.name, 400, 11, 0);
        it.cap.wSel = 6 + CAP_GAP + this.measure(it.cap.name, 500, 12, 0);
      }
    }
  }

  // ---------- DOM ----------

  private svgEl(name: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
    const n = document.createElementNS(NS, name) as SVGElement;
    for (const k in attrs) n.setAttribute(k, String(attrs[k]));
    parent.appendChild(n);
    return n;
  }

  private countryEl(it: CountryItem): HTMLElement {
    if (!it.el) {
      const n = document.createElement('div');
      n.className = `wo-lbl wo-country${it.big ? ' wo-big' : ''}${it.id === this.selected ? ' wo-sel' : ''}`;
      n.textContent = it.text;
      this.labelsEl.appendChild(n);
      it.el = n;
    }
    return it.el;
  }

  private capitalEl(it: CountryItem, cap: CapitalItem): HTMLElement {
    if (!cap.el) {
      const n = document.createElement('div');
      n.className = `wo-lbl wo-cap${it.id === this.selected ? ' wo-sel' : ''}${['', ' wo-rev', ' wo-up', ' wo-down'][cap.side]}${cap.noName ? ' wo-noname' : ''}`;
      const sq = document.createElement('i');
      const name = document.createElement('span');
      name.textContent = cap.name;
      n.append(sq, name);
      this.labelsEl.appendChild(n);
      cap.el = n;
    }
    return cap.el;
  }

  private setSelClass(it: CountryItem, on: boolean): void {
    it.el?.classList.toggle('wo-sel', on);
    it.cap?.el?.classList.toggle('wo-sel', on);
  }

  /** Writes position and opacity, only when they change. */
  private write(n: Node, el: HTMLElement): void {
    const op = Math.round(n.fade * n.limb * 20) / 20;
    if (op <= 0) {
      if (n.shown) {
        if (el.classList.contains('wo-cap')) delete el.dataset.on;
        else el.style.display = 'none';
        n.shown = false;
      }
      return;
    }
    if (!n.shown) {
      if (el.classList.contains('wo-cap')) el.dataset.on = '';
      else el.style.display = 'block';
      n.shown = true;
    }
    const x = Math.round(n.px);
    const y = Math.round(n.py);
    if (x !== n.x || y !== n.y) {
      el.style.transform = `translate3d(${x}px,${y}px,0)`;
      n.x = x;
      n.y = y;
    }
    if (op !== n.op) {
      el.style.opacity = String(op);
      n.op = op;
    }
  }

  // ---------- collision boxes ----------

  private push(x0: number, y0: number, x1: number, y1: number): void {
    if (this.nBoxes * 4 + 4 > this.boxes.length) {
      const b = new Float64Array(this.boxes.length * 2);
      b.set(this.boxes);
      this.boxes = b;
    }
    const i = this.nBoxes++ * 4;
    this.boxes[i] = x0;
    this.boxes[i + 1] = y0;
    this.boxes[i + 2] = x1;
    this.boxes[i + 3] = y1;
  }

  private free(x0: number, y0: number, x1: number, y1: number, pad: number): boolean {
    if (x0 < 4 || y0 < 4 || x1 > this.width - 4 || y1 > this.height - 4) return false;
    // Keep the whole box on the globe disc.
    const r2 = (this.discR - 6) * (this.discR - 6);
    const dy = Math.max(Math.abs(y0 - this.discY), Math.abs(y1 - this.discY));
    const dx = Math.max(Math.abs(x0 - this.discX), Math.abs(x1 - this.discX));
    if (dx * dx + dy * dy > r2) return false;
    x0 -= pad;
    y0 -= pad;
    x1 += pad;
    y1 += pad;
    const b = this.boxes;
    for (let i = 0, n = this.nBoxes * 4; i < n; i += 4) {
      if (x0 < b[i + 2] && x1 > b[i] && y0 < b[i + 3] && y1 > b[i + 1]) return false;
    }
    return true;
  }

  /** True when the box overlaps a box already placed this frame (no disc or screen test). */
  private hits(x0: number, y0: number, x1: number, y1: number, pad: number, skipLines = false): boolean {
    x0 -= pad;
    y0 -= pad;
    x1 += pad;
    y1 += pad;
    const b = this.boxes;
    for (let i = 0, n = this.nBoxes * 4; i < n; i += 4) {
      if (skipLines && i >= this.lineFrom * 4 && i < this.lineTo * 4) continue;
      if (x0 < b[i + 2] && x1 > b[i] && y0 < b[i + 3] && y1 > b[i + 1]) return true;
    }
    return false;
  }

  // ---------- frame ----------

  private animating(): boolean {
    for (const it of this.items) {
      if ((it.placed && it.fade < 1) || (!it.placed && it.fade > 0)) return true;
      const c = it.cap;
      if (c && ((c.placed && c.fade < 1) || (!c.placed && c.fade > 0))) return true;
    }
    return false;
  }

  private update(): void {
    const t0 = performance.now();
    const dt = Math.min(100, t0 - this.lastUpdate);
    this.lastUpdate = t0;
    const step = dt / FADE_MS;
    const g = this.globe;
    const mobile = this.mobile;

    // Screen scale at the centre of view: px per km of ground.
    const view = g.getView();
    const c0 = g.project(view.lat, view.lng);
    const c1 = g.project(view.lat > 0 ? view.lat - 1 : view.lat + 1, view.lng);
    const pxPerKm = Math.hypot(c1.x - c0.x, c1.y - c0.y) / KM_PER_DEG;

    // Globe disc on screen, for the two-tone leader lines.
    const dist = view.distance > 1 ? view.distance : 1 + view.altitudeKm / 6371;
    const horizon = (Math.acos(1 / dist) * 180) / Math.PI;
    const limbLat = view.lat + horizon <= 90 ? view.lat + horizon : view.lat - horizon;
    const lp = g.project(limbLat, view.lng);
    const discR = Math.hypot(lp.x - c0.x, lp.y - c0.y);
    this.discX = c0.x;
    this.discY = c0.y;
    this.discR = discR;

    this.nBoxes = 0;
    const blockRect = (r: DOMRect | null) => {
      if (r && r.width > 0 && r.height > 0) this.push(r.left - 8, r.top - 8, r.right + 8, r.bottom + 8);
    };
    blockRect(this.panels.details);
    blockRect(this.panels.news);
    if (this.topInset > 0) this.push(-1e4, -1e4, 1e4, this.topInset + 4);

    // Selected country: anchor, leader lines, its label and capital.
    const sel = this.selected ? this.byId.get(this.selected) : undefined;
    let anchor: ProjectedPoint | null = null;
    if (sel) {
      const a = g.selectedAnchor() ?? [sel.lat, sel.lng];
      anchor = g.project(a[0], a[1], g.selectedLift?.() ?? 0);
    }
    const anchorLimb = anchor && anchor.visible ? clamp((anchor.facing - 0.05) / 0.15, 0, 1) : 0;
    this.lineFrom = this.lineTo = this.nBoxes;
    this.updateLines(anchor, anchorLimb, c0.x, c0.y, discR);

    for (const it of this.items) {
      it.placed = false;
      if (it.cap) it.cap.placed = false;
    }

    if (sel && anchor) {
      sel.limb = anchorLimb;
      if (anchorLimb > 0) {
        sel.placed = true;
        const w = sel.wSel;
        const ax = anchor.x;
        const ay = anchor.y;
        // Label positions in order of preference. The capital takes the first one that leaves it room.
        const spots: [number, number][] = mobile
          ? [
              [ax - 12 - w, ay - SEL_H / 2],
              [ax + 12, ay - SEL_H / 2],
              [ax - w / 2, ay - 14 - SEL_H],
              [ax - w / 2, ay + 14],
            ]
          : [
              [ax + 12, ay - 16 - SEL_H / 2],
              [ax + 12, ay + 16 - SEL_H / 2],
              [ax - 12 - w, ay - 16 - SEL_H / 2],
              [ax - 12 - w, ay + 16 - SEL_H / 2],
            ];
        const cap = sel.cap;
        let capP: ProjectedPoint | null = null;
        if (cap) {
          // The capital sits on the raised cap, the same as the anchor dot.
          capP = g.project(cap.lat, cap.lng, g.selectedLift?.() ?? 0);
          cap.limb = capP.visible ? clamp((capP.facing - 0.05) / 0.15, 0, 1) : 0;
          if (cap.limb <= 0) capP = null;
        }
        // Capital name around its square: 0 = right, 1 = left, 2 = above, 3 = below. Element box [x0, y0, x1, y1].
        const capBox = (side: number): [number, number, number, number] => {
          const bx = capP!.x;
          const by = capP!.y;
          const ww = cap!.wSel;
          const nw = Math.max(6, ww - 6 - CAP_GAP);
          if (side === 0) return [bx - 3, by - SEL_H / 2, bx - 3 + ww, by + SEL_H / 2];
          if (side === 1) return [bx + 3 - ww, by - SEL_H / 2, bx + 3, by + SEL_H / 2];
          if (side === 2) return [bx - nw / 2, by - 18, bx + nw / 2, by + 3];
          return [bx - nw / 2, by - 3, bx + nw / 2, by + 18];
        };
        // Only the name part of capBox: the square may sit under the anchor dot.
        const nameBox = (side: number): [number, number, number, number] => {
          const [x0, y0, x1, y1] = capBox(side);
          if (side === 0) return [x0 + 6 + CAP_GAP, y0, x1, y1];
          if (side === 1) return [x0, y0, x1 - 6 - CAP_GAP, y1];
          if (side === 2) return [x0, y0, x1, y1 - 9];
          return [x0, y0 + 9, x1, y1];
        };
        // The first side that stays on screen and touches no label, line or dot; -1 = no room.
        // With skipLines, a 1px leader line may cross the name: its halo keeps it legible.
        const capSide = (lx: number, ly: number, skipLines: boolean): number => {
          if (!cap || !capP) return -1;
          for (let sd = 0; sd < 4; sd++) {
            const [x0, y0, x1, y1] = nameBox(sd);
            if (x0 < 4 || x1 > this.width - 4 || y0 < this.topInset + 4 || y1 > this.height - 4) continue;
            const overLabel = x0 < lx + w + 2 && x1 > lx - 2 && y0 < ly + SEL_H + 2 && y1 > ly - 2;
            if (!overLabel && !this.hits(x0, y0, x1, y1, 2, skipLines)) return sd;
          }
          return -1;
        };
        // Label spots other than the first must be free and must not cover the capital square.
        const spotOk = (k: number): boolean => {
          const [lx, ly] = spots[k];
          if (k > 0 && (lx < 4 || lx + w > this.width - 4 || this.hits(lx, ly, lx + w, ly + SEL_H, 2))) return false;
          return !(capP && capP.x + 4 > lx && capP.x - 4 < lx + w && capP.y + 4 > ly && capP.y - 4 < ly + SEL_H);
        };
        let pick = spots[0];
        let side = -1;
        if (capP) {
          search: for (const skipLines of [false, true]) {
            for (let k = 0; k < spots.length; k++) {
              if (!spotOk(k)) continue;
              const sd = capSide(spots[k][0], spots[k][1], skipLines);
              if (sd >= 0) {
                pick = spots[k];
                side = sd;
                break search;
              }
            }
          }
        }
        sel.px = pick[0];
        sel.py = pick[1];
        this.push(sel.px, sel.py, sel.px + w, sel.py + SEL_H);
        if (cap && capP) {
          // With no room on any side, show only the square.
          this.setNoName(cap, side < 0);
          this.setCapSide(cap, side < 0 ? 0 : side);
          const box = side < 0 ? ([capP.x - 3, capP.y - SEL_H / 2, capP.x + 3, capP.y + SEL_H / 2] as const) : capBox(side);
          cap.px = box[0];
          cap.py = box[1];
          cap.placed = true;
          this.push(box[0], box[1], box[2], box[3]);
        }
      }
    }

    // Other countries, by priority. Density follows the zoom: a country joins when it is large on screen.
    const topN = mobile ? 10 : 20;
    const minPx = mobile ? 56 : 44;
    const maxPlaced = mobile ? 24 : 110;
    const capPx = mobile ? Infinity : 150;
    let placed = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it === sel) continue;
      const sizePx = Math.sqrt(it.areaKm2) * pxPerKm;
      const candidate = placed < maxPlaced && (i < topN || sizePx >= minPx);
      if (!candidate && it.fade <= 0) continue;
      const w = it.w;
      // Labels already on screen hold their place with a smaller margin, so they do not flicker.
      const pad = it.fade > 0.5 ? 2 : 5;
      // A site that is placed keeps it; otherwise the main site.
      const prev = it.site;
      if (!this.trySite(it, prev, candidate, pad) && prev !== -1) this.trySite(it, -1, candidate, pad);
      // Zoomed in on a large country: its main site can be off-screen. Try the interior point nearest the view centre.
      if (!it.placed && candidate && it.extra.length > 0 && sizePx > 300) {
        let bestK = -1;
        let bestD = Infinity;
        for (let k = 0; k < it.extra.length; k++) {
          if (k === prev) continue;
          const q = g.project(it.extra[k][0], it.extra[k][1]);
          if (!q.visible || q.facing < 0.3) continue;
          const dd = (q.x - c0.x) ** 2 + (q.y - c0.y) ** 2;
          if (dd < bestD && this.free(q.x - w / 2, q.y - LABEL_H / 2, q.x + w / 2, q.y + LABEL_H / 2, 5)) {
            bestD = dd;
            bestK = k;
          }
        }
        if (bestK >= 0) {
          // A jump to another site starts a new fade.
          if (it.site !== bestK && it.fade > 0) it.fade = 0;
          this.trySite(it, bestK, candidate, 5);
        }
      }
      if (it.placed) placed++;
    }

    // Capitals of placed countries that are large on screen.
    if (capPx < Infinity) {
      for (const it of this.items) {
        const cap = it.cap;
        if (!cap || it === sel) continue;
        const want = it.placed && Math.sqrt(it.areaKm2) * pxPerKm >= capPx;
        if (!want && cap.fade <= 0) continue;
        const p = g.project(cap.lat, cap.lng);
        cap.limb = p.visible ? clamp((p.facing - 0.12) / 0.2, 0, 1) : 0;
        const y0 = p.y - LABEL_H / 2;
        const right = p.x - CAP_SQ / 2;
        const left = p.x + CAP_SQ / 2 - cap.w;
        cap.py = y0;
        cap.px = cap.rev ? left : right;
        if (!want || cap.limb <= 0.05) continue;
        const pad = cap.fade > 0.5 ? 2 : 4;
        let rev: boolean | null = null;
        if (this.free(right, y0, right + cap.w, y0 + LABEL_H, pad)) rev = false;
        else if (this.free(left, y0, left + cap.w, y0 + LABEL_H, pad)) rev = true;
        if (rev === null) continue;
        this.setNoName(cap, false);
        this.setRev(cap, rev);
        cap.px = rev ? left : right;
        cap.placed = true;
        this.push(cap.px, cap.py, cap.px + cap.w, cap.py + LABEL_H);
      }
    }

    // Fades and DOM writes.
    let moving = false;
    for (const it of this.items) {
      const target = it.placed ? 1 : 0;
      if (it.fade !== target) {
        it.fade = it === sel ? target : clamp(it.fade + (target ? step : -step), 0, 1);
        moving ||= it.fade !== target;
      }
      if (it.fade > 0 || it.shown) this.write(it, this.countryEl(it));
      const cap = it.cap;
      if (cap) {
        const ct = cap.placed ? 1 : 0;
        if (cap.fade !== ct) {
          cap.fade = it === sel ? ct : clamp(cap.fade + (ct ? step : -step), 0, 1);
          moving ||= cap.fade !== ct;
        }
        if (cap.fade > 0 || cap.shown) this.write(cap, this.capitalEl(it, cap));
      }
    }
    if (moving) this.kick();

    const ms = performance.now() - t0;
    this.perf.frames++;
    this.perf.totalMs += ms;
    this.perf.maxMs = Math.max(this.perf.maxMs, ms);
  }

  /** Projects one site of a country label and places it when the box is free. */
  private trySite(it: CountryItem, k: number, candidate: boolean, pad: number): boolean {
    const [lat, lng] = k < 0 ? [it.lat, it.lng] : it.extra[k];
    const p = this.globe.project(lat, lng);
    const limb = p.visible ? clamp((p.facing - 0.12) / 0.2, 0, 1) : 0;
    const px = p.x - it.w / 2;
    const py = p.y - LABEL_H / 2;
    if (k === it.site) {
      // Keep the fade-out on the site the label shows now.
      it.limb = limb;
      it.px = px;
      it.py = py;
    }
    if (!candidate || limb <= 0.05 || !this.free(px, py, px + it.w, py + LABEL_H, pad)) return false;
    it.site = k;
    it.limb = limb;
    it.px = px;
    it.py = py;
    it.placed = true;
    this.push(px, py, px + it.w, py + LABEL_H);
    return true;
  }

  private setNoName(cap: CapitalItem, on: boolean): void {
    if (cap.noName === on) return;
    cap.noName = on;
    cap.el?.classList.toggle('wo-noname', on);
  }

  private setRev(cap: CapitalItem, rev: boolean): void {
    this.setCapSide(cap, rev ? 1 : 0);
  }

  private setCapSide(cap: CapitalItem, side: number): void {
    if (cap.side === side) return;
    cap.side = side;
    cap.rev = side === 1;
    const c = cap.el?.classList;
    c?.toggle('wo-rev', side === 1);
    c?.toggle('wo-up', side === 2);
    c?.toggle('wo-down', side === 3);
  }

  // ---------- leader lines ----------

  private updateLines(anchor: ProjectedPoint | null, op: number, cx: number, cy: number, r: number): void {
    const { details, news } = this.panels;
    if (anchor) {
      // The anchor must be in the free area between the panels and below the header. Fade out over 24px outside it.
      let x0 = 0;
      let x1 = this.width;
      let y1 = this.height;
      if (this.mobile) {
        if (details) y1 = Math.min(y1, details.top);
      } else {
        if (details && details.width > 0) x0 = Math.max(x0, details.right);
        if (news && news.width > 0) x1 = Math.min(x1, news.left);
      }
      const out = Math.max(x0 - anchor.x, anchor.x - x1, this.topInset - anchor.y, anchor.y - y1, 0);
      op *= clamp(1 - out / 24, 0, 1);
    }
    const show = anchor !== null && op > 0 && (this.mobile ? details !== null : details !== null || news !== null);
    if (!show || !anchor) {
      if (this.linesOn) {
        this.svg.style.display = 'none';
        this.linesOn = false;
      }
      return;
    }
    const ax = anchor.x;
    const ay = anchor.y;
    const ins: [number, number][] = [];

    let left: string | null = null;
    let leftTick = '';
    let right: string | null = null;
    let rightTick = '';
    if (this.mobile && details) {
      // One short vertical line into the sheet.
      const top = details.top;
      if (top - ay > 24) {
        const sx = Math.round(ax) + 0.5;
        const ty = Math.round(top) - 1;
        left = `M${sx} ${Math.round(ay) + 0.5}V${top.toFixed(1)}`;
        leftTick = `M${sx - 6} ${ty}H${sx + 6}`;
        this.push(ax - 6, ay, ax + 6, top);
      }
    } else {
      if (details) {
        const res = this.leader(ax, ay, details.right, -1, details, ins);
        if (res) [left, leftTick] = res;
      }
      if (news) {
        const res = this.leader(ax, ay, news.left, 1, news, ins);
        if (res) [right, rightTick] = res;
      }
    }

    if (!this.linesOn) {
      this.svg.style.display = '';
      this.linesOn = true;
    }
    this.discIn.setAttribute('cx', cx.toFixed(1));
    this.discIn.setAttribute('cy', cy.toFixed(1));
    this.discIn.setAttribute('r', r.toFixed(1));
    this.discOut.setAttribute('cx', cx.toFixed(1));
    this.discOut.setAttribute('cy', cy.toFixed(1));
    this.discOut.setAttribute('r', r.toFixed(1));
    const xy = `${ax.toFixed(1)} ${ay.toFixed(1)}`;
    if (xy !== this.dotXY) {
      this.dot.setAttribute('cx', ax.toFixed(1));
      this.dot.setAttribute('cy', ay.toFixed(1));
      this.dotXY = xy;
    }
    const q = Math.round(op * 20) / 20;
    if (q !== this.linesOp) {
      this.svg.style.opacity = String(q);
      this.linesOp = q;
    }
    this.setSide(this.sides[0], left, leftTick);
    this.setSide(this.sides[1], right, rightTick);
    for (const [x, y] of ins) this.push(x - 5, y - 5, x + 5, y + 5);
    this.lineTo = this.nBoxes;
    this.push(ax - 6, ay - 6, ax + 6, ay + 6);

    if (this.drawPending) {
      this.drawPending = false;
      if (!this.reducedMotion.matches) {
        const timing: KeyframeAnimationOptions = { duration: DRAW_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
        for (const s of this.sides) {
          if (!s.on) continue;
          for (const p of [s.out, s.inn]) p.animate?.([{ strokeDasharray: '0 1' }, { strokeDasharray: '1 0' }], timing);
          s.tick.animate?.([{ opacity: 0 }, { opacity: 0, offset: 0.8 }, { opacity: 1 }], timing);
        }
        this.dot.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 120 });
      }
    }
  }

  /**
   * One leader line: from the anchor, a 45° run toward the target height, then a horizontal run into the panel edge.
   * dir = -1 for the panel on the left, +1 for the panel on the right. Adds sample points of the line to `pts`.
   */
  private leader(ax: number, ay: number, edge: number, dir: -1 | 1, panel: DOMRect, pts: [number, number][]): [string, string] | null {
    if (ax < 0 || ax > this.width || ay < 0 || ay > this.height) return null;
    const room = (edge - ax) * dir;
    if (room < 32) return null;
    const top = Math.max(panel.top, 0) + 32;
    const bottom = Math.min(panel.bottom, this.height) - 32;
    if (bottom <= top) return null;
    // Snap to n + 0.5 so the 1px runs render as crisp hairlines.
    const sx = Math.round(ax) + 0.5;
    const sy = Math.round(ay) + 0.5;
    const ty = Math.round(clamp(ay + RISE * dir, top, bottom)) + 0.5;
    const dy = ty - sy;
    const d = Math.max(0, Math.min(Math.abs(dy), Math.floor(room - 24)));
    const ex = sx + d * dir;
    const ey = sy + Math.sign(dy) * d;
    const ed = Math.round(edge);
    let path = `M${sx} ${sy}L${ex} ${ey}`;
    if (Math.abs(ey - ty) > 0.5) path += `V${ty}`;
    path += `H${ed}`;
    // The tick sits just outside the panel edge, so the panel does not cover it.
    const tx = ed - dir * 1;
    const tick = `M${tx} ${ty - 6}V${ty + 6}`;
    // Keep labels off the line: sample the diagonal, and block the horizontal run as one box.
    for (let s = 8; s < d; s += 10) pts.push([ax + s * dir, ay + Math.sign(dy) * s]);
    // Step a fixed count: a "step until near ty" loop can overshoot and swing back and forth forever.
    const vSteps = Math.floor(Math.abs(ty - ey) / 10);
    const vDir = Math.sign(ty - ey);
    for (let k = 0; k <= vSteps; k++) pts.push([ex, ey + vDir * k * 10]);
    this.push(Math.min(ex, edge), ty - 5, Math.max(ex, edge), ty + 5);
    return [path, tick];
  }

  private setSide(s: LineSide, d: string | null, tick: string): void {
    if (!d) {
      if (s.on) {
        s.g.style.display = 'none';
        s.on = false;
      }
      return;
    }
    if (!s.on) {
      s.g.style.display = '';
      s.on = true;
    }
    if (d !== s.d) {
      s.out.setAttribute('d', d);
      s.inn.setAttribute('d', d);
      s.d = d;
    }
    if (tick !== s.tickD) {
      s.tick.setAttribute('d', tick);
      s.tickD = tick;
    }
  }
}
