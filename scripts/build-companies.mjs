// Builds api/_lib/breaking/companies.json: the companies, people, and bank flags of the business family
// of the breaking-news detector (api/_lib/breaking/business.ts).
//
// Output: { v, builtAt, source, block, companies: [{ q, name, names, ambiguous?, country, people, gsib?, sizeUsdBn, links, basis }] }
//   names      the names that a headline can use ("Nvidia", "NVIDIA"). A name that is also a common word is in
//              `ambiguous` too: it counts only with a role word, a legal suffix or a business word near it.
//   country    the country of the headquarters (Wikidata P159), else the country of the company (P17)
//   people     the current CEO (P169) and chair (P488), and the founders (P112) that are alive, with their
//              number of Wikipedia sitelinks. A name alone (with no company) counts only for a famous person.
//   gsib       true for a global systemically important bank (FSB list, in companies-extra.json)
//   block      phrases that hold a company name but do not name the company ("Nikola Tesla")
//
// The rules:
//   - A company stays when it is large (revenue $30bn, market value $50bn, total assets $300bn, or $10bn with
//     60 Wikipedia sitelinks), or listed on a stock exchange with 25 sitelinks, or in companies-extra.json.
//   - Values older than 2018 do not count. A value over $6 trillion is an error in the data and does not count.
//   - A dissolved company, a sports club, a cryptocurrency, an index, an exchange, a central bank, a government
//     agency and an international organization are not companies here.
//   - A name that is a country name, a demonym, a place or a leader in aliases.json is not a company name.
//     A name that two companies of different countries share is dropped from both.
//
// Sources. The script downloads each answer into its own folder in the cache, and reads the files as data only:
//   Wikidata (CC0), from the query service
//   3esl common English words (alt12dicts by Alan Beale, public domain, through SCOWL rel-2020.12.07)
//
// Run: node scripts/build-companies.mjs [--refresh] [--offline] [--cache <dir>]
//   --refresh   send all queries again (a failed query uses the cached copy)
//   --offline   use the cache only, and fail when a file is missing
//   --cache     the cache folder (default .cache/companies)
// Run it each month, after `npm run aliases:breaking`. Read the printed diff (new and removed companies, and
// each change of CEO), then commit the JSON. The server never downloads it.

import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN_ALIASES = join(ROOT, 'api/_lib/breaking/aliases.json');
const IN_EXTRA = join(ROOT, 'scripts/companies-extra.json');
const OUT = join(ROOT, 'api/_lib/breaking/companies.json');
const args = process.argv.slice(2);
const REFRESH = args.includes('--refresh');
const OFFLINE = args.includes('--offline');
const CACHE = resolve(ROOT, args.includes('--cache') ? args[args.indexOf('--cache') + 1] : '.cache/companies');
const USER_AGENT = 'Mozilla/5.0 (compatible; data-build)';
const WIKIDATA = 'https://query.wikidata.org/sparql';
const WORDS_URL = 'https://raw.githubusercontent.com/en-wl/wordlist/rel-2020.12.07/alt12dicts/3esl.txt';

export const LIMITS = {
  revenue: 30e9, // USD
  marketCap: 50e9,
  assets: 300e9,
  famousSize: 10e9, // a company this large with famousLinks sitelinks stays
  famousLinks: 60,
  listedLinks: 25, // a listed company with this many sitelinks stays
  founderLinks: 40, // founders count only for companies with this many sitelinks
  maxValue: 6e12, // a larger value is an error in the data (Aramco 24,580bn, NYSE 28,529bn)
  fromYear: 2018, // older values do not count
};

// USD per unit of a currency (ISO 4217), approximate, late 2025. The limits tolerate a large error.
export const FX = {
  USD: 1, EUR: 1.15, GBP: 1.3, JPY: 0.0066, CNY: 0.14, RMB: 0.14, INR: 0.0113, KRW: 0.00069, CHF: 1.25, CAD: 0.72,
  AUD: 0.65, BRL: 0.18, RUB: 0.012, SEK: 0.105, NOK: 0.099, DKK: 0.154, MXN: 0.054, SAR: 0.267, HKD: 0.128, TWD: 0.032,
  ZAR: 0.057, SGD: 0.77, IDR: 0.00006, TRY: 0.024, THB: 0.03, MYR: 0.24, AED: 0.272, PLN: 0.27, ILS: 0.3, NGN: 0.00068,
  PHP: 0.017, CLP: 0.00105, COP: 0.00026, ARS: 0.0007, QAR: 0.275, KWD: 3.26, VND: 0.000038, EGP: 0.021, PKR: 0.0035,
  CZK: 0.047, HUF: 0.0029, KZT: 0.0019, NZD: 0.58, BDT: 0.0082, MAD: 0.11, KES: 0.0077, OMR: 2.6, BHD: 2.65, RON: 0.23,
};

// Wikidata classes that are not companies here.
export const EXCLUDED_CLASSES = new Set([
  'Q476028', // association football club
  'Q847017', // sports club
  'Q13479982', // cryptocurrency
  'Q223371', // stock market index
  'Q11691', // stock exchange
  'Q66344', // central bank
  'Q327333', // government agency
  'Q484652', // international organization
]);

// Short names that are company names, not tickers.
const SHORT_OK = new Set(['BP', 'GE', 'HP', 'LG', 'EA', '3M', 'SK']);
const ACRONYMS = new Set(['IBM', 'BMW', 'UBS', 'AMD', 'SAP', 'BYD', 'TSMC', 'HSBC', 'LVMH', 'ICBC', 'ONGC', 'TCS', 'MTN', 'BHP', 'JBS', 'AT&T', 'BASF', 'ADNOC', 'PTT', 'LIC', 'SoftBank']);
const SUFFIX = /(?:,?\s+(?:Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|Limited|L\.?L\.?C\.?|plc|PLC|P\.L\.C\.|AG|SE|SA|S\.A\.|N\.V\.|NV|Group|Holdings?|GmbH|S\.p\.A\.|SpA|ASA|AB|Oyj|K\.K\.|Public Company Limited|Co\., Ltd\.?))+$/;

// ---- pure helpers (the tests import them)

/**
 * "Nvidia Corporation" -> "Nvidia", "Toyota Motor Corporation" -> "Toyota Motor". "Merck & Co." -> "Merck" and
 * "Eli Lilly and Company" -> "Eli Lilly": the "&" or "and" before the suffix goes too.
 */
export function stripSuffix(label) {
  let s = label;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(SUFFIX, '').replace(/\s*(?:&|\band)\s*$/, '').trim();
    if (next === s) break;
    s = next;
  }
  return s.length >= 2 ? s : label;
}

/** True for a name that a headline can use: not a ticker, a domain, a QID or a code. `alt`: an alternative label. */
export function okName(name, alt = true) {
  if (typeof name !== 'string') return false;
  const n = name.trim();
  // A capital letter or a digit first, or a brand such as "eBay" or "iQIYI".
  if (!/^(?:[\p{Lu}\p{N}]|\p{Ll}\p{Lu})/u.test(n) || n.length > 40) return false;
  if (/^Q\d+$/.test(n) || /[()/@:]|\.(?:com|net|org|co|io|ai|in|cn|jp|de|uk)\b/i.test(n)) return false;
  if (/^\d[\d\s.,]*[A-Za-z]?$/.test(n)) return false; // "18M", "7203"
  if (n.length < 3 && !SHORT_OK.has(n)) return false;
  if (alt && /^[A-Z]{1,5}$/.test(n) && !ACRONYMS.has(n) && !SHORT_OK.has(n)) return false; // a ticker ("INTC")
  return true;
}

/** An amount in USD, or null when the currency is unknown. */
export function toUsd(amount, currency) {
  const rate = FX[currency];
  return rate === undefined ? null : amount * rate;
}

/**
 * The value of one property of one company: the newest dated value from LIMITS.fromYear on, else the largest
 * undated value. Values with an unknown currency or over LIMITS.maxValue do not count. Returns USD or 0.
 */
export function latestValue(rows, unknown = new Map()) {
  let best = null;
  for (const r of rows) {
    const usd = toUsd(r.amount, r.currency);
    if (usd === null) {
      unknown.set(r.currency || '?', (unknown.get(r.currency || '?') ?? 0) + 1);
      continue;
    }
    if (usd > LIMITS.maxValue) continue;
    const year = r.date ? Number(r.date.slice(0, 4)) : null;
    if (year !== null && year < LIMITS.fromYear) continue;
    const key = r.date ?? '';
    if (!best || key > best.key || (key === best.key && usd > best.usd)) best = { key, usd };
  }
  return best?.usd ?? 0;
}

const fold = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC');

/**
 * Selects and shapes the companies. Pure: all inputs are arguments.
 * input: { candidates: Map<q, {links, revenue, marketCap, assets, listed}>, core: Map<q, {label, links, hq: string[],
 * iso: string[], dissolved}>, classes: Map<q, Set>, alts: Map<q, string[]>, people: Map<q, {name, role}[]>,
 * extra, aliasForms: Set<string>, leaderNames: Set<string>, countries: Set<string>, words: Set<string> }
 */
export function selectCompanies(input) {
  const { candidates, core, classes, alts, people, extra, aliasForms, leaderNames, countries, words } = input;
  const log = [];
  const include = new Set([...Object.keys(extra.include ?? {}), ...Object.keys(extra.gsib ?? {})]);
  const exclude = new Set(Object.keys(extra.exclude ?? {}));
  const block = new Set(extra.block ?? []);
  const extraAmbiguous = new Set(extra.ambiguous ?? []);
  const dropNames = new Set(extra.dropNames ?? []);
  const isWord = (n) => !/\s/.test(n) && (words.has(n.toLowerCase()) || words.has(n));
  const dropped = new Set();
  const out = [];
  for (const [q, cand] of candidates) {
    const c = core.get(q);
    const size = Math.max(cand.revenue ?? 0, cand.marketCap ?? 0);
    const basis = [];
    if ((cand.revenue ?? 0) >= LIMITS.revenue || (cand.marketCap ?? 0) >= LIMITS.marketCap || (cand.assets ?? 0) >= LIMITS.assets) basis.push('size');
    else if (size >= LIMITS.famousSize && (c?.links ?? cand.links ?? 0) >= LIMITS.famousLinks) basis.push('size');
    if (cand.listed && (c?.links ?? cand.links ?? 0) >= LIMITS.listedLinks) basis.push('listed');
    if (include.has(q)) basis.push('extra');
    if (!basis.length) continue;
    if (exclude.has(q)) {
      log.push(`exclude ${q} (companies-extra)`);
      continue;
    }
    if (!c) {
      log.push(`skip ${q}: no details`);
      continue;
    }
    if (c.dissolved && !include.has(q)) {
      log.push(`skip ${q} ${c.label ?? ''}: dissolved`);
      continue;
    }
    const cls = [...(classes.get(q) ?? [])].find((x) => EXCLUDED_CLASSES.has(x));
    if (cls && !include.has(q)) {
      log.push(`skip ${q} ${c.label ?? ''}: class ${cls}`);
      continue;
    }
    const country = pickCountry(c.hq, c.iso, countries);
    if (!country) {
      log.push(`skip ${q} ${c.label ?? ''}: no country`);
      continue;
    }
    const label = c.label && okName(c.label, false) ? c.label : null;
    const names = [];
    const add = (n, alt) => {
      const t = n?.trim();
      if (!t || !okName(t, alt) || names.includes(t)) return;
      if (aliasForms.has(t) || dropNames.has(t)) return;
      // A common word ("News", "Future") names a company only when companies-extra.json lists it as ambiguous.
      if (isWord(t) && !extraAmbiguous.has(t)) {
        dropped.add(t);
        return;
      }
      names.push(t);
    };
    for (const n of extra.names?.[q] ?? []) add(n, false);
    if (label) {
      add(stripSuffix(label), false);
      add(label, false);
    }
    for (const n of alts.get(q) ?? []) {
      add(stripSuffix(n), true);
      add(n, true);
    }
    if (!names.length) {
      log.push(`skip ${q}: no usable name`);
      continue;
    }
    const links = c.links ?? cand.links ?? 0;
    const ppl = [];
    const seen = new Set();
    for (const p of [...(extra.people?.[q] ?? []), ...(people.get(q) ?? [])]) {
      if (p.role === 'founder' && links < LIMITS.founderLinks) continue;
      if (!/^\S+(?:\s+\S+)+$/.test(p.name) || /^Q\d+$/.test(p.name)) continue;
      if (leaderNames.has(p.name) || leaderNames.has(fold(p.name))) continue;
      if (seen.has(p.name)) continue;
      seen.add(p.name);
      ppl.push({ name: p.name, role: p.role, links: p.links ?? 0 });
    }
    // The CEO first, then the chair, then the founders.
    const order = { ceo: 0, chair: 1, founder: 2 };
    ppl.sort((a, b) => order[a.role] - order[b.role] || (a.name < b.name ? -1 : 1));
    const entry = {
      q,
      name: names[0],
      names,
      country,
      people: ppl,
      sizeUsdBn: Math.round(size / 1e9),
      links,
      basis: basis.join('|'),
    };
    const amb = names.filter((n) => extraAmbiguous.has(n));
    if (amb.length) entry.ambiguous = amb;
    if (extra.gsib?.[q]) entry.gsib = true;
    out.push(entry);
  }

  // A name of two companies: the same country keeps it for the larger company; else both lose it.
  // A curated name (companies-extra.json "names") wins: only that company keeps it.
  const byName = new Map();
  for (const c of out) for (const n of c.names) byName.set(n, [...(byName.get(n) ?? []), c]);
  const rank = (a, b) => b.sizeUsdBn - a.sizeUsdBn || b.links - a.links || (a.q < b.q ? -1 : 1);
  for (const [n, list] of byName) {
    if (list.length < 2) continue;
    const curated = list.filter((c) => (extra.names?.[c.q] ?? []).includes(n));
    const sorted = [...list].sort((a, b) => Number(curated.includes(b)) - Number(curated.includes(a)) || rank(a, b));
    const sameCountry = sorted.every((c) => c.country === sorted[0].country);
    // Another country: the first company keeps the name only when it has twice the sitelinks of each other one.
    const dominant = curated.length === 1 || sorted.slice(1).every((c) => sorted[0].links >= 2 * c.links);
    const losers = sameCountry || dominant ? sorted.slice(1) : sorted;
    for (const c of losers) {
      c.names = c.names.filter((x) => x !== n);
      if (c.ambiguous) c.ambiguous = c.ambiguous.filter((x) => x !== n);
    }
    log.push(`shared name "${n}": ${sameCountry || dominant ? `kept for ${sorted[0].q}` : 'dropped'} (${sorted.map((c) => c.q).join(', ')})`);
  }
  // A person at several companies stays with the larger company only.
  const byPerson = new Map();
  for (const c of out) for (const p of c.people) byPerson.set(p.name, [...(byPerson.get(p.name) ?? []), c]);
  for (const [n, list] of byPerson) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(rank);
    for (const c of sorted.slice(1)) c.people = c.people.filter((p) => p.name !== n);
  }
  if (dropped.size) log.push(`common words that are not company names: ${[...dropped].sort().join(', ')}`);
  const kept = out.filter((c) => {
    if (!c.names.length) log.push(`drop ${c.q}: all names shared`);
    if (c.ambiguous && !c.ambiguous.length) delete c.ambiguous;
    if (c.name !== c.names[0] && c.names.length) c.name = c.names[0];
    return c.names.length > 0;
  });
  kept.sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.q < b.q ? -1 : 1));
  return { companies: kept, block: [...block].sort(), log, missing: missingCompanies(kept, extra) };
}

/**
 * The must-have companies (companies-extra.json "mustHave": QID -> a name that a headline uses) that the
 * output does not have, or that lost that name. The build fails when the list is not empty.
 */
export function missingCompanies(companies, extra) {
  const byQ = new Map(companies.map((c) => [c.q, c]));
  return Object.entries(extra.mustHave ?? {})
    .filter(([q, name]) => !byQ.get(q)?.names.includes(name))
    .map(([q, name]) => `${q} ${name}`);
}

/** The country: the most frequent headquarters country, else the most frequent company country. */
export function pickCountry(hq = [], iso = [], countries = null) {
  const best = (list) => {
    const count = new Map();
    for (const x of list) {
      const id = x === 'XKX' ? 'X-kosovo' : x;
      if (countries && !countries.has(id)) continue;
      count.set(id, (count.get(id) ?? 0) + 1);
    }
    return [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
  };
  return best(hq) ?? best(iso);
}

/** The lines of the diff against the old file: new and removed companies, and each change of CEO. */
export function diffCompanies(old, next) {
  const lines = [];
  const before = new Map((old?.companies ?? []).map((c) => [c.q, c]));
  const after = new Map(next.companies.map((c) => [c.q, c]));
  for (const [q, c] of after) if (!before.has(q)) lines.push(`+ ${q} ${c.name} (${c.country})`);
  for (const [q, c] of before) if (!after.has(q)) lines.push(`- ${q} ${c.name} (${c.country})`);
  const ceo = (c) => c.people.filter((p) => p.role === 'ceo').map((p) => p.name).join(', ') || '-';
  for (const [q, c] of after) {
    const o = before.get(q);
    if (o && ceo(o) !== ceo(c)) lines.push(`~ ${q} ${c.name}: CEO ${ceo(o)} -> ${ceo(c)}`);
  }
  return lines;
}

/** The JSON text: one company per line, so that a rebuild gives a small diff. */
export function formatCompanies(data) {
  const head = { v: data.v, builtAt: data.builtAt, source: data.source };
  const lines = [
    '{',
    ...Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    `  "block": ${JSON.stringify(data.block)},`,
    '  "companies": [',
    data.companies.map((c) => `    ${JSON.stringify(c)}`).join(',\n'),
    '  ]',
    '}',
  ];
  return `${lines.join('\n')}\n`;
}

// ---- downloads and the cache

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function download(dir, name, url) {
  const folder = join(CACHE, dir);
  const path = join(folder, name);
  if (existsSync(path) && !REFRESH) return path;
  if (OFFLINE) throw new Error(`--offline: ${path} is missing`);
  await mkdir(folder, { recursive: true });
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await writeFile(`${path}.part`, await res.text());
  await rename(`${path}.part`, path);
  return path;
}

/**
 * The rows of a SPARQL TSV answer, or null when the answer is not complete. On a timeout, the query service
 * can send HTTP 200 with part of the rows and then a Java stack trace. So each row must have one valid cell
 * for each column. A row is an object of { value } cells, keyed by the variable name without "?".
 */
export function parseTsv(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!lines.length || !lines[0].startsWith('?')) return null;
  const head = lines[0].split('\t').map((h) => h.trim().replace(/^\?/, ''));
  const CELL = /^(?:<([^>]*)>|"((?:[^"\\]|\\.)*)"(?:@[\w-]+|\^\^<[^>]+>)?|(-?[\d.]+(?:[eE][+-]?\d+)?)|(true|false))$/;
  const rows = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    if (cells.length !== head.length) return null;
    const row = {};
    for (let i = 0; i < head.length; i++) {
      if (cells[i] === '') continue;
      const m = CELL.exec(cells[i]);
      if (!m) return null;
      const value = m[1] ?? (m[2] !== undefined ? m[2].replace(/\\(.)/g, (_, ch) => ({ t: '\t', n: '\n', r: '\r' })[ch] ?? ch) : m[3] ?? m[4]);
      row[head[i]] = { value };
    }
    rows.push(row);
  }
  return rows;
}

/** One query of the Wikidata query service, as SPARQL TSV in the cache. A failed query uses the cached copy. */
async function sparql(dir, name, query) {
  const folder = join(CACHE, dir);
  const path = join(folder, `${name}.tsv`);
  const cached = existsSync(path) ? parseTsv(await readFile(path, 'utf8')) : null;
  if (existsSync(path) && !cached) console.warn(`wikidata ${name}: the cached copy is not complete`);
  if (cached && !REFRESH) return cached;
  if (OFFLINE) throw new Error(`--offline: ${path} is missing`);
  await mkdir(folder, { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(WIKIDATA, {
        method: 'POST',
        headers: { accept: 'text/tab-separated-values', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
        body: `query=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseTsv(text);
      if (!rows) throw new Error('not a complete TSV answer (the query timed out?)');
      await writeFile(`${path}.part`, text);
      await rename(`${path}.part`, path);
      console.log(`wikidata ${name}: ${rows.length} rows`);
      await sleep(1_000);
      return rows;
    } catch (err) {
      console.warn(`wikidata ${name}: attempt ${attempt} failed (${err.message})`);
      if (attempt < 3) await sleep(5_000 * attempt);
    }
  }
  if (cached) {
    console.warn(`wikidata ${name}: use the cached copy`);
    return cached;
  }
  throw new Error(`wikidata ${name}: the query failed and no cached copy exists`);
}

const qid = (b) => b?.value?.split('/').pop();
// Country items with no ISO 3166 code (P298) in Wikidata.
const COUNTRY_QID = { Q55: 'NLD', Q29999: 'NLD', Q756617: 'DNK' };
const val = (b) => b?.value;

function hashOf(list) {
  let h = 0x811c9dc5;
  for (const ch of list.join(',')) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

const sizeQuery = (prop, min, links) => `SELECT ?c ?n ?amt ?unit ?date WHERE {
  ?c p:${prop} ?st . ?st psv:${prop} ?v . ?v wikibase:quantityAmount ?amt . FILTER(?amt > ${min})
  ?v wikibase:quantityUnit ?unit .
  OPTIONAL { ?st pq:P585 ?date }
  ?c wikibase:sitelinks ?n . FILTER(?n >= ${links})
}`;
const unitQuery = (units) => `SELECT ?unit ?cur WHERE { VALUES ?unit { ${values(units)} } ?unit wdt:P498 ?cur }`;

const LISTED_QUERY = `SELECT DISTINCT ?c ?n WHERE { ?c wdt:P414 ?ex ; wikibase:sitelinks ?n . FILTER(?n >= ${LIMITS.listedLinks}) FILTER NOT EXISTS { ?c wdt:P576 ?d } }`;

const values = (qs) => qs.map((q) => `wd:${q}`).join(' ');
// Many items now have a "mul" (default for all languages) label and no "en" label.
const coreQuery = (qs) => `SELECT ?c ?n ?label ?mul ?hqc ?hqiso ?cc ?iso ?dis WHERE {
  VALUES ?c { ${values(qs)} }
  ?c wikibase:sitelinks ?n .
  OPTIONAL { ?c rdfs:label ?label FILTER(LANG(?label) = "en") }
  OPTIONAL { ?c rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
  OPTIONAL { ?c wdt:P159 ?hq . ?hq wdt:P17 ?hqc . OPTIONAL { ?hqc wdt:P298 ?hqiso } }
  OPTIONAL { ?c wdt:P17 ?cc . OPTIONAL { ?cc wdt:P298 ?iso } }
  OPTIONAL { ?c wdt:P576 ?dis }
}`;
const classQuery = (qs) => `SELECT ?c ?cls WHERE { VALUES ?c { ${values(qs)} } ?c wdt:P31 ?cls }`;
const altQuery = (qs) => `SELECT ?c ?alt WHERE { VALUES ?c { ${values(qs)} } ?c skos:altLabel ?alt FILTER(LANG(?alt) IN ("en", "mul")) }`;
// The current holder of a role: the truthy (best rank) value with no end date, a human who is alive.
const peopleQuery = (qs, prop) => `SELECT ?c ?pl ?pn WHERE {
  VALUES ?c { ${values(qs)} }
  ?c wdt:${prop} ?p .
  ?p wikibase:sitelinks ?pn .
  FILTER NOT EXISTS { ?c p:${prop} ?s . ?s ps:${prop} ?p ; pq:P582 ?end }
  ?p wdt:P31 wd:Q5 .
  FILTER NOT EXISTS { ?p wdt:P570 ?died }
  OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?p rdfs:label ?mul FILTER(LANG(?mul) = "mul") }
  BIND(COALESCE(?en, ?mul) AS ?pl) FILTER(BOUND(?pl))
}`;
const ROLES = [['ceo', 'P169'], ['chair', 'P488'], ['founder', 'P112']];

async function main() {
  const aliases = JSON.parse(await readFile(IN_ALIASES, 'utf8'));
  const extra = JSON.parse(await readFile(IN_EXTRA, 'utf8'));
  const countries = new Set(Object.keys(aliases));
  const aliasForms = new Set();
  const leaderNames = new Set();
  for (const a of Object.values(aliases)) {
    for (const n of [...a.names, ...a.demonyms, ...a.places]) aliasForms.add(n);
    for (const l of a.leaders) {
      aliasForms.add(l.name);
      leaderNames.add(l.name);
      leaderNames.add(fold(l.name));
    }
  }
  const words = new Set((await readFile(await download('words', '3esl.txt', WORDS_URL), 'utf8')).split(/\r?\n/).map((w) => w.trim()).filter(Boolean));

  // 1. The candidates: large companies and listed companies.
  const candidates = new Map();
  const cand = (q, links) => {
    if (!candidates.has(q)) candidates.set(q, { links, revenue: 0, marketCap: 0, assets: 0, listed: false });
    return candidates.get(q);
  };
  const unknown = new Map();
  const sizeRows = [];
  for (const [field, prop, min, links] of [
    ['revenue', 'P2139', 2e10, 15],
    ['marketCap', 'P2226', 2e10, 15],
    ['assets', 'P2403', 3e11, 30],
  ]) {
    sizeRows.push([field, await sparql('size', prop, sizeQuery(prop, min, links))]);
  }
  // The ISO 4217 code of each unit of the values.
  const units = [...new Set(sizeRows.flatMap(([, rows]) => rows.map((r) => qid(r.unit))).filter((u) => /^Q\d+$/.test(u ?? '')))].sort();
  const currency = new Map((await sparql('size', `units-${hashOf(units)}`, unitQuery(units))).map((r) => [qid(r.unit), val(r.cur)]));
  for (const [field, rows] of sizeRows) {
    const byCo = new Map();
    for (const r of rows) {
      const q = qid(r.c);
      const cur = currency.get(qid(r.unit)) ?? `unit ${qid(r.unit)}`;
      byCo.set(q, [...(byCo.get(q) ?? []), { amount: Number(val(r.amt)), currency: cur, date: val(r.date) ?? null, links: Number(val(r.n)) }]);
    }
    for (const [q, list] of byCo) {
      const usd = latestValue(list, unknown);
      if (usd > 0) cand(q, list[0].links)[field] = usd;
    }
  }
  for (const r of await sparql('listed', 'listed', LISTED_QUERY)) cand(qid(r.c), Number(val(r.n))).listed = true;
  for (const q of [...Object.keys(extra.include ?? {}), ...Object.keys(extra.gsib ?? {})]) cand(q, 0);
  if (unknown.size) console.log(`values with an unknown currency (not counted): ${[...unknown].map(([k, n]) => `${k}:${n}`).join(' ')}`);

  // Only the candidates that pass a size, listing or include rule need details.
  const include = new Set([...Object.keys(extra.include ?? {}), ...Object.keys(extra.gsib ?? {})]);
  const wanted = [...candidates]
    .filter(([q, c]) =>
      include.has(q) ||
      c.revenue >= LIMITS.revenue || c.marketCap >= LIMITS.marketCap || c.assets >= LIMITS.assets ||
      (Math.max(c.revenue, c.marketCap) >= LIMITS.famousSize && c.links >= LIMITS.famousLinks) ||
      (c.listed && c.links >= LIMITS.listedLinks))
    .map(([q]) => q)
    .sort();
  console.log(`candidates: ${candidates.size}, with details: ${wanted.length}`);

  // 2. The details, in batches of 200.
  const core = new Map();
  const classes = new Map();
  const alts = new Map();
  const people = new Map();
  for (let i = 0; i < wanted.length; i += 200) {
    const batch = wanted.slice(i, i + 200);
    const tag = hashOf(batch);
    for (const r of await sparql('core', `core-${tag}`, coreQuery(batch))) {
      const q = qid(r.c);
      const c = core.get(q) ?? { label: null, links: Number(val(r.n)), hq: [], iso: [], dissolved: false };
      if (val(r.label)) c.label = val(r.label);
      else if (val(r.mul) && !c.label) c.label = val(r.mul);
      const hq = val(r.hqiso) ?? COUNTRY_QID[qid(r.hqc)];
      const iso = val(r.iso) ?? COUNTRY_QID[qid(r.cc)];
      if (hq) c.hq.push(hq);
      if (iso) c.iso.push(iso);
      if (r.dis) c.dissolved = true;
      core.set(q, c);
    }
    for (const r of await sparql('classes', `classes-${tag}`, classQuery(batch))) {
      const q = qid(r.c);
      classes.set(q, new Set([...(classes.get(q) ?? []), qid(r.cls)]));
    }
    for (const r of await sparql('alts', `alts-${tag}`, altQuery(batch))) {
      const q = qid(r.c);
      alts.set(q, [...(alts.get(q) ?? []), val(r.alt)]);
    }
    for (const [role, prop] of ROLES) {
      for (const r of await sparql('people', `${role}-${tag}`, peopleQuery(batch, prop))) {
        const q = qid(r.c);
        people.set(q, [...(people.get(q) ?? []), { name: val(r.pl), role, links: Number(val(r.pn)) }]);
      }
    }
  }

  // 3. Select, write, and print the diff.
  const { companies, block, log, missing } = selectCompanies({ candidates, core, classes, alts, people, extra, aliasForms, leaderNames, countries, words });
  for (const line of log) console.log(`  ${line}`);
  // Stop before the write: a missing top company is a gap that a headline would show.
  if (missing.length) throw new Error(`must-have companies missing (add them to companies-extra.json "include" or "names"): ${missing.join('; ')}`);
  const data = {
    v: 1,
    builtAt: new Date().toISOString().slice(0, 10),
    source: 'Wikidata (CC0) via scripts/build-companies.mjs; scripts/companies-extra.json',
    block,
    companies,
  };
  let old = null;
  try {
    old = JSON.parse(await readFile(OUT, 'utf8'));
  } catch {
    // No old file: every company is new.
  }
  const diff = diffCompanies(old, data);
  console.log(`\n== diff (${diff.length} lines): read it before you commit`);
  for (const line of diff) console.log(line);
  const text = formatCompanies(data);
  await writeFile(OUT, text);
  const countriesUsed = new Set(companies.map((c) => c.country));
  console.log(`\nwrote ${OUT}: ${companies.length} companies in ${countriesUsed.size} countries, ${companies.reduce((n, c) => n + c.people.length, 0)} people, ${text.length} bytes`);
}

// Run only as a script, not when a test imports the helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
