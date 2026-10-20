// Swiss / instrument mockup. One state: China selected, facing the viewer.
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LinearMipmapLinearFilter,
  LinearSRGBColorSpace,
  LineSegments,
  Mesh,
  NoColorSpace,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TextureLoader,
  Vector3,
  WebGLRenderer,
  Quaternion,
  Euler,
  type Texture,
} from 'three';
import { feature } from 'topojson-client';
import { buildGlobeGeometry } from '../../src/globe/geometry';
import { compactNumber, sentenceCase } from '../../src/ui/format';
import type { CountryFeature, CountryInfo } from '../../src/types';

const style = new URLSearchParams(location.search).get('style') === 'atlas' ? 'atlas' : 'satellite';
document.body.classList.add(style);
document.querySelectorAll<HTMLAnchorElement>('.toggle a').forEach((a) => a.setAttribute('aria-checked', String(a.dataset.style === style)));

const SEL = 'CHN';
const RED: [number, number, number] = [0xe5 / 255, 0x36 / 255, 0x1b / 255];
const LIFT = 0.022;
const FOCUS = { lat: 33.5, lon: 104 }; // centre of view
const ANCHOR = { lat: 34.5, lon: 103 }; // leader-line origin on China

const mobile = innerWidth < 700;

// Capitals (mock data: countries.json has names only).
const CAPITALS: Record<string, [string, number, number]> = {
  CHN: ['Beijing', 39.9042, 116.4074],
  MNG: ['Ulaanbaatar', 47.8864, 106.9057],
  JPN: ['Tokyo', 35.6762, 139.6503],
  KOR: ['Seoul', 37.5665, 126.978],
  PRK: ['Pyongyang', 39.0392, 125.7625],
  IND: ['New Delhi', 28.6139, 77.209],
  PAK: ['Islamabad', 33.6844, 73.0479],
  AFG: ['Kabul', 34.5553, 69.2075],
  KAZ: ['Astana', 51.1694, 71.4491],
  VNM: ['Hanoi', 21.0278, 105.8342],
  THA: ['Bangkok', 13.7563, 100.5018],
  MMR: ['Naypyidaw', 19.7633, 96.0785],
  BGD: ['Dhaka', 23.8103, 90.4125],
  NPL: ['Kathmandu', 27.7172, 85.324],
  LAO: ['Vientiane', 17.9757, 102.6331],
  PHL: ['Manila', 14.5995, 120.9842],
  TWN: ['Taipei', 25.033, 121.5654],
  KGZ: ['Bishkek', 42.8746, 74.5698],
  TJK: ['Dushanbe', 38.5598, 68.787],
  UZB: ['Tashkent', 41.2995, 69.2401],
  MYS: ['Kuala Lumpur', 3.139, 101.6869],
  IDN: ['Jakarta', -6.2088, 106.8456],
  KHM: ['Phnom Penh', 11.5564, 104.9282],
  TKM: ['Ashgabat', 37.9601, 58.3261],
  IRN: ['Tehran', 35.6892, 51.389],
  RUS: ['Moscow', 55.7558, 37.6173],
};

const STORIES = [
  { source: 'Reuters', t: 2, title: 'China sends naval forces to monitor US warship near disputed shoal' },
  { source: 'Foreign Affairs', t: 3, title: 'The China Price: Beijing’s Green Path to Ending Dollar Dominance' },
  { source: 'Mercator Institute for China Studies', t: 3, title: 'Germany and China in the cleantech sector' },
  { source: 'Washington Post', t: 4, title: 'Russia proposes a Trump-Xi-Putin meeting in China next month' },
  { source: 'Reuters', t: 6, title: 'China’s exports beat forecasts as shipments to Europe rise' },
];

await Promise.all(['400 11px "Inter Tight"', '500 11px "Inter Tight"', '600 11px "Inter Tight"', '400 11px "JetBrains Mono"', '500 11px "JetBrains Mono"'].map((f) => document.fonts.load(f)));

type Box = { x0: number; y0: number; x1: number; y1: number };
// ---------- data ----------
const [topo, countries] = await Promise.all([
  fetch('/data/world.json').then((r) => r.json()),
  fetch('/data/countries.json').then((r) => r.json() as Promise<Record<string, CountryInfo>>),
]);
const fc = feature(topo, topo.objects.countries) as unknown as GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { id: string; name: string }>;
const features: CountryFeature[] = fc.features
  .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
  .map((f) => ({ id: f.properties.id, name: f.properties.name, geometry: f.geometry }));
const selFeature = features.find((f) => f.id === SEL)!;
const info = countries[SEL];

// ---------- panels ----------
const fmtInt = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const dms = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;

function rows(items: [string, string, boolean?][]): string {
  return `<dl class="rows">${items.map(([k, v, num]) => `<div class="row"><dt>${k}</dt><dd class="${num ? 'num' : ''}">${v}</dd></div>`).join('')}</dl>`;
}
function section(n: string, title: string, body: string): string {
  return `<section class="sec"><h2 class="sec-h"><span class="n">${n}</span>${title}</h2>${body}</section>`;
}
const g = info.government;
const e = info.economy;
const gdpT = (e.gdpUsd! / 1e12).toFixed(2);
document.getElementById('details')!.innerHTML = `
  <div class="handle"></div>
  <div class="id">
    <div class="id-top">
      <img class="flag" src="./cn.svg" alt="Flag of China" />
      <div class="id-code mono">${info.id} · ${info.iso2}<br />${dms(info.latlng![0], 'N', 'S')} ${dms(info.latlng![1], 'E', 'W')}</div>
      ${mobile ? `<div><h1>${info.name}</h1><p class="official">${info.officialName}</p></div>` : ''}
    </div>
    ${mobile ? '' : `<h1>${info.name}</h1><p class="official">${info.officialName}</p>`}
  </div>
  <div class="tabs"><span class="on">Overview</span><span>Top stories</span></div>
  ${section('01', 'Geography', rows([
    ['Region', `${info.subregion}`],
    ['Area', `${fmtInt.format(info.area!)} <span class="u">km²</span>`, true],
    ['Borders', `${info.borders.length}`, true],
    ['Time zones', 'UTC+06 – UTC+08', true],
  ]))}
  ${section('02', 'People', rows([
    ['Population', `${fmtInt.format(info.population!)}<span class="yr">${info.populationYear}</span>`, true],
    ['Languages', info.languages.join(', ')],
    ['Life expectancy', `${info.demographics.lifeExpectancy!.toFixed(1)} <span class="u">yr</span>`, true],
    ['Urban', `${info.demographics.urbanPopulationPct!.toFixed(1)} <span class="u">%</span>`, true],
  ]))}
  ${section('03', 'Government', rows([
    ['System', 'One-party socialist republic'],
    [g.headOfStateTitle!, g.headOfState!],
    [g.headOfGovernmentTitle!, g.headOfGovernment!],
  ]))}
  ${section('04', 'Economy', rows([
    ['GDP', `$${gdpT} <span class="u">tn</span><span class="yr">${e.gdpYear}</span>`, true],
    ['GDP per capita', `$${fmtInt.format(e.gdpPerCapitaUsd!)}`, true],
    ['HDI', `${e.hdi!.toFixed(3)}<span class="yr">${e.hdiYear}</span>`, true],
    ['Currency', `${info.currencies[0].name} <span class="u mono">${info.currencies[0].code}</span>`],
  ]))}
`;
void compactNumber;
void sentenceCase;

document.getElementById('news')!.innerHTML = `
  <div class="news-h"><h2>Top stories</h2><span class="mono">05</span></div>
  ${STORIES.map((s, i) => `
    <a class="story" href="#">
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
      <div>
        <div class="meta"><span>${s.source}</span><span class="t">${s.t}h</span></div>
        <h3>${s.title}</h3>
      </div>
    </a>`).join('')}
  <div class="news-f"><span>Updated 09:41 UTC</span><a href="#">All coverage →</a></div>
`;

document.getElementById('coords')!.innerHTML = '';
document.getElementById('readout')!.innerHTML = `
  <span>LAT <b>${FOCUS.lat.toFixed(2)}° N</b></span>
  <span>LON <b>${FOCUS.lon.toFixed(2)}° E</b></span>
  <span>ALT <b>12,400 km</b></span>
  <span>SEL <b>CHN</b></span>`;

// ---------- globe ----------
const stage = document.getElementById('stage')!;
const W = stage.clientWidth;
const H = stage.clientHeight;
const DPR = Math.min(devicePixelRatio, 2);
const R_PX = mobile ? 168 : 336; // globe radius in CSS px
const CY = mobile ? 184 : H / 2 - 4; // centre within stage
const CX = W / 2;

const FOV = 30;
const halfH = H / 2;
const tanA = (R_PX / halfH) * Math.tan(((FOV / 2) * Math.PI) / 180);
const DIST = 1 / Math.sin(Math.atan(tanA));
const camera = new PerspectiveCamera(FOV, W / H, 0.1, 50);
camera.position.set(0, 0, DIST);
// Shift the view so the globe centre lands at (CX, CY).
camera.setViewOffset(W, H, 0, H / 2 - CY, W, H);

const orient = new Quaternion().setFromEuler(new Euler((FOCUS.lat * Math.PI) / 180, (-FOCUS.lon * Math.PI) / 180, 0, 'XYZ'));

function makeRenderer(canvas: HTMLCanvasElement, alpha: boolean) {
  const r = new WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true });
  r.outputColorSpace = LinearSRGBColorSpace;
  r.setPixelRatio(DPR);
  r.setSize(W, H, false);
  r.setClearColor(0xf4f4f1, alpha ? 0 : 1);
  return r;
}

const satVertex = /* glsl */ `
  varying vec3 vDir;
  varying vec3 vN;
  void main() {
    vDir = normalize(position);
    vN = normalize(normalMatrix * position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const satFragment = /* glsl */ `
  uniform sampler2D tMap;
  uniform float uDim;
  varying vec3 vDir;
  varying vec3 vN;
  void main() {
    float lon = atan(vDir.x, vDir.z);
    float lat = asin(clamp(vDir.y, -1.0, 1.0));
    vec2 uv = vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5);
    vec3 c = texture2D(tMap, uv).rgb;
    float limb = clamp(vN.z, 0.0, 1.0);
    c *= 0.72 + 0.28 * pow(limb, 0.6);
    c = pow(c, vec3(0.92)) * 1.08;
    gl_FragColor = vec4(c, 1.0);
  }`;
const flatVertex = /* glsl */ `
  void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const flatFragment = /* glsl */ `
  uniform vec3 uColor; uniform float uAlpha;
  void main() { gl_FragColor = vec4(uColor, uAlpha); }`;

// Raised selected country: kind 1 = top, 0 = wall base.
const raisedVertex = /* glsl */ `
  attribute float kind;
  uniform float uLift;
  varying vec3 vDir;
  varying vec3 vView;
  varying vec3 vN;
  flat varying float vKind;
  void main() {
    vDir = normalize(position);
    vKind = kind;
    vec4 mv = modelViewMatrix * vec4(position * (1.0015 + kind * uLift), 1.0);
    vView = mv.xyz;
    vN = normalize(normalMatrix * position);
    gl_Position = projectionMatrix * mv;
  }`;
const raisedFragment = /* glsl */ `
  uniform sampler2D tMap;
  uniform float uTex;
  uniform vec3 uCap;
  uniform vec3 uWall;
  varying vec3 vDir;
  varying vec3 vView;
  varying vec3 vN;
  flat varying float vKind;
  void main() {
    if (vKind > 0.5) {
      vec3 c = uCap;
      if (uTex > 0.5) {
        float lon = atan(vDir.x, vDir.z);
        float lat = asin(clamp(vDir.y, -1.0, 1.0));
        c = texture2D(tMap, vec2(lon / 6.2831853 + 0.5, lat / 3.1415927 + 0.5)).rgb;
        c = pow(c, vec3(0.9)) * 1.14;
      }
      gl_FragColor = vec4(c, 1.0);
    } else {
      vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
      if (dot(n, vView) > 0.0) n = -n;
      float l = 0.62 + 0.38 * max(dot(n, normalize(vec3(-0.5, 0.7, 0.6))), 0.0);
      gl_FragColor = vec4(uWall * l, 1.0);
    }
  }`;

const hex = (h: number) => new Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);

function lineGeometryFrom(positions: Float32Array, index: Uint32Array, r: number) {
  const p = new Float32Array(positions.length);
  for (let i = 0; i < p.length; i++) p[i] = positions[i] * r;
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(p, 3));
  geo.setIndex(new BufferAttribute(index, 1));
  return geo;
}

function graticule(r: number) {
  const pts: number[] = [];
  const v = (lon: number, lat: number) => {
    const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
    return [Math.cos(p) * Math.sin(l) * r, Math.sin(p) * r, Math.cos(p) * Math.cos(l) * r];
  };
  for (let lon = -180; lon < 180; lon += 15)
    for (let lat = -80; lat < 80; lat += 2) pts.push(...v(lon, lat), ...v(lon, lat + 2));
  for (let lat = -75; lat <= 75; lat += 15)
    for (let lon = -180; lon < 180; lon += 2) pts.push(...v(lon, lat), ...v(lon + 2, lat));
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pts), 3));
  return geo;
}

async function loadTexture(): Promise<Texture> {
  const t = await new TextureLoader().loadAsync('/textures/earth-4k.jpg');
  t.colorSpace = NoColorSpace;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  return t;
}

const tex = style === 'satellite' ? await loadTexture() : null;
const world = buildGlobeGeometry(features);
const selGeo = buildGlobeGeometry([selFeature]);

// Base scene: whole globe.
const baseScene = new Scene();
const baseGroup = new Group();
baseGroup.quaternion.copy(orient);
baseScene.add(baseGroup);
const sphereGeo = new SphereGeometry(1, 192, 144);

const lineMat = (color: number, alpha: number) =>
  new ShaderMaterial({ vertexShader: flatVertex, fragmentShader: flatFragment, transparent: alpha < 1, depthWrite: false, uniforms: { uColor: { value: hex(color) }, uAlpha: { value: alpha } } });

if (style === 'satellite') {
  baseGroup.add(new Mesh(sphereGeo, new ShaderMaterial({ vertexShader: satVertex, fragmentShader: satFragment, uniforms: { tMap: { value: tex }, uDim: { value: 0 } } })));
  baseGroup.add(new LineSegments(graticule(1.001), lineMat(0xffffff, 0.12)));
  baseGroup.add(new LineSegments(lineGeometryFrom(world.positions, world.lines, 1.0016), lineMat(0xffffff, 0.55)));
} else {
  baseGroup.add(new Mesh(sphereGeo, new ShaderMaterial({ vertexShader: flatVertex, fragmentShader: flatFragment, uniforms: { uColor: { value: hex(0xffffff) }, uAlpha: { value: 1 } } })));
  baseGroup.add(new LineSegments(graticule(1.0005), lineMat(0x111111, 0.09)));
  const land = new BufferGeometry();
  const lp = new Float32Array(world.positions.length);
  for (let i = 0; i < lp.length; i++) lp[i] = world.positions[i] * 1.0012;
  land.setAttribute('position', new BufferAttribute(lp, 3));
  // Only cap triangles: skip wall quads (they contain a kind-0 vertex).
  const caps: number[] = [];
  for (let i = 0; i < world.triangles.length; i += 3) {
    const a = world.triangles[i], b = world.triangles[i + 1], c = world.triangles[i + 2];
    if (world.kind[a] && world.kind[b] && world.kind[c]) caps.push(a, b, c);
  }
  land.setIndex(new BufferAttribute(new Uint32Array(caps), 1));
  baseGroup.add(new Mesh(land, new ShaderMaterial({ vertexShader: flatVertex, fragmentShader: flatFragment, uniforms: { uColor: { value: hex(0xd9d9d3) }, uAlpha: { value: 1 } } })));
  baseGroup.add(new LineSegments(lineGeometryFrom(world.positions, world.lines, 1.0018), lineMat(0xffffff, 1)));
}

// Focus scene: the raised selected country, occluded by the sphere.
const focusScene = new Scene();
const focusGroup = new Group();
focusGroup.quaternion.copy(orient);
focusScene.add(focusGroup);
const occluder = new Mesh(new SphereGeometry(0.999, 128, 96), new ShaderMaterial({ vertexShader: flatVertex, fragmentShader: flatFragment, colorWrite: false, uniforms: { uColor: { value: hex(0) }, uAlpha: { value: 1 } } }));
focusGroup.add(occluder);
const raised = new BufferGeometry();
raised.setAttribute('position', new BufferAttribute(selGeo.positions, 3));
raised.setAttribute('kind', new BufferAttribute(new Float32Array(selGeo.kind), 1));
raised.setIndex(new BufferAttribute(selGeo.triangles, 1));
focusGroup.add(
  new Mesh(
    raised,
    new ShaderMaterial({
      vertexShader: raisedVertex,
      fragmentShader: raisedFragment,
      uniforms: {
        tMap: { value: tex },
        uTex: { value: style === 'satellite' ? 1 : 0 },
        uCap: { value: new Vector3(...RED) },
        uWall: { value: style === 'satellite' ? new Vector3(...RED) : hex(0x9c2410) },
        uLift: { value: LIFT },
      },
    }),
  ),
);

const baseR = makeRenderer(document.getElementById('base') as HTMLCanvasElement, true);
const focusR = makeRenderer(document.getElementById('focus') as HTMLCanvasElement, true);
baseR.render(baseScene, camera);
focusR.render(focusScene, camera);

// Soft layer: blurred copy of the base, masked so blur grows away from the selection.
const soft = document.getElementById('soft') as HTMLCanvasElement;
soft.width = W * DPR;
soft.height = H * DPR;
soft.getContext('2d')!.drawImage(baseR.domElement, 0, 0);

// ---------- projection ----------
const tmp = new Vector3();
function project(lat: number, lon: number, r = 1) {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
  tmp.set(Math.cos(p) * Math.sin(l) * r, Math.sin(p) * r, Math.cos(p) * Math.cos(l) * r).applyQuaternion(orient);
  const facing = tmp.clone().normalize().dot(camera.position.clone().sub(tmp).normalize());
  tmp.project(camera);
  return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H, facing };
}

const anchor = project(ANCHOR.lat, ANCHOR.lon, 1.0015 + LIFT);
const stageTop = stage.getBoundingClientRect().top;

// Dim + blur treatment.
const base = document.getElementById('base') as HTMLCanvasElement;
const mask = `radial-gradient(circle at ${anchor.x}px ${anchor.y}px, transparent ${R_PX * 0.32}px, #000 ${R_PX * 0.95}px)`;
soft.style.maskImage = mask;
soft.style.webkitMaskImage = mask;
if (style === 'satellite') {
  base.style.filter = 'brightness(0.7) saturate(0.75)';
  soft.style.filter = `blur(${mobile ? 2 : 3}px) brightness(0.62) saturate(0.6)`;
} else {
  base.style.filter = 'contrast(0.82) brightness(1.03)';
  soft.style.filter = `blur(${mobile ? 1.5 : 2.5}px) contrast(0.7) brightness(1.06)`;
}

// ---------- SVG overlay ----------
const svg = document.getElementById('overlay')!;
const NS = 'http://www.w3.org/2000/svg';
const el = (name: string, attrs: Record<string, string | number>, parent: Element = svg) => {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, String(attrs[k]));
  parent.appendChild(n);
  return n;
};
svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

// Projected silhouette radius (perspective): the limb is slightly inside R_PX math; measure it.
const limb = (() => {
  const a = Math.asin(1 / DIST);
  return (Math.tan(a) / Math.tan(((FOV / 2) * Math.PI) / 180)) * halfH;
})();
const defs = el('defs', {});
const clipIn = el('clipPath', { id: 'in' }, defs);
el('circle', { cx: CX, cy: CY, r: limb }, clipIn);
const maskOut = el('mask', { id: 'out', maskUnits: 'userSpaceOnUse', x: -W, y: -H, width: 3 * W, height: 3 * H }, defs);
el('rect', { x: -W, y: -H, width: 3 * W, height: 3 * H, fill: '#fff' }, maskOut);
el('circle', { cx: CX, cy: CY, r: limb, fill: '#000' }, maskOut);

if (style === 'atlas') el('circle', { cx: CX, cy: CY, r: limb, fill: 'none', stroke: '#111', 'stroke-width': 1 });

// Outline of the selected country (raised top edge).
let selD = '';
{
  let d = '';
  const polys = selFeature.geometry.type === 'Polygon' ? [selFeature.geometry.coordinates] : selFeature.geometry.coordinates;
  for (const poly of polys) {
    const ring = poly[0];
    if (ring.length < 8) continue;
    ring.forEach(([lon, lat], i) => {
      const s = project(lat, lon, 1.0015 + LIFT);
      d += `${i ? 'L' : 'M'}${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
    });
    d += 'Z';
  }
  selD = d;
  if (style === 'satellite') el('path', { d, fill: 'none', stroke: '#e5361b', 'stroke-width': 1.5, 'stroke-linejoin': 'round' });
}
const selPath = new Path2D(selD);
const hitCtx = document.createElement('canvas').getContext('2d')!;
const overSel = (b: Box) => {
  for (let i = 0; i <= 4; i++) for (const y of [b.y0, (b.y0 + b.y1) / 2, b.y1]) if (hitCtx.isPointInPath(selPath, b.x0 + ((b.x1 - b.x0) * i) / 4, y)) return true;
  return false;
};

// Leader lines.
const lineInside = style === 'satellite' ? '#ffffff' : '#111111';
function leader(points: [number, number][], tick: 'v' | 'h') {
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('');
  el('path', { d, fill: 'none', stroke: '#111', 'stroke-width': 1, mask: 'url(#out)' });
  el('path', { d, fill: 'none', stroke: lineInside, 'stroke-width': 1, 'clip-path': 'url(#in)', opacity: style === 'satellite' ? 0.9 : 1 });
  const [ex, ey] = points[points.length - 1];
  if (tick === 'v') el('path', { d: `M${ex} ${ey - 6}V${ey + 6}`, stroke: '#111', 'stroke-width': 1.5 });
  else el('path', { d: `M${ex - 6} ${ey}H${ex + 6}`, stroke: '#111', 'stroke-width': 1.5 });
}

const ax = anchor.x, ay = anchor.y;
if (!mobile) {
  const leftEdge = document.getElementById('details')!.getBoundingClientRect().right;
  const rightEdge = document.getElementById('news')!.getBoundingClientRect().left;
  const rise = 56;
  leader([[ax, ay], [ax - rise, ay - rise], [leftEdge, ay - rise]], 'v');
  leader([[ax, ay], [ax + rise, ay + rise], [rightEdge, ay + rise]], 'v');
} else {
  const sheetTop = document.getElementById('details')!.getBoundingClientRect().top - stageTop;
  leader([[ax, ay], [ax, sheetTop]], 'h');
}
el('circle', { cx: ax, cy: ay, r: 3.5, fill: '#e5361b', stroke: style === 'satellite' ? '#fff' : '#fff', 'stroke-width': 1.5 });

// ---------- labels ----------
const labels = document.getElementById('labels')!;
const taken: Box[] = [];
const blocked: Box[] = [];
const hit = (b: Box) => [...taken, ...blocked].some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
const pad = (b: Box, p: number): Box => ({ x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p });

// Keep labels off the panels and the leader lines' horizontal runs.
for (const id of ['details', 'news']) {
  const r = document.getElementById(id)!.getBoundingClientRect();
  if (r.width) blocked.push({ x0: r.left - 8, y0: r.top - stageTop - 8, x1: r.right + 8, y1: r.bottom - stageTop + 8 });
}

function place(node: HTMLElement, x: number, y: number, align: 'center' | 'left', force = false): boolean {
  labels.appendChild(node);
  const w = node.offsetWidth, h = node.offsetHeight;
  const left = align === 'center' ? x - w / 2 : x;
  const top = y - h / 2;
  const box = { x0: left, y0: top, x1: left + w, y1: top + h };
  const inside = Math.hypot((align === 'center' ? x : x + w / 2) - CX, y - CY) < limb - 14;
  if (!force && (!inside || hit(pad(box, 4)) || overSel(pad(box, 3)))) {
    node.remove();
    return false;
  }
  node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  taken.push(box);
  return true;
}

function capitalNode(name: string, sel = false) {
  const n = document.createElement('div');
  n.className = 'lbl lbl-cap' + (sel ? ' sel' : '');
  n.innerHTML = `<i></i><span>${name}</span>`;
  return n;
}

// Selected country first.
{
  const n = document.createElement('div');
  n.className = 'lbl lbl-sel';
  n.textContent = info.name;
  if (mobile) {
    labels.appendChild(n);
    place(n, ax - n.offsetWidth - 10, ay, 'left', true);
  } else place(n, ax + 12, ay - 16, 'left', true);
  const [cap, lat, lon] = CAPITALS[SEL];
  const s = project(lat, lon, 1.0015 + LIFT);
  const cn = capitalNode(cap, true);
  labels.appendChild(cn);
  // Square centred on the capital, name to its right.
  cn.classList.add('rev');
  place(cn, s.x + 3 - cn.offsetWidth, s.y, 'left', true);
}
// Reserve the leader lines' paths.
if (mobile) blocked.push({ x0: ax - 6, y0: ay, x1: ax + 6, y1: H });
if (!mobile) {
  blocked.push({ x0: 0, y0: ay - 56 - 6, x1: ax - 40, y1: ay - 56 + 6 });
  blocked.push({ x0: ax + 40, y0: ay + 56 - 6, x1: W, y1: ay + 56 + 6 });
}

const candidates = Object.values(countries)
  .filter((c) => c.id !== SEL && c.latlng && (c.area ?? 0) > 90000)
  .sort((a, b) => (b.area ?? 0) - (a.area ?? 0));
// The country fill of China hides small neighbours' representative points: drop those that project inside China's own label box.
const shown: string[] = [];
for (const c of candidates) {
  const [lat, lon] = c.latlng!;
  const s = project(lat, lon);
  if (s.facing < 0.6) continue;
  const n = document.createElement('div');
  n.className = 'lbl lbl-country' + ((c.area ?? 0) > 2e6 ? ' big' : '');
  n.textContent = c.name.length > 16 && c.id === 'PRK' ? 'N. Korea' : c.name.length > 16 && c.id === 'KOR' ? 'S. Korea' : c.name;
  if (place(n, s.x, s.y, 'center')) shown.push(c.id);
}
for (const id of shown) {
  const cap = CAPITALS[id];
  if (!cap) continue;
  const s = project(cap[1], cap[2]);
  if (s.facing < 0.6) continue;
  place(capitalNode(cap[0]), s.x - 2, s.y, 'left');
}

await document.fonts.ready;
document.body.dataset.ready = '1';
