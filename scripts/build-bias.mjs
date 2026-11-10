// Builds the publisher rating tables for the news panel.
//
// Outputs:
//   api/_lib/generated/mbfc.json  MBFC lean per host. NOT in git: MBFC does not allow redistribution.
//                                 Written only when RAPIDAPI_KEY is set.
//   api/_lib/state-media.json     State Media Monitor tag per host (CC BY 4.0). In git.
//
// Sources:
//   - Media Bias/Fact Check through its official RapidAPI product (free Basic plan: 3 requests a month).
//   - State Media Monitor Global Dataset 2026 (Zenodo, CC BY 4.0) and the hand map
//     scripts/bias-smm-domains.json (smm_id -> hosts), because the dataset has no domain column.
//
// Run: npm run bias
//   --smm            Also rebuild state-media.json from the Zenodo CSV.
//   --smm-csv <file> Use a local copy of the CSV (implies --smm).
//   --force          Fetch MBFC even when the table is younger than 25 days.
//   --input <file>   Build the MBFC table from a local JSON file in the RapidAPI shape. For tests.
//   --quiet          Print only warnings and the result of a fetch.
//
// The script is safe with no key: it does nothing and exits 0. It never prints the key.
// When a fetch fails, it keeps the old table and exits 0.
// On Vercel it fetches only for a production build, and it keeps the last good table in
// node_modules/.cache/worldly, which Vercel keeps between builds.

import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_MBFC = join(ROOT, 'api/_lib/generated/mbfc.json');
const OUT_STATE = join(ROOT, 'api/_lib/state-media.json');
const RULES = join(ROOT, 'api/_lib/bias-rules.json');
const SMM_MAP = join(ROOT, 'scripts/bias-smm-domains.json');
const CACHE_DIR = join(ROOT, 'node_modules/.cache/worldly');
const CACHE_MBFC = join(CACHE_DIR, 'mbfc.json');
const CACHE_META = join(CACHE_DIR, 'mbfc-meta.json');

const RAPID_HOST = 'media-bias-fact-check-ratings-api2.p.rapidapi.com';
const RAPID_URL = `https://${RAPID_HOST}/fetch-data`;
const SMM_URL = 'https://zenodo.org/api/records/23863495/files/SMM_Global_Dataset_2026.csv/content';
const SMM_CITATION =
  'Dragomir, M. (2026). State Media Monitor Global Dataset 2026 (Version 2026.1) [Data set]. Media and Journalism Research Center (MJRC). https://doi.org/10.5281/zenodo.23863495, CC BY 4.0. Worldly added domain names.';
const MAX_AGE_DAYS = 25;
const RETRY_AFTER_H = 24;
const FETCH_TIMEOUT_MS = 60_000;
const MIN_RECORDS = 100;
const USER_AGENT = 'Mozilla/5.0 (compatible; WorldlyBiasBuild/1.0)';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const QUIET = flag('quiet');
const log = (...m) => {
  if (!QUIET) console.log('[bias]', ...m);
};
const warn = (...m) => console.warn('[bias]', ...m);

// ---------- small helpers ----------

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
}

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

/** Reads one key from .env without a dependency. Returns undefined when absent. */
async function envFileValue(name) {
  let text;
  try {
    text = await readFile(join(ROOT, '.env'), 'utf8');
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1] !== name) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v || undefined;
  }
  return undefined;
}

const fold = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** "https://www.CBSNews.com/atlanta/" -> {host: "cbsnews.com", path: "/atlanta"}. Null for no host. */
export function splitSourceUrl(input) {
  if (typeof input !== 'string' || !input.trim()) return null;
  let raw = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  while (/^(?:www|m|amp|mobile)\./.test(host)) host = host.replace(/^(?:www|m|amp|mobile)\./, '');
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(host)) return null;
  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  return { host, path };
}

// MBFC bias values -> lean. The live value set of the API is not known, so the map is tolerant:
// case, "bias", punctuation and word order do not matter. A value that is not here gives no lean and a warning.
const LEAN_WORDS = new Map([
  ['left', -2],
  ['extreme left', -2],
  ['far left', -2],
  ['left center', -1],
  ['center left', -1],
  ['left centre', -1],
  ['centre left', -1],
  ['lean left', -1],
  ['least biased', 0],
  ['least', 0],
  ['center', 0],
  ['centre', 0],
  ['neutral', 0],
  ['right center', 1],
  ['center right', 1],
  ['right centre', 1],
  ['centre right', 1],
  ['lean right', 1],
  ['right', 2],
  ['extreme right', 2],
  ['far right', 2],
]);
// Known values with no lean on the scale.
const NO_LEAN = new Set([
  'questionable', 'questionable source', 'questionable sources', 'fake news', 'conspiracy pseudoscience', 'conspiracy',
  'pseudoscience', 'pro science', 'satire', 'propaganda',
]);

/** Maps an MBFC "Bias" value to -2..2, null (no lean) or undefined (unknown value). */
export function mapLean(value) {
  if (typeof value !== 'string') return undefined;
  // "Left-Center Bias" -> "left center"; "Least Biased" stays "least biased".
  const key = fold(value)
    .replace(/[^a-z]+/g, ' ')
    .replace(/\bbias\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!key) return undefined;
  if (LEAN_WORDS.has(key)) return LEAN_WORDS.get(key);
  if (NO_LEAN.has(key)) return null;
  // "Right Questionable", "Left-Center (Questionable)": take the lean part when it is the whole start.
  for (const [words, lean] of [...LEAN_WORDS].sort((a, b) => b[0].length - a[0].length)) {
    if (key.startsWith(`${words} `) && NO_LEAN.has(key.slice(words.length + 1))) return lean;
  }
  return undefined;
}

/** The MBFC page slug from the "MBFC URL" field: "https://mediabiasfactcheck.com/the-guardian/" -> "the-guardian". */
export function mbfcSlug(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    if (!/(^|\.)mediabiasfactcheck\.com$/i.test(url.hostname)) return '';
    return decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));
  } catch {
    return '';
  }
}

const field = (r, ...names) => {
  for (const n of names) if (r && r[n] !== undefined && r[n] !== null && r[n] !== '') return r[n];
  return undefined;
};

/**
 * Builds the compact MBFC table from API records.
 * - Hosts on the deny list (aggregators, platforms) are dropped.
 * - A record whose Source URL has a path ("cbsnews.com/atlanta") is dropped, unless the host has no
 *   bare record and all its path records agree on the lean.
 * - bias-rules.json "pathRecords" maps a host to one path record ("www3.nhk.or.jp" -> NHK World).
 * Returns {table, stats, unknown}.
 */
export function buildMbfcTable(records, rules, now = new Date()) {
  const deny = new Set(rules.deny ?? []);
  const unknown = new Map();
  const byHost = new Map();
  const byFull = new Map();
  let skipped = 0;
  for (const r of records) {
    const parts = splitSourceUrl(field(r, 'Source URL', 'source_url', 'Source Url', 'url', 'domain'));
    const name = String(field(r, 'Source', 'source', 'name') ?? '').trim().slice(0, 120);
    const biasValue = field(r, 'Bias', 'bias');
    if (!parts || !name) {
      skipped += 1;
      continue;
    }
    let lean = mapLean(biasValue);
    if (lean === undefined) {
      const k = String(biasValue ?? '(empty)').slice(0, 60);
      unknown.set(k, (unknown.get(k) ?? 0) + 1);
      lean = null;
    }
    const rec = { name, lean, slug: mbfcSlug(field(r, 'MBFC URL', 'mbfc_url', 'MBFC Url', 'mbfc url')), path: parts.path };
    byFull.set(`${parts.host}${parts.path}`, rec);
    if (deny.has(parts.host)) continue;
    if (!byHost.has(parts.host)) byHost.set(parts.host, []);
    byHost.get(parts.host).push(rec);
  }

  const hosts = {};
  let droppedPath = 0;
  for (const [host, recs] of byHost) {
    const bare = recs.filter((x) => x.path === '');
    let pick = null;
    if (bare.length > 0) {
      pick = bare[0];
      droppedPath += recs.length - bare.length;
    } else if (recs.every((x) => x.lean === recs[0].lean)) {
      pick = recs[0];
    } else {
      droppedPath += recs.length;
    }
    if (pick) hosts[host] = [pick.name, pick.lean, pick.slug];
  }
  for (const [host, full] of Object.entries(rules.pathRecords ?? {})) {
    const rec = byFull.get(full);
    if (rec) hosts[host] = [rec.name, rec.lean, rec.slug];
  }
  const sorted = Object.fromEntries(Object.entries(hosts).sort(([a], [b]) => (a < b ? -1 : 1)));
  const withLean = Object.values(sorted).filter((t) => t[1] !== null).length;
  return {
    table: { v: 1, generatedAt: now.toISOString(), hosts: sorted },
    stats: { records: records.length, hosts: Object.keys(sorted).length, withLean, droppedPath, skipped },
    unknown,
  };
}

// ---------- State Media Monitor ----------

/** A small CSV parser: quoted fields, doubled quotes and new lines in quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ''));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ''), r[i] ?? ''])));
}

const SMM_CODES = new Set(['SC', 'CaPu', 'CaPr', 'IP', 'ISF', 'ISFM', 'ISM']);

/** Joins the active SMM rows with the hand map. Returns {table, warnings}. */
export function buildStateTable(rows, map, now = new Date()) {
  const byId = new Map(rows.map((r) => [r.smm_id, r]));
  const hosts = {};
  const warnings = [];
  for (const [id, list] of Object.entries(map)) {
    if (id.startsWith('_')) continue;
    const row = byId.get(id);
    if (!row) {
      warnings.push(`${id}: not in the dataset`);
      continue;
    }
    if (row.status_2026 !== 'Active') {
      warnings.push(`${id}: status ${row.status_2026 || 'unknown'}`);
      continue;
    }
    const code = row.class_2026;
    if (!SMM_CODES.has(code)) {
      warnings.push(`${id}: unknown class ${code}`);
      continue;
    }
    for (const host of list) hosts[host.toLowerCase()] = [code, id, row.entity, row.iso3];
  }
  const sorted = Object.fromEntries(Object.entries(hosts).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    table: {
      source: 'State Media Monitor Global Dataset 2026',
      citation: SMM_CITATION,
      licence: 'CC BY 4.0',
      generatedAt: now.toISOString(),
      hosts: sorted,
    },
    warnings,
  };
}

async function buildState() {
  const csvPath = option('smm-csv');
  let text;
  if (csvPath) text = await readFile(csvPath, 'utf8');
  else {
    log('fetch the State Media Monitor CSV');
    const res = await fetch(SMM_URL, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`State Media Monitor CSV: http ${res.status}`);
    text = await res.text();
  }
  const map = JSON.parse(await readFile(SMM_MAP, 'utf8'));
  const { table, warnings } = buildStateTable(parseCsv(text), map);
  for (const w of warnings) warn(`state media: ${w}`);
  await writeAtomic(OUT_STATE, `${JSON.stringify(table, null, 1)}\n`);
  console.log(`[bias] state media: ${Object.keys(table.hosts).length} hosts written to api/_lib/state-media.json`);
}

// ---------- MBFC ----------

async function tableAgeDays(path) {
  const t = await readJson(path);
  const at = t && Date.parse(t.generatedAt);
  return at ? (Date.now() - at) / 86_400_000 : null;
}

async function saveMbfc(table) {
  const text = `${JSON.stringify(table)}\n`;
  await writeAtomic(OUT_MBFC, text);
  try {
    await writeAtomic(CACHE_MBFC, text);
  } catch {
    // No node_modules (unusual). The table in api/_lib/generated is enough.
  }
}

async function fetchMbfc(key) {
  const res = await fetch(RAPID_URL, {
    headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': RAPID_HOST, 'user-agent': USER_AGENT, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new Error(`http ${res.status}`);
  }
  const data = await res.json();
  const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.results) ? data.results : null;
  if (!list) throw new Error('unexpected response shape');
  return list;
}

async function buildMbfc(records, source) {
  const rules = JSON.parse(await readFile(RULES, 'utf8'));
  const { table, stats, unknown } = buildMbfcTable(records, rules);
  for (const [value, n] of unknown) warn(`MBFC: unknown bias value "${value}" (${n} records): no lean`);
  if (stats.hosts < MIN_RECORDS) throw new Error(`only ${stats.hosts} hosts`);
  await saveMbfc(table);
  console.log(
    `[bias] MBFC (${source}): ${stats.records} records -> ${stats.hosts} hosts, ${stats.withLean} with a lean, ${stats.droppedPath} path records dropped`,
  );
}

async function mbfc() {
  // A fresh checkout (or a Vercel build) has no table. Restore the last good one from the cache.
  if (!(await exists(OUT_MBFC)) && (await exists(CACHE_MBFC))) {
    await mkdir(dirname(OUT_MBFC), { recursive: true });
    await copyFile(CACHE_MBFC, OUT_MBFC);
    log('MBFC: restored the table from node_modules/.cache/worldly');
  }

  const input = option('input');
  if (input) {
    const data = JSON.parse(await readFile(input, 'utf8'));
    await buildMbfc(Array.isArray(data) ? data : data.data ?? [], 'local file');
    return;
  }

  const key = (process.env.RAPIDAPI_KEY ?? '').trim() || (await envFileValue('RAPIDAPI_KEY'));
  const age = await tableAgeDays(OUT_MBFC);
  if (!key) {
    if (age === null) log('MBFC: no RAPIDAPI_KEY and no table. The lean stays hidden; state media tags still work.');
    return;
  }
  if (process.env.VERCEL && process.env.VERCEL_ENV !== 'production') {
    log(`MBFC: ${process.env.VERCEL_ENV ?? 'unknown'} build, no fetch (production builds only).`);
    return;
  }
  if (age !== null && age < MAX_AGE_DAYS && !flag('force')) {
    log(`MBFC: table is ${age.toFixed(1)} days old (refresh after ${MAX_AGE_DAYS}).`);
    return;
  }
  const meta = (await readJson(CACHE_META)) ?? {};
  const lastAttempt = Date.parse(meta.lastAttempt ?? '');
  if (lastAttempt && Date.now() - lastAttempt < RETRY_AFTER_H * 3_600_000 && !flag('force')) {
    warn(`MBFC: the last fetch was less than ${RETRY_AFTER_H} h ago; no new fetch. Table age: ${age === null ? 'no table' : `${age.toFixed(1)} days`}.`);
    return;
  }
  try {
    await writeAtomic(CACHE_META, JSON.stringify({ lastAttempt: new Date().toISOString() }));
  } catch {
    // No cache folder. Continue.
  }
  console.log('[bias] MBFC: fetch from RapidAPI (this can take 20 s)');
  try {
    await buildMbfc(await fetchMbfc(key), 'RapidAPI');
  } catch (err) {
    // Never print the key or the response body.
    const reason = err instanceof Error ? err.message : 'error';
    warn(`MBFC: fetch failed (${reason}). Kept the old table. Table age: ${age === null ? 'no table' : `${age.toFixed(1)} days`}.`);
  }
}

async function main() {
  try {
    if (flag('smm') || option('smm-csv') || !(await exists(OUT_STATE))) await buildState();
  } catch (err) {
    warn(`state media: ${err instanceof Error ? err.message : 'error'}. Kept the old table.`);
  }
  try {
    await mbfc();
  } catch (err) {
    warn(`MBFC: ${err instanceof Error ? err.message : 'error'}. Kept the old table.`);
  }
}

// Run only as a script, not when a test imports the helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
