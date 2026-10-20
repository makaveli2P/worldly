// Builds the static data for Worldly.
//
// Outputs:
//   public/data/world.json      TopoJSON, object "countries", properties {id, name}
//   public/data/countries.json  Record<CountryId, CountryInfo>
//   api/_lib/countries.json     Record<CountryId, {name, iso2}> for the news API
//
// Sources:
//   - world-atlas countries-50m (geometry)
//   - mledoze/countries (the data set behind REST Countries; REST Countries v1-v4 now
//     return a deprecation error and v5 needs a key)
//   - Wikidata SPARQL (government, leaders, economy, population, time zones)
//   - World Bank indicators API (population, urban share, GDP, life expectancy)
//   - IANA tz database zone.tab (time zones by ISO alpha-2; Wikidata P421 is the fallback)
//   - flagcdn.com (SVG flags by ISO alpha-2)
//   - UNDP Human Development Report composite indices (HDI)
// For a figure that both Wikidata and the World Bank have, the script keeps the World Bank
// value. Wikidata is the fallback. Some Wikidata figures are rounded estimates.
//
// Run: npm run data. The script overwrites its outputs, so you can run it again at any time.
// When a Wikidata request fails, the script keeps the previous values for those countries.

import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature } from 'topojson-client';
import { geoCentroid } from 'd3-geo';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_WORLD = join(ROOT, 'public/data/world.json');
const OUT_COUNTRIES = join(ROOT, 'public/data/countries.json');
const OUT_API = join(ROOT, 'api/_lib/countries.json');

const MLEDOZE_URL = 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';
const WORLD_BANK = {
  population: 'SP.POP.TOTL',
  urban: 'SP.URB.TOTL.IN.ZS',
  gdp: 'NY.GDP.MKTP.CD',
  gdppc: 'NY.GDP.PCAP.CD',
  life: 'SP.DYN.LE00.IN',
};
const HDR_URL =
  'https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv';
const ZONE_TAB_URL = 'https://raw.githubusercontent.com/eggert/tz/main/zone.tab';
const SPARQL_URL = 'https://query.wikidata.org/sparql';
const USER_AGENT =
  'WorldlyDataBuild/0.1 (https://github.com/makaveli2P/worldly; static country facts for a globe app)';

const WD = 'http://www.wikidata.org/entity/';
const USD = `${WD}Q4917`;
const KM2 = `${WD}Q712226`;

// Geometries without an ISO numeric id, keyed by their world-atlas name.
// mledoze: the cca3 code in mledoze/countries, when it has the area.
// worldBank: the World Bank code, when it has the area.
const NO_ISO = {
  Kosovo: { id: 'X-kosovo', name: 'Kosovo', qid: 'Q1246', mledoze: 'UNK', worldBank: 'XKX' },
  'N. Cyprus': {
    id: 'X-northern-cyprus',
    name: 'Northern Cyprus',
    qid: 'Q23681',
    region: 'Europe',
    subregion: 'Southern Europe',
  },
  Somaliland: {
    id: 'X-somaliland',
    name: 'Somaliland',
    qid: 'Q34754',
    region: 'Africa',
    subregion: 'Eastern Africa',
  },
  'Indian Ocean Ter.': {
    id: 'X-indian-ocean-territories',
    name: 'Australian Indian Ocean Territories',
    qid: 'Q4824275',
    region: 'Oceania',
    subregion: 'Australia and New Zealand',
  },
  'Siachen Glacier': {
    id: 'X-siachen-glacier',
    name: 'Siachen Glacier',
    qid: 'Q333946',
    region: 'Asia',
    subregion: 'Southern Asia',
  },
};

// world-atlas gives Ashmore and Cartier the same numeric id as Australia (036).
// The script gives it its own id, so that each CountryId has one geometry.
const SHARED_ID = {
  'Ashmore and Cartier Is.': {
    id: 'X-ashmore-and-cartier',
    name: 'Ashmore and Cartier Islands',
    qid: 'Q133888',
    region: 'Oceania',
    subregion: 'Australia and New Zealand',
  },
};

// Names where the mledoze common name is not the clearest English name.
const NAME_OVERRIDES = {
  COG: 'Republic of the Congo',
  SHN: 'Saint Helena',
  SGS: 'South Georgia and the South Sandwich Islands',
};

// mledoze gives Western Sahara the root "+2" and Moroccan suffixes.
const CALLING_CODE_OVERRIDES = { VAT: '+379', ESH: '+212' };

// Fixes for gaps in Wikidata found during spot checks. Check these when you re-run.
// Saudi Arabia: Wikidata lists only King Salman as head of government; Mohammed bin Salman
// has been Prime Minister since 2022.
const GOVERNMENT_OVERRIDES = {
  SAU: { headOfGovernment: 'Mohammed bin Salman', headOfGovernmentTitle: 'Prime Minister' },
  AND: { headOfStateTitle: 'Co-Princes' },
  SMR: { headOfStateTitle: 'Captains Regent' },
  CHE: {
    headOfState: 'Swiss Federal Council',
    headOfStateTitle: 'Federal Council',
    headOfGovernment: 'Swiss Federal Council',
    headOfGovernmentTitle: 'Federal Council',
  },
  VAT: { headOfGovernmentTitle: 'President of the Governorate' },
  // Wikidata lists only former holders for these (checked October 2026).
  KWT: { headOfGovernment: 'Ahmad Al-Abdullah Al-Sabah', headOfGovernmentTitle: 'Prime Minister' },
  TTO: { headOfGovernment: 'Kamla Persad-Bissessar', headOfGovernmentTitle: 'Prime Minister' },
  SDN: {
    headOfState: 'Abdel Fattah al-Burhan',
    headOfStateTitle: 'Chairman of the Sovereignty Council',
    headOfGovernment: 'Kamil Idris',
    headOfGovernmentTitle: 'Prime Minister',
  },
  // Wikidata has only an Arabic label for this office.
  YEM: { headOfStateTitle: 'Chairman of the Presidential Leadership Council' },
  // Vučić's term ended on 2026-09-27; the Speaker acts as president (Wikidata, October 2026).
  SRB: { headOfStateTitle: 'Acting President' },
  // Wikidata has no current holder for these sovereign states (added by hand, October 2026).
  BGD: { headOfState: 'Mohammed Shahabuddin', headOfStateTitle: 'President' },
  BRB: { headOfState: 'Jeffrey Bostic', headOfStateTitle: 'President' },
  FJI: { headOfState: 'Ratu Naiqama Lalabalavu', headOfStateTitle: 'President' },
  GNB: {
    headOfState: 'Horta Inta-A',
    headOfStateTitle: 'Transitional President',
    headOfGovernment: 'Ilídio Vieira Té',
    headOfGovernmentTitle: 'Prime Minister',
  },
  SOM: { headOfState: 'Hassan Sheikh Mohamud', headOfStateTitle: 'President' },
  THA: { headOfGovernment: 'Anutin Charnvirakul', headOfGovernmentTitle: 'Prime Minister' },
  WSM: { headOfGovernment: "La'auli Leuatea Schmidt", headOfGovernmentTitle: 'Prime Minister' },
  VUT: { headOfGovernment: 'Jotham Napat', headOfGovernmentTitle: 'Prime Minister' },
  SLB: { headOfGovernment: 'Jeremiah Manele', headOfGovernmentTitle: 'Prime Minister' },
  MUS: { headOfGovernment: 'Navin Ramgoolam', headOfGovernmentTitle: 'Prime Minister' },
  COD: { headOfGovernment: 'Judith Suminwa', headOfGovernmentTitle: 'Prime Minister' },
};

// Government type for UN members where Wikidata P122 gives nothing.
const GOVERNMENT_TYPE_FALLBACK = {
  CAF: 'presidential republic',
  CRI: 'presidential republic',
  DJI: 'presidential republic',
  DMA: 'parliamentary republic',
  DOM: 'presidential republic',
  ERI: 'one-party state, presidential republic',
  FJI: 'parliamentary republic',
  GNB: 'semi-presidential republic, military transitional government',
  GNQ: 'presidential republic',
  GRD: 'constitutional monarchy, parliamentary system',
  HTI: 'semi-presidential republic, transitional government',
  JAM: 'constitutional monarchy, parliamentary system',
  JOR: 'constitutional monarchy',
  KEN: 'presidential republic',
  KIR: 'parliamentary republic',
  MDV: 'presidential republic',
  MHL: 'parliamentary republic',
  MLI: 'military junta',
  MOZ: 'presidential republic',
  MWI: 'presidential republic',
  NAM: 'presidential republic',
  NER: 'military junta',
  NRU: 'parliamentary republic',
  PLW: 'presidential republic',
  PNG: 'constitutional monarchy, parliamentary system',
  PRY: 'presidential republic',
  SLB: 'constitutional monarchy, parliamentary system',
  STP: 'semi-presidential republic',
  SYC: 'presidential republic',
  TCD: 'presidential republic',
  TGO: 'parliamentary republic',
  TON: 'constitutional monarchy',
  TZA: 'presidential republic',
  VUT: 'parliamentary republic',
  WSM: 'parliamentary republic',
  ZWE: 'presidential republic',
};

// Government type labels that add little next to the others.
const GENERIC_GOVERNMENT = new Set([
  'unitary state',
  'decentralization',
  'federation',
  'republic',
  'monarchy',
  'democracy',
  'representative democracy',
  'democratic republic',
  'constitutional republic',
  'sovereign state',
]);

// ---------- helpers ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, init = {}, tries = 4) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', ...init });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
        lastErr = new Error(`HTTP ${res.status}`);
        console.warn(`  ${res.status} from ${new URL(url).host}, wait ${Math.round(wait / 1000)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < tries) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

async function sparql(query) {
  const body = new URLSearchParams({ query });
  const json = await fetchJson(SPARQL_URL, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  await sleep(400); // be polite between requests
  return json.results.bindings.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[k] = v.value;
    return out;
  });
}

const qidOf = (uri) => uri.replace(WD, '');
const values = (qids) => qids.map((q) => `wd:${q}`).join(' ');
const yearOf = (iso) => (iso ? Number(String(iso).slice(0, String(iso).startsWith('-') ? 5 : 4)) : null);
const RANK = {
  'http://wikiba.se/ontology#PreferredRank': 2,
  'http://wikiba.se/ontology#NormalRank': 1,
  'http://wikiba.se/ontology#DeprecatedRank': 0,
};
const isFuture = (iso) => iso && Date.parse(iso) > Date.now();
const isLabelId = (s) => /^Q\d+$/.test(s ?? '') || /^https?:\/\//.test(s ?? '');

function slug(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

// ---------- titles ----------

const UPPER_KEEP = new Set(['of', 'the', 'and', 'for', 'in', 'to']);

const LATIN = /^[\p{Script=Latin}\p{Mark}\s\-'’.,()]+$/u;

/** "A", "A and B", "A, B and C". */
function joinNames(names) {
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Cleans a person label: "Albert II, Prince of Monaco" -> "Albert II",
 * "Tupou VI of Tonga" -> "Tupou VI", "Fatafehi Fakafānua, 8th Lord Fakafānua" -> "Fatafehi Fakafānua".
 */
// English labels that read badly.
const PERSON_NAMES = { 'William Alexander of the Netherlands': 'Willem-Alexander' };

function cleanPerson(name) {
  let n = name.trim();
  if (PERSON_NAMES[n]) return PERSON_NAMES[n];
  n = n.replace(/,\s+(?:\d+(?:st|nd|rd|th)\s+[^,]+|[^,]*\bof\b[^,]*)$/u, '');
  n = n.replace(/^(.+\s[IVXLC]+)\s+of\s+.+$/u, '$1');
  return n;
}

/** Picks a short government type from Wikidata P122 labels. Preferred rank comes first. */
function governmentType(labels) {
  if (!labels?.length) return null;
  let l = [...new Set(labels.map((s) => s.toLowerCase().trim()))];
  const specific = l.filter((s) => !GENERIC_GOVERNMENT.has(s));
  if (specific.length) l = specific;
  // Drop a label whose words all appear in a longer label ("republic" in "federal republic").
  const words = (s) => new Set(s.split(/[\s-]+/));
  l = l.filter((a) => !l.some((b) => b !== a && b.length > a.length && [...words(a)].every((w) => words(b).has(w))));
  return l.slice(0, 3).join(', ');
}

function capitalise(s) {
  return s.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
}

/**
 * Shortens an office name to a title.
 * "President of India" -> "President", "Monarch of the United Kingdom" -> "Monarch",
 * "President of the Government of Spain" -> "President of the Government".
 */
function shortTitle(office, countryNames) {
  if (!office || isLabelId(office) || !LATIN.test(office)) return null;
  let t = office.trim();
  const names = [...countryNames].filter(Boolean).sort((a, b) => b.length - a.length);
  let changed = false;
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\s+of\\s+(the\\s+)?${esc}$`, 'i');
    if (re.test(t)) {
      t = t.replace(re, '');
      changed = true;
      break;
    }
  }
  if (!changed) {
    // "Federal Chancellor of Austria" style when the country name did not match:
    // cut at the last " of " if the rest starts with a capital letter.
    const m = t.match(/^(.*?)\s+of\s+(the\s+)?(\p{Lu}[^]*)$/u);
    if (m && !/\b(Government|Council|Ministers|State|Governorate|Executive)\b/.test(m[3])) {
      t = m[1];
    }
  }
  // Drop a leading demonym or country name ("Swedish monarch", "Japanese Emperor").
  t = t.replace(/^(the\s+)/i, '');
  t = t
    .split(/\s+/)
    .map((w, i) => (i > 0 && UPPER_KEEP.has(w.toLowerCase()) ? w.toLowerCase() : w))
    .join(' ');
  return capitalise(t);
}

// ---------- geometry ----------

async function buildGeometry() {
  const topo = structuredClone(require('world-atlas/countries-50m.json'));
  const geoms = topo.objects.countries.geometries;
  const entries = []; // {id, worldName, iso3?, qid?, mledoze?, name?}
  for (const g of geoms) {
    const worldName = g.properties?.name ?? '';
    let entry;
    if (SHARED_ID[worldName]) entry = { ...SHARED_ID[worldName] };
    else if (!g.id) {
      entry = NO_ISO[worldName] ? { ...NO_ISO[worldName] } : { id: `X-${slug(worldName)}`, name: worldName };
    } else entry = { ccn3: String(g.id).padStart(3, '0') };
    entry.worldName = worldName;
    entry.geom = g;
    entries.push(entry);
  }
  return { topo, entries };
}

// ---------- mledoze / REST Countries data ----------

async function loadBase() {
  console.log('Fetch mledoze/countries');
  const list = await fetchJson(MLEDOZE_URL);
  console.log(`  ${list.length} records`);
  return list;
}

function callingCode(c) {
  if (CALLING_CODE_OVERRIDES[c.cca3]) return CALLING_CODE_OVERRIDES[c.cca3];
  const root = c.idd?.root;
  if (!root) return null;
  const sfx = c.idd.suffixes ?? [];
  if (sfx.length === 1) return `${root}${sfx[0]}`;
  // Only +1 and +7 are full one-digit codes. Another short root is not a real prefix.
  return root.length > 2 || root === '+1' || root === '+7' ? root : null;
}

// ---------- time zones ----------

/** Standard UTC offset of an IANA zone: the lower of the January and July offsets. */
function standardOffset(zone) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' });
  const minutes = (d) => {
    const v = fmt.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = v.match(/GMT([+-])(\d{2}):(\d{2})/);
    return m ? (m[1] === '+' ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  };
  const year = new Date().getUTCFullYear();
  return Math.min(minutes(new Date(Date.UTC(year, 0, 15))), minutes(new Date(Date.UTC(year, 6, 15))));
}

/** Map<iso2, string[]> of standard offsets like "UTC+05:30", from the IANA zone.tab. */
async function loadZoneTab() {
  console.log('Fetch IANA zone.tab');
  try {
    const res = await fetch(ZONE_TAB_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const byCountry = new Map();
    for (const line of text.split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [cc, , zone] = line.split('\t');
      let mins;
      try {
        mins = standardOffset(zone);
      } catch {
        continue; // zone unknown to this Node build
      }
      if (!byCountry.has(cc)) byCountry.set(cc, new Set());
      byCountry.get(cc).add(formatOffset(mins / 60));
    }
    return new Map([...byCountry].map(([cc, set]) => [cc, [...set].sort(tzOrder)]));
  } catch (err) {
    console.warn(`  zone.tab failed: ${err.message}; use Wikidata time zones`);
    return new Map();
  }
}

// ---------- World Bank ----------

/** Latest non-null value per ISO alpha-3 code. Map<iso3, {value, year}>. */
async function worldBankLatest(indicator) {
  const from = new Date().getFullYear() - 12;
  const url = `https://api.worldbank.org/v2/country/all/indicator/${indicator}?format=json&per_page=20000&date=${from}:${from + 13}`;
  const json = await fetchJson(url);
  const out = new Map();
  for (const r of json?.[1] ?? []) {
    if (r.value == null || !r.countryiso3code) continue;
    const year = Number(r.date);
    const prev = out.get(r.countryiso3code);
    if (!prev || year > prev.year) out.set(r.countryiso3code, { value: Number(r.value), year });
  }
  return out;
}

async function loadWorldBank() {
  console.log('Fetch World Bank indicators');
  const out = {};
  for (const [name, code] of Object.entries(WORLD_BANK)) {
    try {
      out[name] = await worldBankLatest(code);
    } catch (err) {
      console.warn(`  World Bank ${code} failed: ${err.message}`);
      out[name] = new Map();
    }
  }
  return out;
}

/**
 * The World Bank figure when it exists, else the Wikidata figure. Wikidata often holds
 * newer but rounded or wrong estimates (Tunisia 37.1M for 2026).
 */
function preferWorldBank(wikidata, worldBank) {
  return worldBank ?? wikidata ?? null;
}

// ---------- UNDP HDI ----------

/** Splits one CSV line. Handles quoted fields. */
function csvFields(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Latest HDI per ISO alpha-3 code from the UNDP time series. Map<iso3, {value, year}>. */
async function loadHdi() {
  console.log('Fetch UNDP HDI');
  try {
    const res = await fetch(HDR_URL, { redirect: 'follow', headers: { 'user-agent': USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
    const head = csvFields(lines[0]);
    const cols = head
      .map((name, i) => ({ i, m: name.match(/^hdi_(\d{4})$/) }))
      .filter((c) => c.m)
      .map((c) => ({ i: c.i, year: Number(c.m[1]) }))
      .sort((a, b) => b.year - a.year);
    const out = new Map();
    for (const line of lines.slice(1)) {
      const f = csvFields(line);
      const iso3 = f[0];
      if (!/^[A-Z]{3}$/.test(iso3)) continue;
      for (const c of cols) {
        const v = Number(f[c.i]);
        if (f[c.i] !== '' && Number.isFinite(v)) {
          out.set(iso3, { value: v, year: c.year });
          break;
        }
      }
    }
    console.log(`  ${out.size} countries`);
    return out;
  } catch (err) {
    console.warn(`  UNDP HDI failed: ${err.message}; use Wikidata`);
    return new Map();
  }
}

// ---------- Wikidata ----------

async function wikidataCodes() {
  const rows = await sparql(`
    SELECT ?code ?item ?n WHERE {
      ?item p:P298 ?st. ?st ps:P298 ?code; wikibase:rank ?r.
      FILTER(?r != wikibase:DeprecatedRank)
      ?item wikibase:statements ?n.
    }`);
  const best = new Map();
  for (const r of rows) {
    const n = Number(r.n);
    const prev = best.get(r.code);
    if (!prev || n > prev.n) best.set(r.code, { qid: qidOf(r.item), n });
  }
  return new Map([...best].map(([k, v]) => [k, v.qid]));
}

/**
 * Current holders of P35 / P6 and the offices from P1906 / P1313.
 * Returns Map<qid, {holders, offices, positions}>, where positions maps a holder's
 * entity URI to the offices that person holds now (P39 without an end time).
 */
async function wikidataHeads(qids, personProp, officeProp) {
  const people = await sparql(`
    SELECT ?item ?p ?pLabel ?rank ?start ?end WHERE {
      VALUES ?item { ${values(qids)} }
      ?item p:${personProp} ?s. ?s ps:${personProp} ?p; wikibase:rank ?rank.
      OPTIONAL { ?s pq:P580 ?start }
      OPTIONAL { ?s pq:P582 ?end }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    }`);
  const offices = await sparql(`
    SELECT ?item ?o ?oLabel ?rank WHERE {
      VALUES ?item { ${values(qids)} }
      ?item p:${officeProp} ?s. ?s ps:${officeProp} ?o; wikibase:rank ?rank.
      FILTER(?rank != wikibase:DeprecatedRank)
      FILTER NOT EXISTS { ?s pq:P582 ?end }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    }`);
  const positions = await sparql(`
    SELECT ?item ?p ?pos ?posLabel ?jur ?end WHERE {
      VALUES ?item { ${values(qids)} }
      ?item p:${personProp} ?s. ?s ps:${personProp} ?p; wikibase:rank ?r0.
      FILTER(?r0 != wikibase:DeprecatedRank)
      FILTER NOT EXISTS { ?s pq:P582 ?e0 }
      ?p p:P39 ?ps. ?ps ps:P39 ?pos; wikibase:rank ?r.
      FILTER(?r != wikibase:DeprecatedRank)
      OPTIONAL { ?ps pq:P582 ?end }
      OPTIONAL { ?pos wdt:P1001 ?jur }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`);
  const out = new Map();
  const get = (q) => {
    if (!out.has(q)) out.set(q, { holders: [], offices: [], positions: new Map() });
    return out.get(q);
  };
  for (const [item, rows] of groupBy(people, 'item')) {
    let cur = rows.filter((r) => RANK[r.rank] > 0 && (!r.end || isFuture(r.end)) && !isLabelId(r.pLabel));
    if (cur.some((r) => RANK[r.rank] === 2)) cur = cur.filter((r) => RANK[r.rank] === 2);
    const byPerson = new Map();
    for (const r of cur) if (!byPerson.has(r.p)) byPerson.set(r.p, r);
    get(qidOf(item)).holders = [...byPerson.values()];
  }
  for (const [item, rows] of groupBy(offices, 'item')) {
    const ok = rows.filter((r) => !isLabelId(r.oLabel));
    ok.sort((a, b) => RANK[b.rank] - RANK[a.rank]);
    get(qidOf(item)).offices = ok.map((r) => ({ uri: r.o, label: r.oLabel }));
  }
  for (const r of positions) {
    const e = get(qidOf(r.item));
    const key = r.end && !isFuture(r.end) ? 'ended' : 'positions';
    if (!e[key]) e[key] = new Map();
    if (!e[key].has(r.p)) e[key].set(r.p, []);
    e[key].get(r.p).push({ uri: r.pos, label: r.posLabel, jur: r.jur ?? null, end: r.end ?? null });
  }
  return out;
}

/** Position labels that can name a head of state or government. */
const HEAD_OFFICE = {
  P35: /\b(president|head of state|king|queen|monarch|emir|sultan|prince|emperor|chairman|chairperson|leader|governor|pope)\b/i,
  P6: /\b(prime minister|premier|chancellor|minister of state|head of government|chief (minister|executive)|president of the (government|council)|taoiseach)\b/i,
};
const NOT_HEAD_OFFICE =
  /\b(member|speaker|deputy|vice|candidate|alternate|national assembly|parliament|assembly|senate|congress)\b/i;

/** Joint offices legitimately have more than one current holder. */
const JOINT_OFFICE = /\b(co-|captains? regent|council|presidency)/i;

/**
 * Picks the current holder(s) and their office title for one country.
 * A holder counts as current when they hold one of the country's offices now (P39), or
 * any office for that country. Holders with no such position are dropped when someone
 * else has one: this removes former leaders whose statement has no end date.
 */
function pickHolders(entry, countryQid, role) {
  if (!entry || !entry.holders.length) return { name: null, office: null, stale: false };
  const officeUris = new Set(entry.offices.map((o) => o.uri));
  const countryUri = `${WD}${countryQid}`;
  const officeOf = (h) => {
    const pos = entry.positions.get(h.p) ?? [];
    return (
      pos.find((p) => officeUris.has(p.uri)) ??
      pos.find(
        (p) =>
          p.jur === countryUri &&
          !isLabelId(p.label) &&
          HEAD_OFFICE[role].test(p.label) &&
          !NOT_HEAD_OFFICE.test(p.label),
      ) ??
      null
    );
  };
  // A former holder has a P39 for the office that ended after this statement started, and no
  // current one. The start check keeps leaders who returned for a second term.
  const former = (r) => {
    const since = r.start ? Date.parse(r.start) : -Infinity;
    const ended = (entry.ended?.get(r.p) ?? []).filter(
      (p) => officeUris.has(p.uri) && Date.parse(p.end) > since,
    );
    const now = (entry.positions.get(r.p) ?? []).filter((p) => officeUris.has(p.uri));
    return ended.length > 0 && now.length === 0;
  };
  let h = entry.holders.filter((r) => !former(r));
  if (!h.length) return { name: null, office: null, stale: true, officeUris, heldUris: new Set() };
  const firstOffice = entry.offices[0]?.label ?? null;
  const joint = JOINT_OFFICE.test(firstOffice ?? '');
  const current = h.filter((r) => officeOf(r));
  const stale = current.length === 0;
  if (current.length && !joint) h = current;
  // No office on the country item (Greenland): use a head-type office the holder has anywhere.
  const anyHeadOffice = (r) =>
    (entry.positions.get(r.p) ?? []).find(
      (p) => !isLabelId(p.label) && HEAD_OFFICE[role].test(p.label) && !NOT_HEAD_OFFICE.test(p.label),
    ) ?? null;
  // Last resort: the office the holder held before (a returning leader with no current P39).
  const pastHeadOffice = (r) =>
    (entry.ended?.get(r.p) ?? []).find(
      (p) => !isLabelId(p.label) && HEAD_OFFICE[role].test(p.label) && !NOT_HEAD_OFFICE.test(p.label),
    ) ?? null;
  const titleFor = (r) =>
    joint
      ? firstOffice
      : (officeOf(r)?.label ?? firstOffice ?? anyHeadOffice(r)?.label ?? pastHeadOffice(r)?.label ?? null);
  if (h.length > 1 && !joint) {
    // Stale statements often lack an end date. Keep the latest start.
    const withStart = h.filter((r) => r.start);
    if (withStart.length) {
      withStart.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
      h = [withStart[0]];
    } else h = [h[0]];
  }
  h = [...h].sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''));
  const names = [...new Set(h.map((r) => cleanPerson(r.pLabel)))];
  const office = titleFor(h[0]);
  // No office anywhere and no current position: too weak to show.
  if (!office && stale) return { name: null, office: null, stale: true, officeUris, heldUris: new Set() };
  return {
    name: names.length ? joinNames(names) : null,
    office,
    stale,
    officeUris,
    heldUris: new Set(h.flatMap((r) => (entry.positions.get(r.p) ?? []).map((p) => p.uri))),
  };
}

/** Latest non-deprecated value (by P585) of a quantity property. Map<qid, {value, year}>. */
async function wikidataLatest(qids, prop, unit) {
  const rows = await sparql(`
    SELECT ?item ?v ?unit ?t ?rank WHERE {
      VALUES ?item { ${values(qids)} }
      ?item p:${prop} ?s. ?s psv:${prop} ?vn; wikibase:rank ?rank.
      FILTER(?rank != wikibase:DeprecatedRank)
      ?vn wikibase:quantityAmount ?v.
      OPTIONAL { ?vn wikibase:quantityUnit ?unit }
      OPTIONAL { ?s pq:P585 ?t }
    }`);
  const out = new Map();
  for (const [item, list] of groupBy(rows, 'item')) {
    const ok = list.filter((r) => !unit || r.unit === unit);
    if (!ok.length) continue;
    ok.sort(
      (a, b) =>
        (b.t ? Date.parse(b.t) : -Infinity) - (a.t ? Date.parse(a.t) : -Infinity) ||
        RANK[b.rank] - RANK[a.rank],
    );
    out.set(qidOf(item), { value: Number(ok[0].v), year: yearOf(ok[0].t) });
  }
  return out;
}

/** Current item-valued labels for a property. Map<qid, string[]>. */
async function wikidataLabels(qids, prop) {
  const rows = await sparql(`
    SELECT ?item ?v ?vLabel ?rank WHERE {
      VALUES ?item { ${values(qids)} }
      ?item p:${prop} ?s. ?s ps:${prop} ?v; wikibase:rank ?rank.
      FILTER(?rank != wikibase:DeprecatedRank)
      FILTER NOT EXISTS { ?s pq:P582 ?end }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
    }`);
  const out = new Map();
  for (const [item, list] of groupBy(rows, 'item')) {
    const ok = list.filter((r) => !isLabelId(r.vLabel));
    ok.sort((a, b) => RANK[b.rank] - RANK[a.rank]);
    const labels = [...new Set(ok.map((r) => r.vLabel))];
    out.set(qidOf(item), labels);
  }
  return out;
}

/**
 * Current standard time zones as "UTC+05:30" strings, from P421.
 * A zone named "UTC+05:30" gives its offset directly. Other zones (IANA, "Central European
 * Time") list several P2907 offsets, often with summer time; the lowest one is standard time.
 * When a country has preferred-rank zones, only those count.
 */
async function wikidataTimezones(qids) {
  const rows = await sparql(`
    SELECT ?item ?z ?zLabel ?off ?rank WHERE {
      VALUES ?item { ${values(qids)} }
      ?item p:P421 ?s. ?s ps:P421 ?z; wikibase:rank ?rank.
      FILTER(?rank != wikibase:DeprecatedRank)
      FILTER NOT EXISTS { ?s pq:P582 ?end }
      FILTER NOT EXISTS { ?s pq:P1264 ?period }
      OPTIONAL { ?z wdt:P2907 ?off }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`);
  const out = new Map();
  for (const [item, list] of groupBy(rows, 'item')) {
    const preferred = list.filter((r) => RANK[r.rank] === 2);
    const use = preferred.length ? preferred : list;
    const zones = new Set();
    for (const [, zrows] of groupBy(use, 'z')) {
      const label = zrows[0].zLabel;
      if (/summer|daylight/i.test(label)) continue;
      let z = utcLabel(label);
      if (!z) {
        const offs = zrows.map((r) => Number(r.off)).filter((n) => isOffset(n));
        if (offs.length) z = formatOffset(Math.min(...offs));
      }
      if (z) zones.add(z);
    }
    out.set(qidOf(item), [...zones].sort(tzOrder));
  }
  return out;
}

const isOffset = (n) => Number.isFinite(n) && n >= -12 && n <= 14;

function formatOffset(hours) {
  if (!Number.isFinite(hours)) return null;
  if (hours === 0) return 'UTC';
  const sign = hours < 0 ? '-' : '+';
  const mins = Math.round(Math.abs(hours) * 60);
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

function utcLabel(label) {
  const m = label?.match(/^UTC\s*([+−-])\s*(\d{1,2})(?::?(\d{2}))?$/);
  if (label === 'UTC' || label === 'UTC±00:00') return 'UTC';
  if (!m) return null;
  const sign = m[1] === '+' ? 1 : -1;
  return formatOffset(sign * (Number(m[2]) + Number(m[3] ?? 0) / 60));
}

async function wikidataSitelinks(qids) {
  const rows = await sparql(`
    SELECT ?item ?article WHERE {
      VALUES ?item { ${values(qids)} }
      ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>.
    }`);
  return new Map(rows.map((r) => [qidOf(r.item), r.article]));
}

async function wikidataUnMembers(qids) {
  const rows = await sparql(`
    SELECT ?item WHERE {
      VALUES ?item { ${values(qids)} }
      ?item p:P463 ?s. ?s ps:P463 wd:Q1065; wikibase:rank ?rank.
      FILTER(?rank != wikibase:DeprecatedRank)
      FILTER NOT EXISTS { ?s pq:P582 ?end }
    }`);
  return new Set(rows.map((r) => qidOf(r.item)));
}

async function wikidataFlags(qids) {
  const rows = await sparql(`
    SELECT ?item ?f ?rank WHERE {
      VALUES ?item { ${values(qids)} }
      ?item p:P41 ?s. ?s ps:P41 ?f; wikibase:rank ?rank.
      FILTER(?rank != wikibase:DeprecatedRank)
      FILTER NOT EXISTS { ?s pq:P582 ?end }
    }`);
  const out = new Map();
  for (const [item, list] of groupBy(rows, 'item')) {
    list.sort((a, b) => RANK[b.rank] - RANK[a.rank]);
    out.set(qidOf(item), list[0].f.replace(/^http:/, 'https:'));
  }
  return out;
}

/** Fetches every Wikidata fact for a batch of items. Each part fails on its own. */
async function wikidataBatch(qids, extraQids) {
  const res = { failed: [] };
  const step = async (name, fn) => {
    try {
      res[name] = await fn();
    } catch (err) {
      console.warn(`  Wikidata ${name} failed: ${err.message}`);
      res.failed.push(name);
      res[name] = new Map();
    }
  };
  await step('sitelinks', () => wikidataSitelinks(qids));
  await step('government', () => wikidataLabels(qids, 'P122'));
  await step('hos', () => wikidataHeads(qids, 'P35', 'P1906'));
  await step('hog', () => wikidataHeads(qids, 'P6', 'P1313'));
  await step('gdp', () => wikidataLatest(qids, 'P2131', USD));
  await step('gdppc', () => wikidataLatest(qids, 'P2132', USD));
  await step('hdi', () => wikidataLatest(qids, 'P1081'));
  await step('life', () => wikidataLatest(qids, 'P2250'));
  await step('population', () => wikidataLatest(qids, 'P1082'));
  await step('timezones', () => wikidataTimezones(qids));
  await step('un', () => wikidataUnMembers(qids));
  if (extraQids.length) {
    await step('flags', () => wikidataFlags(extraQids));
    await step('capitals', () => wikidataLabels(extraQids, 'P36'));
    await step('areas', () => wikidataLatest(extraQids, 'P2046', KM2));
  }
  return res;
}

function mergeMaps(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (k === 'failed') {
      target.failed = [...(target.failed ?? []), ...v];
      continue;
    }
    if (!target[k]) target[k] = v instanceof Set ? new Set() : new Map();
    if (v instanceof Set) for (const x of v) target[k].add(x);
    else for (const [a, b] of v) target[k].set(a, b);
  }
}

// ---------- main ----------

async function main() {
  const t0 = Date.now();
  const previous = (await readJsonIfExists(OUT_COUNTRIES)) ?? {};

  const { topo, entries } = await buildGeometry();
  const base = await loadBase();
  const byCcn3 = new Map(base.filter((c) => c.ccn3).map((c) => [c.ccn3, c]));
  const byCca3 = new Map(base.map((c) => [c.cca3, c]));
  const wb = await loadWorldBank();
  const zoneTab = await loadZoneTab();
  const undpHdi = await loadHdi();

  // Resolve ids.
  for (const e of entries) {
    if (e.ccn3) {
      const c = byCcn3.get(e.ccn3);
      if (!c) {
        e.id = `X-${slug(e.worldName)}`;
        e.name = e.worldName;
        console.warn(`  no record for numeric id ${e.ccn3} (${e.worldName}); use ${e.id}`);
      } else {
        e.id = c.cca3;
        e.base = c;
        e.iso3 = c.cca3;
      }
    } else if (e.mledoze) {
      e.base = byCca3.get(e.mledoze);
    }
    if (!e.name) e.name = NAME_OVERRIDES[e.id] ?? e.base?.name.common ?? e.worldName;
  }
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length) throw new Error('duplicate CountryId in geometry');

  // Wikidata items.
  console.log('Fetch Wikidata');
  let codeToQid = new Map();
  try {
    codeToQid = await wikidataCodes();
  } catch (err) {
    console.warn(`  Wikidata code lookup failed: ${err.message}`);
  }
  for (const e of entries) if (!e.qid && e.iso3) e.qid = codeToQid.get(e.iso3) ?? null;
  const qids = entries.map((e) => e.qid).filter(Boolean);
  const extra = entries.filter((e) => e.id.startsWith('X-') && e.qid).map((e) => e.qid);
  const wd = { failed: [] };
  const batches = chunk(qids, 50);
  for (const [i, b] of batches.entries()) {
    console.log(`  batch ${i + 1}/${batches.length} (${b.length} items)`);
    const ex = b.filter((q) => extra.includes(q));
    const r = await wikidataBatch(b, ex);
    // A failed part means "unknown" for the batch, not "none".
    for (const name of r.failed) for (const q of b) wd.failedFor = (wd.failedFor ?? new Set()).add(`${name}:${q}`);
    mergeMaps(wd, r);
  }
  const failedPart = (name, qid) => wd.failedFor?.has(`${name}:${qid}`) ?? false;

  // Geometry: rewrite properties, drop numeric id.
  const geoms = topo.objects.countries.geometries;
  for (const [i, g] of geoms.entries()) {
    const e = entries[i];
    delete g.id;
    g.properties = { id: e.id, name: e.name };
  }

  // Centroids for areas without a point.
  const centroid = (e) => {
    const f = feature(topo, e.geom);
    const [lng, lat] = geoCentroid(f);
    return [Math.round(lat * 100) / 100, Math.round(lng * 100) / 100];
  };

  const countries = {};
  const staleHeads = [];
  for (const e of entries) {
    const c = e.base;
    const q = e.qid;
    const prev = previous[e.id];
    let hos = pickHolders(wd.hos?.get(q), q, 'P35');
    let hog = pickHolders(wd.hog?.get(q), q, 'P6');
    // In a presidential system one office has both roles. When one side lists a former
    // holder and the other side's holder holds that office now, use the current holder.
    const shares = (a, b) => [...(a.officeUris ?? [])].some((u) => b.heldUris?.has(u));
    if (hog.stale && hos.name && !hos.stale && shares(hog, hos)) hog = hos;
    else if (hos.stale && hog.name && !hog.stale && shares(hos, hog)) hos = hog;
    for (const [role, x] of [['head of state', wd.hos?.get(q)], ['head of government', wd.hog?.get(q)]]) {
      const before = x?.holders.length ?? 0;
      if (before && !(role === 'head of state' ? hos : hog).name && !GOVERNMENT_OVERRIDES[e.id])
        staleHeads.push(`${e.id} ${role}: left empty (only former or unconfirmed holders)`);
    }
    // One person in both roles holds one office (Uzbekistan lists its president under P6).
    if (hog.name && hog.name === hos.name) hog = hos;
    if (hos.stale && hos.name) staleHeads.push(`${e.id} head of state ${hos.name}`);
    if (hog.stale && hog.name && hog !== hos) staleHeads.push(`${e.id} head of government ${hog.name}`);
    const nameSet = new Set([
      e.name,
      c?.name.common,
      c?.name.official,
      ...(c?.altSpellings ?? []).filter((s) => s.length > 3),
    ]);
    const iso3 = e.worldBank ?? e.iso3;
    const pop = preferWorldBank(wd.population?.get(q), wb.population.get(iso3));
    const gdp = preferWorldBank(wd.gdp?.get(q), wb.gdp.get(iso3));
    const gdppc = preferWorldBank(wd.gdppc?.get(q), wb.gdppc.get(iso3));
    const life = preferWorldBank(wd.life?.get(q), wb.life.get(iso3));
    const urban = wb.urban.get(iso3);
    const hdi = (e.iso3 && undpHdi.get(e.iso3)) || wd.hdi?.get(q);
    const iso2 = c?.cca2 ?? null;

    const info = {
      id: e.id,
      iso2,
      name: e.name,
      officialName: c?.name.official ?? null,
      flag: iso2
        ? `https://flagcdn.com/${iso2.toLowerCase()}.svg`
        : (wd.flags?.get(q) ?? null),
      capital: c?.capital?.length ? c.capital : (wd.capitals?.get(q) ?? []),
      region: c?.region ?? e.region ?? null,
      subregion: c?.subregion ?? e.subregion ?? null,
      latlng:
        c?.latlng?.length === 2 && !e.id.startsWith('X-') ? [c.latlng[0], c.latlng[1]] : centroid(e),
      area: c?.area ?? wd.areas?.get(q)?.value ?? null,
      population: pop ? Math.round(pop.value) : null,
      populationYear: pop?.year ?? null,
      languages: c ? Object.values(c.languages ?? {}) : [],
      currencies: c
        ? Object.entries(c.currencies ?? {}).map(([code, v]) => ({
            code,
            name: v.name,
            symbol: v.symbol ?? null,
          }))
        : [],
      callingCode: c ? callingCode(c) : null,
      timezones: (iso2 && zoneTab.get(iso2)) || wd.timezones?.get(q) || [],
      borders: [],
      government: {
        type: governmentType(wd.government?.get(q)),
        headOfState: hos.name,
        headOfStateTitle: hos.name ? shortTitle(hos.office, nameSet) : null,
        headOfGovernment: hog.name,
        headOfGovernmentTitle: hog.name ? shortTitle(hog.office, nameSet) : null,
      },
      economy: {
        gdpUsd: gdp ? Math.round(gdp.value) : null,
        gdpYear: gdp?.year ?? null,
        gdpPerCapitaUsd: gdppc ? Math.round(gdppc.value) : null,
        hdi: hdi ? hdi.value : null,
        hdiYear: hdi?.year ?? null,
      },
      demographics: {
        lifeExpectancy: life ? Math.round(life.value * 10) / 10 : null,
        urbanPopulationPct: urban ? Math.round(urban.value * 10) / 10 : null,
      },
      unMember: q && !failedPart('un', q) ? wd.un.has(q) : (c?.unMember ?? null),
      wikipedia: wd.sitelinks?.get(q) ?? null,
    };

    // Keep previous values for parts that failed on this run.
    if (prev && q) {
      if (failedPart('government', q)) info.government.type = prev.government.type;
      if (failedPart('hos', q)) {
        info.government.headOfState = prev.government.headOfState;
        info.government.headOfStateTitle = prev.government.headOfStateTitle;
      }
      if (failedPart('hog', q)) {
        info.government.headOfGovernment = prev.government.headOfGovernment;
        info.government.headOfGovernmentTitle = prev.government.headOfGovernmentTitle;
      }
      // Figures with a second source keep the previous value only when this run found none.
      if (failedPart('gdp', q) && info.economy.gdpUsd == null)
        Object.assign(info.economy, { gdpUsd: prev.economy.gdpUsd, gdpYear: prev.economy.gdpYear });
      if (failedPart('gdppc', q) && info.economy.gdpPerCapitaUsd == null)
        info.economy.gdpPerCapitaUsd = prev.economy.gdpPerCapitaUsd;
      if (failedPart('hdi', q) && info.economy.hdi == null) Object.assign(info.economy, { hdi: prev.economy.hdi, hdiYear: prev.economy.hdiYear });
      if (failedPart('life', q) && info.demographics.lifeExpectancy == null)
        info.demographics.lifeExpectancy = prev.demographics.lifeExpectancy;
      if (failedPart('population', q) && info.population == null)
        Object.assign(info, { population: prev.population, populationYear: prev.populationYear });
      if (failedPart('timezones', q) && !info.timezones.length) info.timezones = prev.timezones;
      if (failedPart('sitelinks', q)) info.wikipedia = prev.wikipedia;
    }
    if (info.government.type === null && info.government.headOfState === null && prev && !q) {
      info.government = prev.government;
    }
    Object.assign(info.government, GOVERNMENT_OVERRIDES[e.id] ?? {});
    if (!info.government.type && GOVERNMENT_TYPE_FALLBACK[e.id]) info.government.type = GOVERNMENT_TYPE_FALLBACK[e.id];
    // A title with no name says nothing.
    if (!info.government.headOfState) info.government.headOfStateTitle = null;
    if (!info.government.headOfGovernment) info.government.headOfGovernmentTitle = null;

    // mledoze borders use cca3; Kosovo is "UNK" there.
    info.borders = (c?.borders ?? [])
      .map((b) => (b === 'UNK' ? 'X-kosovo' : b))
      .filter((b) => ids.has(b));

    countries[e.id] = info;
  }

  // Write.
  const sorted = Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b)));
  const api = Object.fromEntries(Object.values(sorted).map((c) => [c.id, { name: c.name, iso2: c.iso2 }]));
  await writeAtomic(OUT_WORLD, JSON.stringify(topo));
  await writeAtomic(OUT_COUNTRIES, JSON.stringify(sorted));
  await writeAtomic(OUT_API, JSON.stringify(api));

  report(sorted, entries.length, wd.failed);
  if (staleHeads.length) {
    console.log('\nLeaders with no current matching position in Wikidata (check these):');
    for (const s of staleHeads) console.log(`  ${s}`);
  }
  for (const p of [OUT_WORLD, OUT_COUNTRIES, OUT_API]) {
    const s = await stat(p);
    console.log(`  ${p.replace(ROOT + '/', '')}  ${(s.size / 1024).toFixed(1)} KB`);
  }
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

function tzOrder(a, b) {
  const v = (s) => {
    const m = s.match(/UTC([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    const sign = m[1] === '+' ? 1 : -1;
    return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
  };
  return v(a) - v(b);
}

function report(countries, geometryCount, failed) {
  const list = Object.values(countries);
  const count = (fn) => list.filter(fn).length;
  console.log('\nCoverage');
  console.log(`  geometries          ${geometryCount}`);
  console.log(`  entries             ${list.length}`);
  console.log(`  with facts (capital) ${count((c) => c.capital.length)}`);
  console.log(`  with population     ${count((c) => c.population)}`);
  console.log(`  with government     ${count((c) => c.government.type)}`);
  console.log(`  with headOfState    ${count((c) => c.government.headOfState)}`);
  console.log(`  with headOfGov      ${count((c) => c.government.headOfGovernment)}`);
  console.log(`  with gdp            ${count((c) => c.economy.gdpUsd)}`);
  console.log(`  with hdi            ${count((c) => c.economy.hdi)}`);
  console.log(`  with urban pct      ${count((c) => c.demographics.urbanPopulationPct != null)}`);
  console.log(`  with lifeExpectancy ${count((c) => c.demographics.lifeExpectancy)}`);
  console.log(`  with timezones      ${count((c) => c.timezones.length)}`);
  console.log(`  with flag           ${count((c) => c.flag)}`);
  console.log(`  with wikipedia      ${count((c) => c.wikipedia)}`);
  if (failed.length) console.log(`  failed Wikidata parts: ${[...new Set(failed)].join(', ')}`);

  console.log('\nSpot checks');
  for (const id of ['IND', 'USA', 'GBR', 'FRA', 'JPN', 'BRA', 'DEU', 'SAU', 'VAT', 'AND', 'SMR', 'MCO', 'CHE', 'X-kosovo', 'X-somaliland']) {
    const c = countries[id];
    if (!c) continue;
    const g = c.government;
    console.log(
      `  ${id.padEnd(13)} ${c.name} | ${g.type ?? '-'}\n` +
        `                HoS: ${g.headOfStateTitle ?? '-'}: ${g.headOfState ?? '-'}\n` +
        `                HoG: ${g.headOfGovernmentTitle ?? '-'}: ${g.headOfGovernment ?? '-'}\n` +
        `                pop ${c.population ?? '-'} (${c.populationYear ?? '-'}), gdp ${c.economy.gdpUsd ?? '-'} (${c.economy.gdpYear ?? '-'}), hdi ${c.economy.hdi ?? '-'}, life ${c.demographics.lifeExpectancy ?? '-'}, urban ${c.demographics.urbanPopulationPct ?? '-'}%, tz ${c.timezones.length}, un ${c.unMember}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
