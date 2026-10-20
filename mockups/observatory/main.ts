// Mockup: "Dark observatory" direction. China selected, globe faces China.
// Two WebGL layers: #base (the whole globe, blurred and dimmed by CSS) and #focus (only the
// selected country, sharp). An SVG layer draws the selected outline and the leader lines.

import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  LineSegments,
  LinearFilter,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { MultiPolygon, Polygon, Position } from 'geojson';
import { buildGlobeGeometry } from '../../src/globe/geometry';
import * as fmt from '../../src/ui/format';
import type { CountryFeature, CountryInfo } from '../../src/types';

type WorldTopology = Topology<{ countries: GeometryCollection<{ id: string; name: string }> }>;

const SEL = 'CHN';
const style = new URLSearchParams(location.search).get('style') === 'atlas' ? 'atlas' : 'satellite';
document.body.classList.add(`style-${style}`);
document.querySelectorAll<HTMLElement>('.seg a').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.style === style)));

const C = {
  accent: '#F2B45A',
  ocean: '#101215',
  land: '#1E2228',
  border: style === 'atlas' ? '#6E7681' : '#E6E9EE',
  graticule: '#171A1F',
  leader: '#5B616B',
};

const LIFT = 0.022;
const FOV = 30;

// Capital coordinates (countries.json has no capital positions).
const CAPITALS: Record<string, [number, number]> = {
  CHN: [39.9, 116.41],
  MNG: [47.92, 106.92],
  KAZ: [51.17, 71.45],
  IND: [28.61, 77.21],
  PAK: [33.69, 73.05],
  AFG: [34.53, 69.17],
  NPL: [27.72, 85.32],
  BGD: [23.81, 90.41],
  MMR: [19.76, 96.08],
  THA: [13.76, 100.5],
  LAO: [17.97, 102.63],
  VNM: [21.03, 105.85],
  KHM: [11.56, 104.92],
  PRK: [39.04, 125.76],
  KOR: [37.57, 126.98],
  JPN: [35.68, 139.69],
  TWN: [25.03, 121.57],
  PHL: [14.6, 120.98],
  UZB: [41.3, 69.24],
  KGZ: [42.87, 74.59],
  TJK: [38.56, 68.79],
  TKM: [37.96, 58.33],
  IRN: [35.69, 51.39],
  MYS: [3.14, 101.69],
  IDN: [-6.21, 106.85],
  BTN: [27.47, 89.64],
  RUS: [55.76, 37.62],
};

const STORIES = [
  { source: 'Reuters', time: '2h', title: 'China sends naval forces to monitor US warship near disputed shoal' },
  { source: 'Washington Post', time: '4h', title: 'Russia proposes a Trump-Xi-Putin meeting in China next month' },
  { source: 'Foreign Affairs', time: '3h', title: "The China Price: Beijing's Green Path to Ending Dollar Dominance" },
  { source: 'Mercator Institute for China Studies', time: '3h', title: 'Germany and China in the cleantech sector' },
  { source: 'Reuters', time: '6h', title: "China's exports beat forecasts as shipments to Europe rise" },
];

// ---------------------------------------------------------------- shaders

const dirToUv = /* glsl */ `
  uniform sampler2D tMap;
  vec3 sat(vec3 d) {
    vec2 uv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415927 + 0.5);
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    dx.x -= floor(dx.x + 0.5);
    dy.x -= floor(dy.x + 0.5);
    return textureGrad(tMap, uv, dx, dy).rgb;
  }
`;

const sphereVert = /* glsl */ `
  varying vec3 vDir;
  varying vec3 vN;
  void main() {
    vDir = position;
    vN = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const sphereFrag = /* glsl */ `
  uniform float uSat;
  uniform vec3 uOcean;
  ${dirToUv}
  varying vec3 vDir;
  varying vec3 vN;
  void main() {
    float nz = max(normalize(vN).z, 0.0);
    vec3 c;
    if (uSat > 0.5) {
      c = sat(normalize(vDir));
      c = pow(c, vec3(1.08)) * mix(0.55, 1.0, pow(nz, 0.7));
    } else {
      c = uOcean * mix(0.8, 1.0, nz);
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;

const landHead = /* glsl */ `
  attribute float countryIndex;
  attribute float kind;
  uniform float uSel;
  uniform float uLift;
  uniform float uOff;
  float isSel() { return abs(countryIndex - uSel) < 0.5 ? 1.0 : 0.0; }
  vec4 place() {
    float r = 1.0 + uOff + kind * isSel() * uLift;
    return modelViewMatrix * vec4(position * r, 1.0);
  }
`;
const landVert = /* glsl */ `
  ${landHead}
  flat varying float vKind;
  varying float vSel;
  varying vec3 vDir;
  varying vec3 vView;
  varying vec3 vN;
  void main() {
    vec4 mv = place();
    vKind = kind;
    vSel = isSel();
    vDir = position;
    vView = mv.xyz;
    vN = normalize(normalMatrix * position);
    gl_Position = projectionMatrix * mv;
  }
`;
const landFrag = /* glsl */ `
  uniform float uSat;
  uniform vec3 uLand;
  uniform vec3 uAccent;
  ${dirToUv}
  flat varying float vKind;
  varying float vSel;
  varying vec3 vDir;
  varying vec3 vView;
  varying vec3 vN;
  void main() {
    float nz = max(normalize(vN).z, 0.0);
    if (vKind > 0.5) {
      vec3 c;
      if (uSat > 0.5) {
        c = sat(normalize(vDir));
        c = mix(c * 1.08, uAccent, 0.16 * vSel);
      } else {
        c = mix(uLand, mix(uLand, uAccent, 0.18), vSel);
      }
      gl_FragColor = vec4(c * mix(uSat > 0.5 ? 0.78 : 0.9, 1.0, nz), 1.0);
    } else {
      vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
      if (dot(n, vView) > 0.0) n = -n;
      float l = 0.45 + 0.35 * max(dot(n, normalize(vec3(-0.4, 0.7, 0.6))), 0.0);
      gl_FragColor = vec4(uAccent * l * 0.75, 1.0);
    }
  }
`;
const lineVert = /* glsl */ `
  ${landHead}
  void main() { gl_Position = projectionMatrix * place(); }
`;
const flatFrag = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() { gl_FragColor = vec4(uColor, uAlpha); }
`;
const gratVert = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// ---------------------------------------------------------------- data

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  return (await r.json()) as T;
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

function loadTexture(url: string): Promise<Texture> {
  return new Promise((res, rej) => new TextureLoader().load(url, res, undefined, rej));
}

// ---------------------------------------------------------------- panels

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...kids: (Node | string | null)[]) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}
function num(s: string) {
  return el('span', 'num', s);
}
function yr(y: number | null) {
  return y ? el('span', 'yr', String(y)) : null;
}

function buildDetails(c: CountryInfo, nameOf: (id: string) => string | null, mobile: boolean) {
  const root = document.getElementById('details')!;
  const head = el(
    'header',
    'd-head',
    Object.assign(document.createElement('img'), { className: 'd-flag', src: c.flag ?? '', alt: `Flag of ${c.name}` }),
    el('h2', 'd-name', c.name),
    el('p', 'd-official', c.officialName ?? ''),
    el('p', 'd-coords', `${c.latlng![0].toFixed(2)}° N   ${c.latlng![1].toFixed(2)}° E   ·   ${c.iso2} / ${c.id}`),
  );
  const row = (k: string, ...v: (Node | string | null)[]) => {
    const dd = el('dd', '', ...v);
    return el('div', 'd-row', el('dt', '', k), dd);
  };
  const sec = (title: string, ...rows: HTMLElement[]) => el('section', 'd-sec', el('h3', '', title), el('dl', '', ...rows));
  const g = c.government;
  const e = c.economy;
  const borders = c.borders.map(nameOf).filter((n): n is string => !!n).sort();
  const bordersRow = row('Borders', `${borders.slice(0, 4).join(', ')} and ${borders.length - 4} more`);
  (bordersRow.lastChild as HTMLElement).classList.add('long');
  const cur = c.currencies[0];

  const sections = [
    sec(
      'Geography',
      row('Capital', c.capital.join(', ')),
      row('Region', `${c.region} · ${c.subregion}`),
      row('Area', num(fmt.area(c.area!))),
      bordersRow,
      row('Time zones', num(c.timezones.join(', ').replace(/:00/g, ''))),
    ),
    sec(
      'People',
      row('Population', num(fmt.compactNumber(c.population!)), yr(c.populationYear)),
      row('Languages', c.languages.join(', ')),
      row('Life expectancy', num(`${fmt.decimal1(c.demographics.lifeExpectancy!)} yrs`)),
      row('Urban', num(`${fmt.decimal1(c.demographics.urbanPopulationPct!)}%`)),
    ),
    sec(
      'Government',
      row('Type', 'One-party socialist republic'),
      row(g.headOfStateTitle ?? 'Head of state', g.headOfState ?? ''),
      row(g.headOfGovernmentTitle ?? 'Head of government', g.headOfGovernment ?? ''),
    ),
    sec(
      'Economy',
      row('GDP', num(fmt.compactUsd(e.gdpUsd!).replace(' trillion', 'T')), yr(e.gdpYear)),
      row('GDP per capita', num(fmt.usd(e.gdpPerCapitaUsd!))),
      row('HDI', num(fmt.hdi(e.hdi!)), yr(e.hdiYear)),
      row('Currency', `${cur.name} `, el('span', 'yr', `${cur.symbol} ${cur.code}`)),
    ),
  ];
  if (mobile) {
    const tabs = el('nav', 'sheet-tabs');
    const a1 = el('a', 'on', 'Overview');
    const a2 = el('a', '', 'Top stories', el('span', 'num', '5'));
    tabs.append(a1, a2);
    root.replaceChildren(el('div', 'sheet-handle'), head, tabs, ...sections);
  } else {
    root.replaceChildren(head, ...sections);
  }
}

function buildNews() {
  const root = document.getElementById('news')!;
  const list = el('ol', 'n-list');
  for (const s of STORIES) {
    const meta = el('div', 'n-meta', el('span', '', s.source), Object.assign(el('time', '', s.time + ' ago')));
    list.append(el('li', '', Object.assign(el('a', 'n-item', meta, el('div', 'n-title', s.title)), { href: '#' })));
  }
  root.replaceChildren(el('header', 'n-head', el('h2', '', 'Top stories'), el('span', '', 'Updated 09:41 UTC')), list);
}

// ---------------------------------------------------------------- main

async function start() {
  const [topo, countries] = await Promise.all([
    json<WorldTopology>('/data/world.json'),
    json<Record<string, CountryInfo>>('/data/countries.json'),
  ]);
  const features = toFeatures(topo);
  const selIndex = features.findIndex((f) => f.id === SEL);
  const info = countries[SEL];
  const nameOf = (id: string) => countries[id]?.name ?? features.find((f) => f.id === id)?.name ?? null;

  const W = innerWidth;
  const H = innerHeight;
  const mobile = W <= 700;
  const topH = mobile ? 52 : 56;
  const sheetTop = mobile ? Math.round(H * 0.53) : H;

  buildDetails(info, nameOf, mobile);
  buildNews();
  document.getElementById('credit')!.textContent =
    style === 'satellite' ? 'Imagery: NASA Blue Marble  ·  Borders: Natural Earth' : 'Borders: Natural Earth';

  // Globe placement.
  const R = mobile ? 168 : 372;
  const cx = W / 2;
  const cy = mobile ? topH + (sheetTop - topH) / 2 + 4 : topH + (H - topH) / 2 + 4;
  const t = Math.tan(((FOV / 2) * Math.PI) / 180);
  const alpha = Math.atan((R * 2 * t) / H);
  const dist = 1 / Math.sin(alpha);

  const camera = new PerspectiveCamera(FOV, W / H, 0.1, 20);
  camera.position.set(0, 0, dist);
  camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  camera.updateMatrixWorld();

  // Face a point a little south-west of China's centre, so the raised walls show.
  const face = mobile ? { lat: 29, lon: 101 } : { lat: 27, lon: 99 };
  const makeGroup = () => {
    const g = new Group();
    g.rotation.set((face.lat * Math.PI) / 180, (-face.lon * Math.PI) / 180, 0, 'XYZ');
    g.updateMatrixWorld();
    return g;
  };

  const tex = style === 'satellite' ? await loadTexture('/textures/earth-4k.jpg') : null;
  if (tex) {
    tex.colorSpace = NoColorSpace;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.magFilter = LinearFilter;
    tex.anisotropy = 8;
  }

  const data = buildGlobeGeometry(features);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(data.positions, 3));
  geo.setAttribute('countryIndex', new BufferAttribute(new Float32Array(data.countryIndex), 1));
  geo.setAttribute('kind', new BufferAttribute(new Float32Array(data.kind), 1));
  const triIndex = new BufferAttribute(data.triangles, 1);
  const lineIndex = new BufferAttribute(data.lines, 1);
  const landGeo = geo.clone();
  landGeo.setIndex(triIndex);
  const borderGeo = geo.clone();
  borderGeo.setIndex(lineIndex);
  const selGeo = geo.clone();
  selGeo.setIndex(triIndex);
  const tr = data.triangleRanges[selIndex];
  selGeo.setDrawRange(tr.start, tr.count);

  const col = (h: string) => new Color().setStyle(h, LinearSRGBColorSpace);
  const common = { uSel: { value: selIndex }, uLift: { value: LIFT }, uOff: { value: 0.0006 } };
  const landMat = new ShaderMaterial({
    vertexShader: landVert,
    fragmentShader: landFrag,
    uniforms: {
      ...common,
      uSat: { value: style === 'satellite' ? 1 : 0 },
      uLand: { value: col(C.land) },
      uAccent: { value: col(C.accent) },
      tMap: { value: tex },
    },
  });
  const borderMat = new ShaderMaterial({
    vertexShader: lineVert,
    fragmentShader: flatFrag,
    transparent: true,
    depthWrite: false,
    uniforms: { ...common, uOff: { value: 0.0016 }, uColor: { value: col(C.border) }, uAlpha: { value: style === 'atlas' ? 0.9 : 0.55 } },
  });

  const makeRenderer = (canvas: HTMLCanvasElement, alpha: boolean) => {
    const r = new WebGLRenderer({ canvas, antialias: true, alpha });
    r.setPixelRatio(devicePixelRatio);
    r.setSize(W, H, false);
    r.outputColorSpace = LinearSRGBColorSpace;
    r.setClearColor(0x0b0c0e, alpha ? 0 : 1);
    return r;
  };

  // Base layer: the whole globe.
  const baseScene = new Scene();
  const baseGroup = makeGroup();
  baseScene.add(baseGroup);
  const sphere = new Mesh(
    new SphereGeometry(1, 160, 120),
    new ShaderMaterial({
      vertexShader: sphereVert,
      fragmentShader: sphereFrag,
      uniforms: { uSat: { value: style === 'satellite' ? 1 : 0 }, uOcean: { value: col(C.ocean) }, tMap: { value: tex } },
    }),
  );
  baseGroup.add(sphere);
  if (style === 'atlas') {
    baseGroup.add(new Mesh(landGeo, landMat));
    // Graticule every 15 degrees.
    const pts: number[] = [];
    const v = (lat: number, lon: number) => {
      const p = (lat * Math.PI) / 180;
      const l = (lon * Math.PI) / 180;
      const r = 1.0004;
      return [Math.cos(p) * Math.sin(l) * r, Math.sin(p) * r, Math.cos(p) * Math.cos(l) * r];
    };
    for (let lat = -75; lat <= 75; lat += 15)
      for (let lon = -180; lon < 180; lon += 2) pts.push(...v(lat, lon), ...v(lat, lon + 2));
    for (let lon = -180; lon < 180; lon += 15)
      for (let lat = -80; lat < 80; lat += 2) pts.push(...v(lat, lon), ...v(lat + 2, lon));
    const gg = new BufferGeometry();
    gg.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
    const gm = new ShaderMaterial({
      vertexShader: gratVert,
      fragmentShader: flatFrag,
      uniforms: { uColor: { value: col('#2A2F37') }, uAlpha: { value: 1 } },
    });
    const grat = new LineSegments(gg, gm);
    grat.renderOrder = -1;
    baseGroup.add(grat);
  } else {
    baseGroup.add(new Mesh(selGeo, landMat));
  }
  baseGroup.add(new LineSegments(borderGeo, borderMat));
  const base = makeRenderer(document.getElementById('base') as HTMLCanvasElement, false);
  base.render(baseScene, camera);

  // Focus layer: only the selected country, sharp.
  const focusScene = new Scene();
  const focusGroup = makeGroup();
  focusScene.add(focusGroup);
  focusGroup.add(new Mesh(selGeo, landMat));
  const focus = makeRenderer(document.getElementById('focus') as HTMLCanvasElement, true);
  focus.render(focusScene, camera);

  // ------------------------------------------------------------ projection
  const tmp = new Vector3();
  const camPos = camera.position.clone();
  const project = (lat: number, lon: number, r = 1.0) => {
    const p = (lat * Math.PI) / 180;
    const l = (lon * Math.PI) / 180;
    tmp.set(Math.cos(p) * Math.sin(l), Math.sin(p), Math.cos(p) * Math.cos(l)).multiplyScalar(r);
    tmp.applyMatrix4(baseGroup.matrixWorld);
    const n = tmp.clone().normalize();
    const facing = n.dot(camPos.clone().sub(tmp).normalize());
    tmp.project(camera);
    return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H, facing };
  };

  // ------------------------------------------------------------ SVG overlay
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.getElementById('overlay') as unknown as SVGSVGElement;
  const under = document.getElementById('under') as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  under.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const add = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent.append(e);
    return e;
  };

  // Globe limb: a 1px ring, so the dark atlas globe reads against space.
  add('circle', { cx, cy, r: R + 0.5, fill: 'none', stroke: '#262A31', 'stroke-width': 1 }, under);

  // Selected outline (raised radius).
  const sel = features[selIndex];
  const polys: Position[][][] = sel.geometry.type === 'Polygon' ? [sel.geometry.coordinates] : sel.geometry.coordinates;
  let d = '';
  for (const poly of polys) {
    const ring = poly[0];
    let last: { x: number; y: number } | null = null;
    ring.forEach((pt, i) => {
      const s = project(pt[1], pt[0], 1 + LIFT + 0.0006);
      if (last && i < ring.length - 1 && Math.hypot(s.x - last.x, s.y - last.y) < 0.6) return;
      d += `${i === 0 ? 'M' : 'L'}${s.x.toFixed(1)},${s.y.toFixed(1)}`;
      last = s;
    });
    d += 'Z';
  }
  add('path', { d, fill: 'none', stroke: C.accent, 'stroke-width': 1.25, 'stroke-linejoin': 'round' }, under);
  const selPath = new Path2D(d);
  const hitCtx = document.createElement('canvas').getContext('2d')!;
  hitCtx.lineWidth = 8;
  const onSel = (b: Box) => {
    for (let i = 0; i <= 4; i++)
      for (const y of [b.y, b.y + b.h / 2, b.y + b.h]) {
        const x = b.x + (b.w * i) / 4;
        if (hitCtx.isPointInPath(selPath, x, y) || hitCtx.isPointInStroke(selPath, x, y)) return true;
      }
    return false;
  };

  // ------------------------------------------------------------ leader lines
  const anchor = project(info.latlng![0], info.latlng![1], 1 + LIFT);
  const obstacles: Box[] = [];
  const casing = add('g', { fill: 'none', stroke: '#0B0C0E', 'stroke-opacity': 0.55, 'stroke-width': 3 });
  const g = add('g', { fill: 'none', stroke: C.leader, 'stroke-width': 1 });
  const leader = (d: string) => {
    add('path', { d }, casing);
    add('path', { d }, g);
  };
  const end = (x: number, y: number) => add('rect', { x: x - 2.5, y: y - 2.5, width: 5, height: 5, fill: '#0B0C0E', stroke: '#8A9099' });
  const text = (x: number, y: number, s: string, cls: string, anchorSide: 'start' | 'end' = 'end') => {
    const t = document.createElement('div');
    t.className = `lbl ${cls}`;
    t.textContent = s;
    document.getElementById('labels')!.append(t);
    const b = t.getBoundingClientRect();
    const left = anchorSide === 'end' ? x - b.width : x;
    t.style.transform = `translate(${left}px, ${y - b.height / 2}px)`;
    obstacles.push({ x: left - 4, y: y - b.height / 2 - 2, w: b.width + 8, h: b.height + 4 });
    return t;
  };

  if (!mobile) {
    const panelL = 24 + 340;
    const panelR = W - 24 - 340;
    const k = 46;
    // Left: up-left diagonal, then level to the details panel.
    const e1 = { x: anchor.x - k, y: anchor.y - k };
    leader(`M${anchor.x - 4.5 * Math.SQRT1_2},${anchor.y - 4.5 * Math.SQRT1_2}L${e1.x},${e1.y}H${panelL}`);
    end(panelL, e1.y);
    text(panelL + 16, e1.y - 12, 'China', 'lbl-sel', 'start');
    text(panelL + 16, e1.y + 11, '35.00° N  105.00° E', 'lbl-coord', 'start');
    obstacles.push({ x: panelL, y: e1.y - 3, w: e1.x - panelL, h: 6 });
    // Right: down-right diagonal, then level to the news panel.
    const e2 = { x: anchor.x + k, y: anchor.y + k };
    leader(`M${anchor.x + 4.5 * Math.SQRT1_2},${anchor.y + 4.5 * Math.SQRT1_2}L${e2.x},${e2.y}H${panelR}`);
    end(panelR, e2.y);
    text(panelR - 12, e2.y - 10, '5 stories', 'lbl-coord');
    obstacles.push({ x: e2.x, y: e2.y - 3, w: panelR - e2.x, h: 6 });
    obstacles.push({ x: anchor.x - k - 4, y: anchor.y - k - 4, w: 2 * k + 8, h: 2 * k + 8 });
  } else {
    // Mobile: down-left diagonal, then straight down to the sheet edge.
    const k = 22;
    const e1 = { x: anchor.x - k, y: anchor.y + k };
    leader(`M${anchor.x - 4.5 * Math.SQRT1_2},${anchor.y + 4.5 * Math.SQRT1_2}L${e1.x},${e1.y}V${sheetTop}`);
    end(e1.x, sheetTop);
    text(e1.x - 8, e1.y + 18, 'China', 'lbl-sel');
    obstacles.push({ x: e1.x - 3, y: anchor.y, w: k + 6, h: sheetTop - anchor.y });
  }
  // Anchor marker: accent ring.
  add('circle', { cx: anchor.x, cy: anchor.y, r: 4.5, fill: '#0B0C0E', stroke: C.accent, 'stroke-width': 1.25 });
  add('circle', { cx: anchor.x, cy: anchor.y, r: 1.4, fill: C.accent });
  obstacles.push({ x: anchor.x - 8, y: anchor.y - 8, w: 16, h: 16 });

  // ------------------------------------------------------------ labels
  // Panels and header are hard obstacles.
  const blocked: Box[] = [{ x: 0, y: 0, w: W, h: topH + 4 }];
  if (!mobile) {
    blocked.push({ x: 0, y: 0, w: 24 + 340 + 6, h: H });
    const nb = document.getElementById('news')!.getBoundingClientRect();
    blocked.push({ x: nb.left - 6, y: 0, w: W - nb.left + 6, h: nb.bottom + 6 });
  } else {
    blocked.push({ x: 0, y: sheetTop - 4, w: W, h: H });
  }
  const placed: Box[] = [];
  const free = (b: Box) =>
    b.x > 2 &&
    b.x + b.w < W - 2 &&
    !blocked.some((o) => hit(o, b)) &&
    !obstacles.some((o) => hit(o, b)) &&
    !placed.some((o) => hit(o, b)) &&
    !onSel(b) &&
    insideDisc(b, cx, cy, R - 4);

  const layer = document.getElementById('labels')!;
  const make = (cls: string, html: string) => {
    const e = document.createElement('div');
    e.className = `lbl ${cls}`;
    e.innerHTML = html;
    e.style.visibility = 'hidden';
    layer.append(e);
    return e;
  };

  // Capital: ring at the exact point, name to the right (or left).
  const placeCapital = (id: string, primary: boolean) => {
    const ll = CAPITALS[id];
    const c = countries[id];
    if (!ll || !c) return false;
    const s = project(ll[0], ll[1], id === SEL ? 1 + LIFT : 1);
    if (s.facing < 0.3) return false;
    const name = id === 'MNG' ? 'Ulaanbaatar' : c.capital[0];
    const e = make(`lbl-cap${primary ? ' primary' : ''}`, `<i></i><span>${name}</span>`);
    const b = e.getBoundingClientRect();
    const dot = 3.5;
    const right = { x: s.x - dot, y: s.y - b.height / 2, w: b.width, h: b.height };
    const left = { x: s.x - b.width + dot, y: s.y - b.height / 2, w: b.width, h: b.height };
    for (const box of [right, left]) {
      if (box === left) {
        e.style.flexDirection = 'row-reverse';
      }
      if (primary || free(box)) {
        e.style.transform = `translate(${box.x}px, ${box.y}px)`;
        e.style.visibility = 'visible';
        placed.push(pad(box, 3));
        return true;
      }
    }
    e.remove();
    return false;
  };

  placeCapital(SEL, true);

  const cands = Object.values(countries)
    .filter((c) => c.id !== SEL && c.latlng && (c.area ?? 0) > 95000)
    .sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
  const shown: string[] = [];
  for (const c of cands) {
    const [lat, lon] = LABEL_AT[c.id] ?? c.latlng!;
    const s = project(lat, lon);
    if (s.facing < 0.35) continue;
    const e = make('lbl-country', c.id === 'PRK' ? 'N. Korea' : c.id === 'KOR' ? 'S. Korea' : c.name);
    const b = e.getBoundingClientRect();
    const box = { x: s.x - b.width / 2, y: s.y - b.height / 2, w: b.width, h: b.height };
    if (!free(box)) {
      e.remove();
      continue;
    }
    e.style.transform = `translate(${box.x}px, ${box.y}px)`;
    e.style.visibility = 'visible';
    placed.push(pad(box, 6));
    shown.push(c.id);
  }
  for (const id of shown) placeCapital(id, false);

  (window as unknown as { __ready: boolean }).__ready = true;
}

// Better label positions than the representative point for a few countries.
const LABEL_AT: Record<string, [number, number]> = {
  RUS: [62, 98],
  IND: [22, 79],
  KAZ: [48, 67],
  MNG: [45.6, 101.5],
  JPN: [39.5, 141.5],
  PRK: [40.6, 126.4],
  IDN: [-2, 114],
  MYS: [4, 102],
};

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
function hit(a: Box, b: Box) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
function pad(b: Box, p: number): Box {
  return { x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p };
}
function insideDisc(b: Box, cx: number, cy: number, r: number) {
  const corners = [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
  return corners.every(([x, y]) => Math.hypot(x - cx, y - cy) < r);
}

document.fonts.ready.then(start);
