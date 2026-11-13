// Builds api/_lib/breaking/places.json: the place gazetteer of the breaking-news country matcher.
//
// Output: { meta, given, places: Record<CountryId, { major, place, context }> }
//   major    a place that counts alone, also in a Title Case headline: 1 million people or more, or 2 or more words
//   place    a place that counts alone in a sentence-case headline
//   context  a place that counts only after "in", "near" or a similar word, or before ", <a place of the same
//            country>" ("Mobile, Alabama"). Small places, old names, English words, brands and person names are in this class.
//   given    given names. A place right after a given name is part of a person name ("Lewis Hamilton").
//
// The rules (accuracy comes before coverage):
//   - A name stays only when its country has RATIO times the score of the same name in every other country.
//     The score is the population. A region or a suburb counts at 1/3 of its population.
//   - A Natural Earth physical or marine feature with the same name makes the name ambiguous
//     ("Andes" the range, not the town in Colombia).
//   - Continents, months, peoples, royal titles and generic words never become places.
//   - A name that aliases.json has stays with aliases.json (the curated table always wins).
//
// Sources. The script downloads each source into its own folder in the cache, and reads the files as data only:
//   GeoNames (CC BY 4.0): cities1000, admin1 and admin2 codes, countryInfo, the English alternate names
//   Natural Earth 10m physical and marine labels (public domain), tag v5.1.2
//   3esl common English words (alt12dicts by Alan Beale, public domain, through SCOWL rel-2020.12.07)
//   US Census Bureau 2010 surnames (public domain), rank 5000 or better
//   Wikidata given names (CC0), from the query service
//
// Run: node scripts/build-places.mjs [--refresh] [--offline] [--cache <dir>]
//   --refresh   download all sources again (a failed Wikidata query uses the cached copy)
//   --offline   use the cache only, and fail when a file is missing
//   --cache     the cache folder (default .cache/places)
// Run it after `npm run aliases:breaking`, then commit the JSON. The server never downloads it.
// The script needs the `unzip` command (macOS and Linux have it).

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN_ALIASES = join(ROOT, 'api/_lib/breaking/aliases.json');
const OUT = join(ROOT, 'api/_lib/breaking/places.json');
const args = process.argv.slice(2);
const REFRESH = args.includes('--refresh');
const OFFLINE = args.includes('--offline');
const CACHE = resolve(ROOT, args.includes('--cache') ? args[args.indexOf('--cache') + 1] : '.cache/places');
const USER_AGENT = 'Mozilla/5.0 (compatible; data-build)';

const GEONAMES = 'https://download.geonames.org/export/dump/';
const NATURAL_EARTH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/';
const WORDS_URL = 'https://raw.githubusercontent.com/en-wl/wordlist/rel-2020.12.07/alt12dicts/3esl.txt';
const CENSUS_URL = 'https://www2.census.gov/topics/genealogy/2010surnames/names.zip';
const WIKIDATA = 'https://query.wikidata.org/sparql';
// Wikidata given-name classes and the smallest number of sitelinks. The female class times out at 4.
const GIVEN_CLASSES = [
  { name: 'male', qid: 'Q12308941', links: 4 },
  { name: 'unisex', qid: 'Q3409032', links: 4 },
  { name: 'female', qid: 'Q11879590', links: 6 },
];

const MIN_POP = 100_000; // a plain place
const SECTION_POP = 50_000; // a borough or district (PPLX, PPLA2) of a big city: Flatbush, Kreuzberg, Harlem
const SMALL_POP = 15_000; // the smallest place. Below MIN_POP, a place is context-only and must have a unique name.
const MAJOR_POP = 1_000_000; // a single-word place that counts in a Title Case headline
const RATIO = 10; // the dominance of a name over the same name in any other country
const HOMONYM_POP = 1_000; // a homonym smaller than this does not count
const DISCOUNT = { ADM1: 3, ADM2: 3, PPLX: 3 }; // a region or a suburb is less famous than a town of the same size
const NE_DIST_KM = 300; // a Natural Earth feature farther than this (plus half its size) is another thing

// GeoNames country codes that are not in aliases.json as their own country.
const ISO_OVERRIDE = { XK: 'X-kosovo', GP: 'FRA', GF: 'FRA', MQ: 'FRA', YT: 'FRA', RE: 'FRA', SJ: 'NOR', BQ: 'NLD', TK: 'NZL' };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];
const REGIONS = [
  'Asia', 'Europe', 'Africa', 'America', 'Americas', 'Oceania', 'Antarctica', 'Arctic', 'Atlantic', 'Pacific', 'Caribbean',
  'Balkans', 'Sahara', 'Sahel', 'Scandinavia', 'Siberia', 'Patagonia', 'Middle East', 'Mediterranean', 'Baltic', 'Eurasia', 'Latin',
];
// Peoples, characters and film industries that are also place names.
const BLOCK = new Set(['Naga', 'Shan', 'Kachin', 'Chin', 'Karen', 'Afar', 'Mon', 'Batman', 'Hollywood', 'Bollywood', ...MONTHS, ...REGIONS]);
// A name of these words only is no place ("Gulf" gave PNG, "Free" gave ZAF).
const GENERIC = new Set([
  'Central', 'Western', 'Eastern', 'Northern', 'Southern', 'North', 'South', 'East', 'West', 'Capital', 'Centre', 'Center',
  'Coast', 'Islands', 'Island', 'Lakes', 'Upper', 'Lower', 'Federal', 'Middle', 'Interior', 'Gulf', 'Free', 'Union', 'Unity',
  'Northeast', 'Northwest', 'Southeast', 'Southwest', 'Northeastern', 'Southeastern', 'Maritime', 'Oriental', 'Commonwealth',
  'Confederation', 'Centrale', 'Northland', 'Southland',
]);
// "Prince William County", "Prince George": a royal title starts a person name.
const TITLE_START = /^(?:Prince|Princess|King|Queen|Duke|Duchess|Lord|Lady|Sir|Emperor|Sultan)\b/;
// Brands that are also place names. They are context-only.
const BRANDS = new Set([
  'Meta', 'Toyota', 'Hitachi', 'Nokia', 'Mercedes', 'Kia', 'Shell', 'Bata', 'Zara', 'Mango', 'Tata', 'Santander', 'Paramount',
  'Corona', 'Delta', 'Bayer', 'Opel', 'Skoda', 'Sharp', 'Canon', 'Fairfax',
]);
// Natural Earth classes that block a name at any distance: a continent, a sea or a range is never a town.
const NE_HARD = new Set(['Continent', 'ocean', 'sea', 'Range/mtn', 'Desert', 'Plateau', 'Basin', 'Tundra', 'Dragons-be-here']);
// Natural Earth classes that never block a name: a river names its region ("Limpopo").
const NE_EXEMPT = new Set(['river']);

const PREFIX = /^(?:City of|London Borough of|Royal Borough of|Borough of|Municipality of|Town of) /;
const TYPE1 = / (?:Oblast|Province|Governorate|Prefecture|Region|Krai|Voivodeship|State)$/;
const TYPE2 = / (?:County|District|Municipality|Parish|Province|Region)$/;

/** A form that a headline can hold: 4 or more characters, a capital Latin letter first, Latin letters only. */
function okForm(s) {
  if (s.length < 4 || !/^\p{Lu}/u.test(s) || /[0-9()/,]/.test(s)) return false;
  for (const ch of s) if (/\p{L}/u.test(ch) && ch.codePointAt(0) > 0x24f) return false;
  return true;
}

// ---- downloads and the cache

async function download(dir, name, url) {
  const folder = join(CACHE, dir);
  const path = join(folder, name);
  if (existsSync(path) && !REFRESH) return path;
  if (OFFLINE) throw new Error(`--offline: ${path} is missing`);
  await mkdir(folder, { recursive: true });
  process.stdout.write(`download ${url} ... `);
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  const tmp = `${path}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
  await rename(tmp, path);
  await writeFile(`${path}.headers.json`, JSON.stringify({ url, lastModified: res.headers.get('last-modified'), fetched: new Date().toISOString() }));
  console.log(`${(await stat(path)).size} bytes`);
  return path;
}

async function lastModified(path) {
  try {
    const h = JSON.parse(await readFile(`${path}.headers.json`, 'utf8'));
    if (h.lastModified) return new Date(h.lastModified).toISOString();
  } catch {
    // No headers file: use the time of the file.
  }
  return (await stat(path)).mtime.toISOString();
}

async function* fileLines(path) {
  yield* createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
}

/** The lines of one member of a zip file, through `unzip -p`. */
async function* zipLines(zip, member) {
  const child = spawn('unzip', ['-p', zip, member], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const done = new Promise((ok, fail) => {
    child.on('error', (err) => fail(err.code === 'ENOENT' ? new Error('the `unzip` command is missing: install unzip, then run again') : err));
    child.on('close', (code) => (code === 0 ? ok() : fail(new Error(`unzip -p ${zip} ${member}: exit ${code} ${stderr}`))));
  });
  done.catch(() => {}); // The await below reports the error.
  child.stdout.setEncoding('utf8');
  yield* createInterface({ input: child.stdout, crlfDelay: Infinity });
  await done;
}

/**
 * True for a complete answer of the query service. On a timeout, the service can send HTTP 200 with
 * part of the rows and then a Java stack trace. So every row must be one English label.
 */
function completeTsv(text) {
  const rows = text.split('\n').slice(1).filter((l) => l.trim());
  return text.startsWith('?label') && rows.length > 0 && rows.every((l) => /^"(?:[^"\\]|\\.)*"@en$/.test(l.trim()));
}

/** Given names of one Wikidata class, as a TSV file in the cache. A failed query uses the cached copy. */
async function wikidataNames({ name, qid, links }) {
  const folder = join(CACHE, 'wikidata');
  const path = join(folder, `given-${name}.tsv`);
  const cached = existsSync(path) && completeTsv(await readFile(path, 'utf8'));
  if (existsSync(path) && !cached) console.warn(`wikidata ${name}: the cached copy is not complete`);
  if (cached && !REFRESH) return path;
  if (OFFLINE) throw new Error(`--offline: ${path} is missing`);
  await mkdir(folder, { recursive: true });
  const query = `SELECT ?label WHERE { ?item wdt:P31 wd:${qid}; wikibase:sitelinks ?sl . FILTER(?sl >= ${links}) ?item rdfs:label ?label . FILTER(LANG(?label)="en") }`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${WIKIDATA}?query=${encodeURIComponent(query)}`, {
        headers: { accept: 'text/tab-separated-values', 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!completeTsv(text)) throw new Error('not a complete TSV answer (the query timed out?)');
      await writeFile(`${path}.part`, text);
      await rename(`${path}.part`, path);
      console.log(`wikidata ${name}: ${text.split('\n').length - 2} names`);
      return path;
    } catch (err) {
      console.warn(`wikidata ${name}: attempt ${attempt} failed (${err.message})`);
      if (attempt < 3) await new Promise((ok) => setTimeout(ok, 5_000 * attempt));
    }
  }
  if (cached) {
    console.warn(`wikidata ${name}: use the cached copy`);
    return path;
  }
  throw new Error(`wikidata ${name}: the query failed and no cached copy exists`);
}

// ---- geometry

function bbox(geometry) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  const walk = (x) => {
    if (typeof x[0] === 'number') {
      minLon = Math.min(minLon, x[0]);
      maxLon = Math.max(maxLon, x[0]);
      minLat = Math.min(minLat, x[1]);
      maxLat = Math.max(maxLat, x[1]);
    } else for (const y of x) walk(y);
  };
  walk(geometry.coordinates);
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2, span: Math.max(maxLat - minLat, maxLon - minLon) };
}

function km(a, b) {
  const p = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * p) / 2) ** 2 + Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(((b.lon - a.lon) * p) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// ---- main

async function main() {
  const aliases = JSON.parse(await readFile(IN_ALIASES, 'utf8'));
  const geo = {};
  for (const f of ['cities1000.zip', 'admin1CodesASCII.txt', 'admin2Codes.txt', 'countryInfo.txt', 'alternateNamesV2.zip']) {
    geo[f] = await download('geonames', f, GEONAMES + f);
  }
  const ne = {};
  for (const f of ['ne_10m_geography_regions_points', 'ne_10m_geography_regions_polys', 'ne_10m_geography_marine_polys']) {
    ne[f] = await download('naturalearth', `${f}.geojson`, `${NATURAL_EARTH}${f}.geojson`);
  }
  const wordsPath = await download('words', '3esl.txt', WORDS_URL);
  const censusPath = await download('census', 'names.zip', CENSUS_URL);
  const givenPaths = [];
  for (const g of GIVEN_CLASSES) givenPaths.push(await wikidataNames(g));

  // ISO2 -> the app id. Only ids that aliases.json has.
  const iso = new Map();
  for await (const line of fileLines(geo['countryInfo.txt'])) {
    if (line.startsWith('#') || !line.trim()) continue;
    const r = line.split('\t');
    iso.set(r[0], r[1]);
  }
  for (const [k, v] of Object.entries(ISO_OVERRIDE)) iso.set(k, v);
  const cid = (cc) => (aliases[iso.get(cc)] ? iso.get(cc) : null);

  // The curated forms. A gazetteer form never takes one of them.
  const existing = new Set();
  for (const a of Object.values(aliases)) {
    for (const x of [...a.names, ...a.demonyms, ...a.places]) existing.add(x);
    for (const l of a.leaders) {
      existing.add(l.name);
      if (l.surname) existing.add(l.surname);
    }
  }

  const words = new Set();
  for await (const line of fileLines(wordsPath)) {
    const w = line.trim();
    if (w && w === w.toLowerCase() && w !== w.toUpperCase()) words.add(w);
  }
  const isWord = (low) => words.has(low) || words.has(low.replace(/s+$/, ''));
  const given = new Set();
  for (const path of givenPaths) {
    for await (const line of fileLines(path)) {
      const m = /^"(.+)"@en(?:\t|$)/.exec(line);
      if (m) given.add(m[1]);
    }
  }
  const surnames = new Set();
  const titleCase = (s) => s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  for await (const line of zipLines(censusPath, 'Names_2010Census.csv')) {
    const r = line.split(',');
    if (/^\d+$/.test(r[1]) && Number(r[1]) <= 5000) surnames.add(titleCase(r[0]));
  }

  // GeoNames cities: [0]=id [1]=name [2]=asciiname [4]=lat [5]=lon [7]=feature code [8]=ISO2 [10]=admin1 [11]=admin2 [14]=population
  const rows = [];
  const admPop = new Map();
  const addPop = (k, n) => admPop.set(k, (admPop.get(k) ?? 0) + n);
  for await (const line of zipLines(geo['cities1000.zip'], 'cities1000.txt')) {
    const r = line.split('\t');
    if (r.length < 15) continue;
    const row = { id: r[0], name: r[1], ascii: r[2], lat: Number(r[4]), lon: Number(r[5]), code: r[7], cc: r[8], a1: r[10], a2: r[11], pop: Number(r[14] || 0) };
    // A PPLX row (a section of a city) is inside the city row already, so it does not count twice.
    if (row.code !== 'PPLX') {
      addPop(`${row.cc}.${row.a1}`, row.pop);
      addPop(`${row.cc}.${row.a1}.${row.a2}`, row.pop);
    }
    rows.push(row);
  }
  const admins = [];
  for (const path of [geo['admin1CodesASCII.txt'], geo['admin2Codes.txt']]) {
    for await (const line of fileLines(path)) {
      const [code, name, ascii, id] = line.split('\t');
      if (code && id) admins.push({ code, name, ascii, id });
    }
  }

  // English alternate names: [1]=geonameid [2]=isolanguage [3]=name [6]=isColloquial [7]=isHistoric.
  // Historic names stay (Kiev, Bombay), but they are context-only: "Romanov" is an old name of Murmansk.
  const needed = new Set([...rows.map((r) => r.id), ...admins.map((a) => a.id)]);
  const en = new Map();
  let altRows = 0;
  for await (const line of zipLines(geo['alternateNamesV2.zip'], 'alternateNamesV2.txt')) {
    if (!line.includes('\ten\t')) continue;
    const r = line.split('\t');
    if (r[2] !== 'en' || r[6] === '1' || !needed.has(r[1])) continue;
    altRows++;
    const alt = { name: r[3], historic: r[7] === '1' };
    const list = en.get(r[1]);
    if (list) list.push(alt);
    else en.set(r[1], [alt]);
  }
  /** The forms of one GeoNames row: form -> true when only a historic alternate name gives the form. */
  const formsOf = (official, id) => {
    const out = new Map(official.filter(okForm).map((f) => [f, false]));
    for (const a of en.get(id) ?? []) if (okForm(a.name) && !out.has(a.name)) out.set(a.name, a.historic);
    for (const a of en.get(id) ?? []) if (!a.historic && out.has(a.name)) out.set(a.name, false);
    return out;
  };

  // The homonym table: form -> country -> best score. It covers all countries, also the ones with no app id.
  const homonyms = new Map();
  const note = (form, c, score) => {
    let m = homonyms.get(form);
    if (!m) homonyms.set(form, (m = new Map()));
    m.set(c, Math.max(m.get(c) ?? 0, score));
  };
  const cands = [];
  const admCoord = new Map(); // admin code -> the largest city in it
  for (const r of rows) {
    const c = cid(r.cc) ?? r.cc;
    const score = r.pop / (DISCOUNT[r.code] ?? 1);
    const forms = formsOf([r.name, r.ascii], r.id);
    for (const f of forms.keys()) {
      note(f, c, score);
      if (PREFIX.test(f) && okForm(f.replace(PREFIX, ''))) note(f.replace(PREFIX, ''), c, score);
    }
    for (const k of [`${r.cc}.${r.a1}`, `${r.cc}.${r.a1}.${r.a2}`]) {
      const best = admCoord.get(k);
      if (!best || r.pop > best.pop) admCoord.set(k, r);
    }
    if (cid(r.cc) && r.pop >= SMALL_POP) {
      for (const [f, historic] of forms) cands.push({ f, c, pop: r.pop, score, code: r.code, short: false, historic, ll: r });
    }
  }
  const cityForms = new Set(cands.map((x) => `${x.f}|${x.c}`));
  for (const a of admins) {
    const level = a.code.split('.').length - 1;
    const kind = `ADM${level}`;
    const c = cid(a.code.slice(0, 2)) ?? a.code.slice(0, 2);
    const pop = admPop.get(a.code) ?? 0;
    const score = pop / DISCOUNT[kind];
    const ll = admCoord.get(a.code) ?? null;
    for (const [f, historic] of formsOf([a.name, a.ascii], a.id)) {
      note(f, c, score);
      // "City of Westminster" -> "Westminster", "Burlington County" -> "Burlington": homonyms only.
      const prefixed = PREFIX.test(f);
      const stripped = prefixed ? f.replace(PREFIX, '') : f.replace(level === 1 ? TYPE1 : TYPE2, '');
      if (stripped !== f && okForm(stripped)) note(stripped, c, score);
      if (!cid(a.code.slice(0, 2))) continue;
      // An admin1 region is always a candidate. An admin2 region is one only at MIN_POP or more.
      // An alternate name of an admin2 region with no type word ("Hennepin" for Hennepin County) is a short form:
      // it is context-only, unless a city of the same country has the form too (the province of Venice).
      const full = level === 1 || f === a.name || f === a.ascii || TYPE2.test(f);
      if (level === 1 || pop >= MIN_POP) {
        cands.push({ f, c, pop: level === 1 ? Math.max(pop, MIN_POP) : pop, score, code: kind, short: !full, historic, ll });
      }
      // "Zamfara State" -> "Zamfara", "Kherson Oblast" -> "Kherson": the short form of an admin1 region.
      // A short form that is a word, a generic word or a given name is no candidate.
      const low = stripped.toLowerCase();
      if (level === 1 && !prefixed && stripped !== f && okForm(stripped) && !isWord(low) && !given.has(stripped) && !stripped.split(/\s+/).every((w) => GENERIC.has(w))) {
        cands.push({ f: stripped, c, pop: Math.max(pop, MIN_POP), score, code: kind, short: true, historic, ll });
      }
    }
  }

  // Natural Earth labels: name -> [{ lat, lon, span, cla }].
  const labels = new Map();
  for (const [file, keys, claKey] of [
    ['ne_10m_geography_regions_points', ['name', 'name_en'], 'featurecla'],
    ['ne_10m_geography_regions_polys', ['NAME', 'NAME_EN'], 'FEATURECLA'],
    ['ne_10m_geography_marine_polys', ['name', 'name_en'], 'featurecla'],
  ]) {
    for (const ft of JSON.parse(await readFile(ne[file], 'utf8')).features) {
      const box = bbox(ft.geometry);
      for (const n of new Set(keys.map((k) => ft.properties[k]?.trim()).filter(Boolean))) {
        labels.set(n, [...(labels.get(n) ?? []), { ...box, cla: ft.properties[claKey] }]);
      }
    }
  }
  const naturalEarthClash = (f, ll) => {
    for (const l of labels.get(f) ?? []) {
      if (NE_EXEMPT.has(l.cla)) continue;
      if (NE_HARD.has(l.cla)) return l.cla;
      if (!ll || km(ll, l) > NE_DIST_KM + (l.span * 111) / 2) return l.cla;
    }
    return null;
  };

  // Selection, best score first. The first candidate of a form that passes all tests owns the form.
  // When a candidate fails, the next candidate of the same form gets a test: the city of Ceuta is too small
  // for its Mexican homonym, but the region of Ceuta is not.
  cands.sort((a, b) => b.score - a.score || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0) || (a.c < b.c ? -1 : a.c > b.c ? 1 : 0));
  const places = new Map();
  const dropped = new Map(); // form -> the reason of the first drop
  const drop = (x, reason) => {
    if (!dropped.has(x.f)) dropped.set(x.f, { reason, text: `${x.f} (${x.c}, ${reason})` });
  };
  for (const x of cands) {
    if (places.has(x.f)) continue;
    if (existing.has(x.f)) { drop(x, 'alias'); continue; }
    if (BLOCK.has(x.f) || TITLE_START.test(x.f) || x.f.split(/\s+/).every((w) => GENERIC.has(w))) { drop(x, 'block'); continue; }
    const cla = naturalEarthClash(x.f, x.ll);
    if (cla) { drop(x, `natural-earth ${cla}`); continue; }
    const others = [...(homonyms.get(x.f) ?? [])].filter(([cc, s]) => cc !== x.c && s >= HOMONYM_POP / 3).map(([, s]) => s);
    if (others.length && Math.max(...others) * RATIO > x.score) { drop(x, 'ambiguous'); continue; }
    const small = x.pop < MIN_POP && !((x.code === 'PPLX' || x.code === 'PPLA2') && x.pop >= SECTION_POP);
    if (small && others.length) { drop(x, 'small-homonym'); continue; }
    const single = !/[\s-]/.test(x.f);
    const risky = single && (isWord(x.f.toLowerCase()) || BRANDS.has(x.f) || given.has(x.f) || surnames.has(x.f));
    let cls;
    if (small || risky || x.historic || (x.short && !cityForms.has(`${x.f}|${x.c}`))) cls = 'context';
    else if (x.pop >= MAJOR_POP || !single) cls = 'major';
    else cls = 'place';
    places.set(x.f, { c: x.c, cls });
  }
  // The forms that no candidate took, by the reason of the first drop.
  const why = {};
  const neDropped = [];
  for (const [f, d] of dropped) {
    if (places.has(f)) continue;
    const reason = d.reason.startsWith('natural-earth') ? 'natural-earth' : d.reason;
    why[reason] = (why[reason] ?? 0) + 1;
    if (reason === 'natural-earth') neDropped.push(d.text.replace('natural-earth ', ''));
  }

  const byCountry = {};
  for (const f of [...places.keys()].sort()) {
    const { c, cls } = places.get(f);
    byCountry[c] ??= { major: [], place: [], context: [] };
    byCountry[c][cls].push(f);
  }
  const givenOut = [...given].filter((g) => okForm(g) && !g.includes(' ') && !existing.has(g)).sort();
  const counts = { forms: places.size, major: 0, place: 0, context: 0, countries: Object.keys(byCountry).length, given: givenOut.length };
  for (const p of places.values()) counts[p.cls]++;
  const meta = { geonames: await lastModified(geo['cities1000.zip']), built: new Date().toISOString().slice(0, 10), counts };

  // Sorted keys and one country per line keep the diff small between runs.
  const lines = Object.keys(byCountry).sort().map((id) => `${JSON.stringify(id)}:${JSON.stringify(byCountry[id])}`);
  const text = `{\n"meta":${JSON.stringify(meta)},\n"given":${JSON.stringify(givenOut)},\n"places":{\n${lines.join(',\n')}\n}\n}\n`;
  await writeFile(OUT, text);
  console.log(`alternate names: ${altRows} English rows`);
  console.log(`candidates: ${cands.length}; dropped: ${JSON.stringify(why)}`);
  console.log(`natural-earth drops (${neDropped.length}): ${neDropped.join(', ')}`);
  console.log(`places: ${JSON.stringify(counts)}, ${Buffer.byteLength(text)} bytes -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
