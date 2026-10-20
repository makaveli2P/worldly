// Editorial atlas mockup: China selected, one static state, two map styles (?style=satellite|atlas).

import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  LinearSRGBColorSpace,
  LineSegments,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  Quaternion,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  WebGLRenderer,
} from 'three';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { MultiPolygon, Polygon } from 'geojson';
import { buildGlobeGeometry } from '../../src/globe/geometry';
import * as fmt from '../../src/ui/format';
import type { CountryFeature, CountryId, CountryInfo } from '../../src/types';

void SRGBColorSpace;

type WorldTopology = Topology<{ countries: GeometryCollection<{ id: CountryId; name: string }> }>;

const STYLE: 'satellite' | 'atlas' = new URLSearchParams(location.search).get('style') === 'atlas' ? 'atlas' : 'satellite';
const MOBILE = innerWidth < 700;
const SEL: CountryId = 'CHN';
const FOCUS = { lat: 33.5, lon: 103.5 };

const C = {
  paper: '#F4F1EA',
  ink: '#1B1A17',
  sepia: '#7C6F5E',
  rule: '#CFC6B6',
  accent: '#8E2C21', // oxblood
  accentDark: '#5E1B14',
  ocean: "#C4D2D2",
  borderAtlas: '#9C8F7A',
  tints: ['#E7DDC4', '#D9DDC5', '#E8D5C8', '#D8D9D2', '#E3D9BE'],
};

// Capitals for the countries in view (countries.json has names, not coordinates).
const CAPITALS: Record<string, [string, number, number]> = {
  CHN: ['Beijing', 39.9, 116.4],
  MNG: ['Ulaanbaatar', 47.89, 106.91],
  KAZ: ['Astana', 51.17, 71.43],
  IND: ['New Delhi', 28.61, 77.21],
  PAK: ['Islamabad', 33.69, 73.05],
  AFG: ['Kabul', 34.53, 69.17],
  JPN: ['Tokyo', 35.68, 139.69],
  KOR: ['Seoul', 37.57, 126.98],
  PRK: ['Pyongyang', 39.04, 125.76],
  VNM: ['Hanoi', 21.03, 105.85],
  LAO: ['Vientiane', 17.97, 102.6],
  THA: ['Bangkok', 13.75, 100.5],
  MMR: ['Naypyidaw', 19.76, 96.08],
  BGD: ['Dhaka', 23.81, 90.41],
  NPL: ['Kathmandu', 27.72, 85.32],
  IDN: ['Jakarta', -6.2, 106.85],
  PHL: ['Manila', 14.6, 120.98],
  MYS: ['Kuala Lumpur', 3.14, 101.69],
  KHM: ['Phnom Penh', 11.56, 104.92],
  UZB: ['Tashkent', 41.3, 69.24],
  KGZ: ['Bishkek', 42.87, 74.59],
  TJK: ['Dushanbe', 38.56, 68.77],
  TKM: ['Ashgabat', 37.95, 58.38],
  IRN: ['Tehran', 35.69, 51.39],
  TWN: ['Taipei', 25.03, 121.56],
  RUS: ['Moscow', 55.75, 37.62],
  AUS: ['Canberra', -35.28, 149.13],
  PNG: ['Port Moresby', -9.44, 147.18],
};

const STORIES = [
  { source: 'Reuters', age: '2h', title: 'China sends naval forces to monitor US warship near disputed shoal' },
  { source: 'Washington Post', age: '4h', title: 'Russia proposes a Trump-Xi-Putin meeting in China next month' },
  { source: 'Foreign Affairs', age: '3h', title: 'The China Price: Beijing’s Green Path to Ending Dollar Dominance' },
  { source: 'Mercator Institute for China Studies', age: '3h', title: 'Germany and China in the cleantech sector' },
  { source: 'Reuters', age: '6h', title: 'China’s exports beat forecasts as shipments to Europe rise' },
];

// ---------- DOM helpers ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...kids: (Node | string | null)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const k of kids) if (k !== null) e.append(k);
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

// ---------- Panels ----------
function detailsPanel(c: CountryInfo, nameOf: (id: string) => string | null): HTMLElement {
  const g = c.government;
  const e = c.economy;
  const borderNames = c.borders.map(nameOf).filter((n): n is string => !!n).sort();
  const shown = borderNames.slice(0, 5);
  const borders = `${shown.join(', ')} and ${borderNames.length - shown.length} more`;
  const person = (name: string | null, title: string | null) => {
    const s = el('span', 'person', name ?? '');
    if (title) s.append(el('span', 'role', title));
    return s;
  };
  const rows: [string, [string, string | Node][]][] = [
    [
      'Geography',
      [
        ['Capital', c.capital.join(', ')],
        ['Region', `${c.subregion}`],
        ['Area', fmt.area(c.area!)],
        ['Borders', borders],
        ['Time zones', fmt.timezones(c.timezones)!],
      ],
    ],
    [
      'People',
      [
        ['Population', `${fmt.compactNumber(c.population!)} (${c.populationYear})`],
        ['Languages', c.languages.join(', ')],
        ['Life expectancy', `${c.demographics.lifeExpectancy} years`],
        ['Urban', `${fmt.decimal1(c.demographics.urbanPopulationPct!)}%`],
      ],
    ],
    [
      'Government',
      [
        ['Type', 'One-party socialist republic'],
        ['Head of state', person(g.headOfState, g.headOfStateTitle)],
        ['Head of government', person(g.headOfGovernment, g.headOfGovernmentTitle)],
      ],
    ],
    [
      'Economy',
      [
        ['GDP', `${fmt.compactUsd(e.gdpUsd!)} (${e.gdpYear})`],
        ['GDP per capita', fmt.usd(e.gdpPerCapitaUsd!)],
        ['HDI', `${fmt.hdi(e.hdi!)} (${e.hdiYear})`],
        ['Currency', `${c.currencies[0].name} (${c.currencies[0].symbol}, ${c.currencies[0].code})`],
      ],
    ],
  ];

  const flag = el('img', 'flag') as HTMLImageElement;
  flag.src = c.flag!;
  flag.alt = `Flag of ${c.name}`;
  const head = el(
    'header',
    'country-head',
    el('div', 'kicker', flag, el('span', null, `${c.subregion}`)),
    el('h1', 'country-name', c.name),
    el('p', 'official', c.officialName!),
  );
  const sections = rows.map(([title, list]) => {
    const dl = el('dl');
    for (const [k, v] of list) dl.append(el('div', 'row', el('dt', null, k), el('dd', null, v)));
    return el('section', 'facts', el('h2', 'sc', title), dl);
  });
  const foot = el('p', 'colophon', 'Sources: Wikidata, World Bank. ', el('a', null, 'Read on Wikipedia'));
  return el('aside', 'col col-left', head, ...sections, foot);
}

function storiesPanel(): HTMLElement {
  const list = el('ol', 'stories');
  STORIES.forEach((s, i) => {
    const meta = el('p', 'meta', el('span', 'src', s.source), el('span', 'age', `${s.age} ago`));
    const li = el('li', i === 0 ? 'story lead' : 'story', meta, el('a', 'headline', s.title));
    list.append(li);
  });
  const head = el(
    'header',
    'stories-head',
    el('h1', 'stories-title', 'Top stories'),
    el('p', 'stories-sub', 'On China, from the last 24 hours'),
  );
  return el('aside', 'col col-right', head, list, el('p', 'colophon', 'Headlines link to the publisher.'));
}

function masthead(): HTMLElement {
  const search = el('label', 'search');
  search.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true"><circle cx="6.5" cy="6.5" r="5" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M10.2 10.2 14 14" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
  const input = el('input') as HTMLInputElement;
  input.placeholder = MOBILE ? 'Search' : 'Search a country or capital';
  search.append(input);
  if (!MOBILE) search.append(el('kbd', null, '/'));
  const toggle = el('nav', 'styles');
  for (const [i, name] of ['Satellite', 'Atlas'].entries()) {
    if (i) toggle.append(el('span', 'sep', '/'));
    const b = el('a', name.toLowerCase() === STYLE ? 'on' : null, name) as HTMLAnchorElement;
    b.href = `?style=${name.toLowerCase()}`;
    toggle.append(b);
  }
  const brand = el('div', 'brand', el('span', 'wordmark', 'Worldly'));
  if (!MOBILE) brand.append(el('span', 'dateline', 'Tuesday, 20 October 2026'));
  return el('header', 'mast', brand, search, toggle);
}

// ---------- Globe ----------
const shade = /* glsl */ `
  float shade(vec3 n) {
    vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
    return 0.82 + 0.18 * max(dot(n, L), 0.0);
  }
`;

function lonLat(lon: number, lat: number, r = 1): Vector3 {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  return new Vector3(Math.cos(p) * Math.sin(l) * r, Math.sin(p) * r, Math.cos(p) * Math.cos(l) * r);
}

function hex(c: string): Color {
  return new Color().setStyle(c, LinearSRGBColorSpace); // raw sRGB values: the renderer does no conversion
}

async function start(): Promise<void> {
  const [topo, countries] = await Promise.all([
    fetch('/data/world.json').then((r) => r.json() as Promise<WorldTopology>),
    fetch('/data/countries.json').then((r) => r.json() as Promise<Record<CountryId, CountryInfo>>),
  ]);
  const fc = feature(topo, topo.objects.countries);
  const features: CountryFeature[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    features.push({ id: f.properties.id, name: f.properties.name, geometry: g as Polygon | MultiPolygon });
  }
  const nameOf = (id: string) => countries[id]?.name ?? null;
  const selIndex = features.findIndex((f) => f.id === SEL);

  // App frame.
  const app = document.querySelector<HTMLElement>('#app')!;
  app.dataset.style = STYLE;
  document.body.dataset.style = STYLE;
  const stage = el('div', 'stage');
  const bg = el('canvas', 'globe-bg') as HTMLCanvasElement;
  const W = innerWidth;
  const H = innerHeight;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = LinearSRGBColorSpace;
  renderer.setPixelRatio(devicePixelRatio);
  renderer.setSize(W, H);
  renderer.domElement.className = 'globe-sharp';
  const overlay = svg('svg', { class: 'overlay', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
  stage.append(bg, renderer.domElement, overlay);
  const left = detailsPanel(countries[SEL], nameOf);
  const right = storiesPanel();
  if (MOBILE) {
    const sheet = el('div', 'sheet', el('div', 'grab'), left);
    app.append(masthead(), stage, sheet);
  } else {
    app.append(masthead(), stage, left, right);
  }

  // Geometry.
  const data = buildGlobeGeometry(features);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(data.positions, 3));
  geo.setAttribute('countryIndex', new BufferAttribute(new Float32Array(data.countryIndex), 1));
  geo.setAttribute('kind', new BufferAttribute(new Float32Array(data.kind), 1));

  // Atlas tints: greedy colouring over land borders, so neighbours differ.
  const colorOf = new Map<string, number>();
  const order = [...features].sort((a, b) => (countries[b.id]?.borders.length ?? 0) - (countries[a.id]?.borders.length ?? 0));
  for (const f of order) {
    const used = new Set((countries[f.id]?.borders ?? []).map((n) => colorOf.get(n)).filter((v) => v !== undefined));
    let k = 0;
    while (used.has(k)) k++;
    colorOf.set(f.id, k % C.tints.length);
  }
  const tint = new Float32Array(data.countryIndex.length * 3);
  const tintColors = C.tints.map(hex);
  for (let i = 0; i < data.countryIndex.length; i++) {
    const c = tintColors[colorOf.get(features[data.countryIndex[i]].id) ?? 0];
    tint[i * 3] = c.r;
    tint[i * 3 + 1] = c.g;
    tint[i * 3 + 2] = c.b;
  }
  geo.setAttribute('tint', new BufferAttribute(tint, 3));

  const scene = new Scene();
  const globe = new Scene();
  scene.add(globe);
  const tex = await new TextureLoader().loadAsync('/textures/earth-4k.jpg');
  tex.colorSpace = NoColorSpace;
  tex.anisotropy = 8;

  const LIFT = 0.022;
  const common = {
    uSel: { value: selIndex },
    uLift: { value: LIFT },
    uTex: { value: tex },
    uSat: { value: STYLE === 'satellite' ? 1 : 0 },
    uAccent: { value: hex(C.accent) },
    uAccentDark: { value: hex(C.accentDark) },
  };

  // Ocean / Blue Marble sphere.
  const sphere = new Mesh(
    new SphereGeometry(1, 192, 128, -Math.PI / 2),
    new ShaderMaterial({
      uniforms: { ...common, uOcean: { value: hex(C.ocean) } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN;
        void main(){ vUv = uv; vN = normalize(normalMatrix * position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uSat; uniform vec3 uOcean;
        varying vec2 vUv; varying vec3 vN;
        ${shade}
        void main(){
          vec3 n = normalize(vN);
          vec3 c = uSat > 0.5 ? texture2D(uTex, vUv).rgb : uOcean;
          float s = uSat > 0.5 ? (0.72 + 0.34 * max(dot(n, normalize(vec3(-0.45,0.55,0.7))),0.0)) : shade(n);
          gl_FragColor = vec4(c * s, 1.0);
        }`,
    }),
  );
  globe.add(sphere);

  // Land: atlas fills every country; satellite draws only the raised selection.
  const land = new Mesh(
    geo,
    new ShaderMaterial({
      uniforms: common,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      vertexShader: /* glsl */ `
        attribute float countryIndex; attribute float kind; attribute vec3 tint;
        uniform float uSel; uniform float uLift;
        varying vec3 vDir; varying float vSel; flat varying float vKind; varying vec3 vTint; varying vec3 vN; varying vec3 vView;
        void main(){
          float s = abs(countryIndex - uSel) < 0.5 ? 1.0 : 0.0;
          float r = 1.0015 + kind * s * uLift;
          vDir = position; vSel = s; vKind = kind; vTint = tint;
          vec4 mv = modelViewMatrix * vec4(position * r, 1.0);
          vView = mv.xyz; vN = normalize(normalMatrix * position);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; uniform float uSat; uniform vec3 uAccent; uniform vec3 uAccentDark;
        varying vec3 vDir; varying float vSel; flat varying float vKind; varying vec3 vTint; varying vec3 vN; varying vec3 vView;
        ${shade}
        void main(){
          if (uSat > 0.5 && vSel < 0.5) discard;
          if (vKind < 0.5) {
            vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
            if (dot(n, vView) > 0.0) n = -n;
            gl_FragColor = vec4(uAccentDark * (0.75 + 0.35 * max(dot(n, normalize(vec3(-0.45,0.55,0.7))),0.0)), 1.0);
            return;
          }
          vec3 d = normalize(vDir);
          vec3 base;
          if (uSat > 0.5) {
            vec2 uv = vec2(atan(d.x, d.z) / 6.2831853 + 0.5, asin(d.y) / 3.1415926 + 0.5);
            vec3 t = texture2D(uTex, uv).rgb;
            float lum = dot(t, vec3(0.3, 0.59, 0.11));
            base = mix(t, uAccent * (0.42 + 0.75 * lum), 0.66);
          } else {
            base = vSel > 0.5 ? uAccent : vTint;
          }
          gl_FragColor = vec4(base * shade(normalize(vN)), 1.0);
        }`,
    }),
  );
  globe.add(land);

  // Borders.
  const lineMat = (color: string, alpha: number, onlySel: number) =>
    new ShaderMaterial({
      uniforms: { ...common, uColor: { value: hex(color) }, uAlpha: { value: alpha }, uOnly: { value: onlySel } },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float countryIndex; uniform float uSel; uniform float uLift; varying float vSel;
        void main(){
          float s = abs(countryIndex - uSel) < 0.5 ? 1.0 : 0.0; vSel = s;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position * (1.002 + s * uLift), 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uAlpha; uniform float uOnly; varying float vSel;
        void main(){ if (uOnly > 0.5 && vSel < 0.5) discard; gl_FragColor = vec4(uColor, uAlpha); }`,
    });
  const lineGeo = geo.clone();
  lineGeo.setIndex(new BufferAttribute(data.lines, 1));
  globe.add(
    new LineSegments(lineGeo, STYLE === 'satellite' ? lineMat('#F4F1EA', 0.42, 0) : lineMat(C.borderAtlas, 0.75, 0)),
  );
  globe.add(new LineSegments(lineGeo, lineMat(STYLE === 'satellite' ? '#F1D9C9' : '#F4F1EA', 0.95, 1)));
  geo.setIndex(new BufferAttribute(data.triangles, 1));

  // Graticule every 15 degrees.
  const grat: number[] = [];
  for (let lat = -75; lat <= 75; lat += 15)
    for (let lon = -180; lon < 180; lon += 2) grat.push(...lonLat(lon, lat, 1.0012).toArray(), ...lonLat(lon + 2, lat, 1.0012).toArray());
  for (let lon = -180; lon < 180; lon += 15)
    for (let lat = -80; lat < 80; lat += 2) grat.push(...lonLat(lon, lat, 1.0012).toArray(), ...lonLat(lon, lat + 2, 1.0012).toArray());
  const gratGeo = new BufferGeometry();
  gratGeo.setAttribute('position', new BufferAttribute(new Float32Array(grat), 3));
  gratGeo.setAttribute('countryIndex', new BufferAttribute(new Float32Array(grat.length / 3).fill(-9), 1));
  globe.add(new LineSegments(gratGeo, STYLE === 'satellite' ? lineMat('#F4F1EA', 0.1, 0) : lineMat('#7C8E8A', 0.28, 0)));

  // Orientation: China faces the camera, north up.
  const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), (-FOCUS.lon * Math.PI) / 180);
  const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (FOCUS.lat * Math.PI) / 180);
  globe.quaternion.copy(qx.multiply(qy));
  globe.updateMatrixWorld(true);

  // Camera framing: globe radius R px centred at (cx, cy).
  const header = MOBILE ? 56 : 76;
  const R = MOBILE ? 168 : 318;
  const cx = MOBILE ? W / 2 : W / 2;
  const cy = MOBILE ? header + 16 + R : header + (H - header) / 2;
  const FOV = 24;
  const camera = new PerspectiveCamera(FOV, W / H, 0.1, 50);
  const alpha = Math.atan((2 * R * Math.tan(((FOV / 2) * Math.PI) / 180)) / H);
  const dist = 1 / Math.sin(alpha);
  camera.position.set(0, 0, dist);
  camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
  camera.updateMatrixWorld();

  renderer.render(scene, camera);
  bg.width = W * devicePixelRatio;
  bg.height = H * devicePixelRatio;
  bg.getContext('2d')!.drawImage(renderer.domElement, 0, 0);

  // Projection helper.
  const camPos = camera.position.clone();
  const project = (lon: number, lat: number, r = 1.002) => {
    const p = lonLat(lon, lat, r).applyQuaternion(globe.quaternion);
    const facing = p.clone().normalize().dot(camPos.clone().sub(p).normalize());
    const s = p.clone().project(camera);
    return { x: ((s.x + 1) / 2) * W, y: ((1 - s.y) / 2) * H, facing };
  };

  // Focus: sharp around China, the rest blurred.
  const focus = project(FOCUS.lon, FOCUS.lat);
  const fr = MOBILE ? 120 : 210;
  const mask = `radial-gradient(circle ${fr * 1.25}px at ${focus.x}px ${focus.y}px, #000 ${fr * 0.62}px, transparent ${fr * 1.25}px)`;
  renderer.domElement.style.maskImage = mask;
  renderer.domElement.style.setProperty('-webkit-mask-image', mask);

  await document.fonts.ready;
  await Promise.all([
    document.fonts.load('italic 400 14px Newsreader'),
    document.fonts.load('400 11px Newsreader'),
  ]);

  drawOverlay({ overlay, project, focus, R, cx, cy, countries, features, left, right, W, H, fr });
  document.body.dataset.ready = '1';
}

// ---------- Labels and leader lines ----------
interface OverlayArgs {
  overlay: SVGSVGElement;
  project: (lon: number, lat: number, r?: number) => { x: number; y: number; facing: number };
  focus: { x: number; y: number };
  R: number;
  cx: number;
  cy: number;
  countries: Record<CountryId, CountryInfo>;
  features: CountryFeature[];
  left: HTMLElement;
  right: HTMLElement;
  W: number;
  H: number;
  fr: number;
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const hit = (a: Box, b: Box) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

function drawOverlay(o: OverlayArgs): void {
  const { overlay, project, focus, countries } = o;
  const sat = STYLE === 'satellite';
  const measure = document.createElement('canvas').getContext('2d')!;
  const boxes: Box[] = [];
  const inside = (b: Box) =>
    [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([x, y]) => Math.hypot(x - o.cx, y - o.cy) < o.R - 8);
  const place = (b: Box) => {
    if (!inside(b)) return false;
    if (boxes.some((x) => hit(x, b))) return false;
    boxes.push(b);
    return true;
  };
  const labels = svg('g', { class: 'labels' });
  const lines = svg('g', { class: 'leaders' });
  overlay.append(svg('circle', { cx: o.cx, cy: o.cy, r: o.R + 0.5, class: 'limb' }), labels, lines);

  // Opacity falls off outside the focus, like the blur.
  const fade = (x: number, y: number, facing: number) => {
    const edge = facing > 0.42 ? 1 : 0;
    const d = Math.hypot(x - focus.x, y - focus.y);
    const f = d < o.fr ? 1 : Math.max(0.55, 1 - (d - o.fr) / 500);
    return edge * f;
  };

  // China first: its label and the leader anchor are reserved.
  const chinaLabel = MOBILE ? project(101, 35.5, 1.024) : project(102.5, 32.2, 1.024);
  const chinaSize = MOBILE ? 17 : 24;
  measure.font = `italic 400 ${chinaSize}px Newsreader`;
  const cw = measure.measureText('China').width;
  const anchor = MOBILE ? project(104.5, 28.2, 1.024) : project(101.5, 38.4, 1.024);

  const text = (x: number, y: number, s: string, cls: string, opacity: number, anchorPos = 'middle') => {
    const t = svg('text', { x, y, class: cls, 'text-anchor': anchorPos, opacity: opacity.toFixed(2) });
    t.textContent = s;
    labels.append(t);
    return t;
  };

  // China capital first, so Beijing always shows.
  type Cap = { id: string; name: string; lon: number; lat: number };
  const caps: Cap[] = Object.entries(CAPITALS).map(([id, [name, lat, lon]]) => ({ id, name, lat, lon }));
  caps.sort((a, b) => (a.id === SEL ? -1 : b.id === SEL ? 1 : (countries[b.id]?.area ?? 0) - (countries[a.id]?.area ?? 0)));

  // Reserve China's label box and the anchor.
  boxes.push({ x0: chinaLabel.x - cw / 2 - 4, y0: chinaLabel.y - chinaSize * 0.8, x1: chinaLabel.x + cw / 2 + 4, y1: chinaLabel.y + chinaSize * 0.3 });
  boxes.push({ x0: anchor.x - 8, y0: anchor.y - 8, x1: anchor.x + 8, y1: anchor.y + 8 });

  // Leader lines: from one open circle on China to the inner rule of each column.
  const anchorDot = () => {
    lines.append(svg('circle', { cx: anchor.x, cy: anchor.y, r: 4.5, class: 'anchor-case' }));
    lines.append(svg('circle', { cx: anchor.x, cy: anchor.y, r: 4.5, class: 'anchor' }));
    lines.append(svg('circle', { cx: anchor.x, cy: anchor.y, r: 1.2, class: 'anchor-dot' }));
  };
  const curve = (tx: number, ty: number, dir: -1 | 1) => {
    // Leave the circle at an angle, then settle into a horizontal run into the column rule.
    const sx = anchor.x + dir * 4.5 * Math.cos(Math.PI / 5);
    const sy = anchor.y - 4.5 * Math.sin(Math.PI / 5);
    const dx = Math.abs(tx - sx);
    const d = `M${sx.toFixed(1)},${sy.toFixed(1)} C${(sx + dir * dx * 0.12).toFixed(1)},${(sy + (ty - sy) * 0.55).toFixed(1)} ${(tx - dir * dx * 0.5).toFixed(1)},${ty.toFixed(1)} ${tx.toFixed(1)},${ty.toFixed(1)}`;
    const P = [sx, sy, sx + dir * dx * 0.12, sy + (ty - sy) * 0.55, tx - dir * dx * 0.5, ty, tx, ty];
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const u = 1 - t;
      const x = u * u * u * P[0] + 3 * u * u * t * P[2] + 3 * u * t * t * P[4] + t * t * t * P[6];
      const y = u * u * u * P[1] + 3 * u * u * t * P[3] + 3 * u * t * t * P[5] + t * t * t * P[7];
      boxes.push({ x0: x - 3, y0: y - 3, x1: x + 3, y1: y + 3 });
    }
    lines.append(svg('path', { d, class: 'leader-case' }));
    lines.append(svg('path', { d, class: 'leader' }));
    lines.append(svg('circle', { cx: tx, cy: ty, r: 2.2, class: 'end' }));
  };
  if (!MOBILE) {
    const name = o.left.querySelector('.facts')!.getBoundingClientRect();
    const head = o.right.querySelector('.stories-head')!.getBoundingClientRect();
    const lx = o.left.getBoundingClientRect().right;
    const rx = o.right.getBoundingClientRect().left;
    curve(lx, name.top + 0.5, -1);
    curve(rx, head.bottom - 0.5, 1);
  } else {
    const sheet = document.querySelector('.sheet')!.getBoundingClientRect();
    for (let y = anchor.y; y < sheet.top; y += 4) boxes.push({ x0: anchor.x - 3, y0: y - 3, x1: anchor.x + 3, y1: y + 3 });
    lines.append(svg('path', { d: `M${anchor.x},${anchor.y + 4.5} L${anchor.x},${sheet.top}`, class: 'leader-case' }));
    lines.append(svg('path', { d: `M${anchor.x},${anchor.y + 4.5} L${anchor.x},${sheet.top}`, class: 'leader' }));
    lines.append(svg('circle', { cx: anchor.x, cy: sheet.top, r: 2.2, class: 'end' }));
  }
  // Country names, larger first.
  const capSize = MOBILE ? 9.5 : 11;
  const named = o.features
    .map((f) => ({ f, info: countries[f.id] }))
    .filter((x) => x.info?.latlng && (x.info.area ?? 0) > (MOBILE ? 400000 : 90000) && x.f.id !== SEL)
    .sort((a, b) => (b.info.area ?? 0) - (a.info.area ?? 0));

  const capitalNodes: SVGElement[] = [];
  const placeCapital = (c: Cap, force = false) => {
    const p = project(c.lon, c.lat, c.id === SEL ? 1.024 : 1.002);
    const op = fade(p.x, p.y, p.facing);
    if (op < 0.3) return;
    measure.font = `400 ${capSize}px Newsreader`;
    const w = measure.measureText(c.name).width;
    const b: Box = { x0: p.x - 5, y0: p.y - capSize * 0.75, x1: p.x + 7 + w + 2, y1: p.y + capSize * 0.45 };
    if (!force && !place(b)) return;
    if (force) boxes.push(b);
    const g = svg('g', { class: c.id === SEL ? 'capital sel' : 'capital', opacity: op.toFixed(2) });
    g.append(svg('circle', { cx: p.x, cy: p.y, r: 3.1, class: 'ring' }), svg('circle', { cx: p.x, cy: p.y, r: 1.05, class: 'dot' }));
    const t = svg('text', { x: p.x + 7, y: p.y + capSize * 0.36, class: 'cap-name' });
    t.textContent = c.name;
    g.append(t);
    capitalNodes.push(g);
  };
  placeCapital(caps[0], true);

  for (const { f, info } of named) {
    const [lat, lon] = info.latlng!;
    const p = project(lon, lat);
    const op = fade(p.x, p.y, p.facing);
    if (op < 0.3) continue;
    const a = info.area ?? 0;
    const size = (MOBILE ? 0.8 : 1) * (a > 5e6 ? 16 : a > 1.5e6 ? 14 : a > 4e5 ? 12.5 : 11.5);
    measure.font = `italic 400 ${size}px Newsreader`;
    const name = info.name === 'Russia' ? 'Russia' : info.name;
    const w = measure.measureText(name).width;
    let y = NaN;
    let x = p.x;
    const tries: [number, number][] = [[0, 0], [0, -size], [0, size], [w * 0.55, 0], [-w * 0.55, 0], [0, -size * 1.8], [0, size * 1.8], [w * 0.55, size], [-w * 0.55, size], [w * 0.9, -size * 0.5], [-w * 0.9, -size * 0.5]];
    for (const [dx, dy] of tries) {
      const b: Box = { x0: p.x + dx - w / 2 - 3, y0: p.y + dy - size * 0.8, x1: p.x + dx + w / 2 + 3, y1: p.y + dy + size * 0.3 };
      if (place(b)) {
        y = p.y + dy;
        x = p.x + dx;
        break;
      }
    }
    if (Number.isNaN(y)) continue;
    text(x, y, name, `country${a > 1.5e6 ? ' big' : ''}`, op).setAttribute('font-size', String(size));
    void f;
  }
  for (const c of caps.slice(1)) placeCapital(c);
  labels.append(...capitalNodes);

  const cl = text(chinaLabel.x, chinaLabel.y, 'China', 'country sel', 1);
  cl.setAttribute('font-size', String(chinaSize));

  anchorDot();
  void sat;
}

start();
