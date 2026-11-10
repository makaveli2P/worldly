#!/usr/bin/env node
// Audit harness for GET /api/news. Runs N countries and prints quality metrics per country,
// so a before/after comparison of the ranking is one command.
//
//   node scripts/audit-news.mjs [--base http://localhost:5173] [--countries USA,GBR,...]
//                               [--out audit.json] [--from audit.json] [--no-ref] [--delay 1200]
//
// --from re-scores a saved run without any network call (no NewsData credits).
// The reference ("ref") is Google News' own ranking for the country: the NATION topic of the
// country's edition (top 10 items), plus a search for the country name in the last 24 h.
// "ref@10" = how many of our stories match one of Google's top-10 national stories.
// "refX@10" = the same, but a shared capitalised name (4+ letters) also counts. Use it for
//   countries with no English edition, where English titles cannot match native titles word by word.
// "cov" = for each story, the number of distinct outlets in the reference pool with the same story.
// "native" = stories with a language tag (a native-language title).
//
// Before/after on one reference: run once with --out before.json, change the code, run with
// --out after.json, then score both with --from <file> --ref before.json.
//
// The EDITIONS table covers only the audit countries. Keep it in step with api/_lib/editions.ts
// (English edition first, else the native edition).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const ROOT = args.root ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = args.base ?? 'http://localhost:5173';
const DEFAULT = 'USA,GBR,IND,DEU,FRA,BRA,NGA,JPN,CHN,RUS,UKR,ISR,MEX,IDN,FJI';
const IDS = String(args.countries ?? DEFAULT).split(',').map((s) => s.trim()).filter(Boolean);
const DELAY = Number(args.delay ?? 1200);
const UA = 'Mozilla/5.0 (compatible; news-audit)';

const FACTS = JSON.parse(readFileSync(join(ROOT, 'public/data/countries.json'), 'utf8'));

// Google News editions: [hl, gl, ceid]. A country without an entry has no national feed.
const EDITIONS = {
  US: ['en-US', 'US', 'US:en'], GB: ['en-GB', 'GB', 'GB:en'], IN: ['en-IN', 'IN', 'IN:en'], NG: ['en-NG', 'NG', 'NG:en'],
  IL: ['en-IL', 'IL', 'IL:en'], DE: ['de', 'DE', 'DE:de'], FR: ['fr', 'FR', 'FR:fr'], BR: ['pt-BR', 'BR', 'BR:pt-419'],
  JP: ['ja', 'JP', 'JP:ja'], CN: ['zh-CN', 'CN', 'CN:zh-Hans'], RU: ['ru', 'RU', 'RU:ru'], UA: ['uk', 'UA', 'UA:uk'],
  MX: ['es-419', 'MX', 'MX:es-419'], ID: ['en-ID', 'ID', 'ID:en'],
};
// Demonyms (English and the edition language) for the title-relevance check.
const DEMONYMS = {
  USA: ['american', 'u.s.', 'us'], GBR: ['british', 'uk', 'britain'], IND: ['indian'], DEU: ['german', 'deutschland', 'deutsche', 'deutschen'],
  FRA: ['french', 'française', 'français'], BRA: ['brazilian', 'brasil'], NGA: ['nigerian'], JPN: ['japanese', '日本'],
  CHN: ['chinese', '中国'], RUS: ['russian', 'россия', 'российск'], UKR: ['ukrainian', 'україн', 'kyiv'], ISR: ['israeli'],
  MEX: ['mexican', 'méxico'], IDN: ['indonesian'], FJI: ['fijian'],
};

const SPORT = /\b(?:vs\.?|match|cup|league|squad|coach|goal|rugby|cricket|football|soccer|nba|nfl|fifa|uefa|olympic|tennis|golf|f1|grand prix|innings|wicket|striker|midfielder|test series|t20|odi|world cup|qualifier|fixture|semi-?final|quarter-?final)\b/i;
const SOFT = /\b(?:celebrity|actress|actor|singer|star's|kardashian|horoscope|recipe|best .* to (?:buy|visit)|travel guide|hotel|resort|luxury|fashion|royal baby|wedding|tips|how to|things to do|opinion|commentary|op-ed|column|editorial|review:)\b/i;

const fold = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
// English function words, and those of the native editions (es, pt, fr, de, it, id), so that two native
// titles do not count as one story because both say "de", "el" and "la".
const STOP = new Set(
  ('a an and are as at be by for from has have in into is it its of on or over says said than that the their this to was were will with after amid new up out about ' +
    'de del el la las los lo y en por con para una un que se su sus al le les des du et pour sur au aux dans est o os da do das dos em no na nas nos com uma um ao ' +
    'der die das und den dem des ein eine im zu von mit auf ist il di che per yang dan di ke dari untuk dengan').split(' '),
);
function tokens(title) {
  const t = fold(title);
  if (CJK.test(t)) {
    const s = t.replace(/[^\p{L}\p{N}]/gu, '');
    const out = new Set();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }
  const stem = (w) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  return new Set(t.replace(/['’]s\b/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w)).map(stem));
}
/** Same story: Dice overlap >= 0.4, or 3+ shared words (not counting the country's own words). */
function same(a, b, ignore) {
  const sa = [...a].filter((w) => !ignore.has(w));
  const sb = new Set([...b].filter((w) => !ignore.has(w)));
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared++;
  const dice = (2 * shared) / (sa.length + sb.size || 1);
  return dice >= 0.4 || (shared >= 3 && !CJK.test([...a][0] ?? ''));
}
const publisherKey = (s) => fold(s).replace(/^www\./, '').replace(/\.(?:com|net|org|co|news|in|uk|au)(?:\.[a-z]{2})?$/, '').replace(/[^\p{L}\p{N}]+/gu, '').replace(/^the(?=.{3})/, '');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function aliases(id) {
  const f = FACTS[id] ?? {};
  const out = new Set([f.name, ...(f.capital ?? []), ...(DEMONYMS[id] ?? [])].filter(Boolean).map(fold));
  for (const p of [f.government?.headOfState, f.government?.headOfGovernment]) {
    const last = p?.split(/\s+/).pop();
    if (last && last.length > 3) out.add(fold(last));
  }
  return [...out];
}
function namesCountry(title, id, strict) {
  const t = fold(title);
  const list = strict ? [fold(FACTS[id]?.name ?? id)] : aliases(id);
  return list.some((a) => (a.length <= 3 ? new RegExp(`(^|[^\\p{L}])${a.replace(/\./g, '\\.')}([^\\p{L}]|$)`, 'u').test(t) : t.includes(a)));
}

function parseRss(xml) {
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const body = m[1];
    const get = (tag) => (body.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1] ?? '';
    const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
    const source = dec(get('source'));
    let title = dec(get('title'));
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -source.length - 3);
    const desc = dec(get('description'));
    const outlets = [...desc.matchAll(/<font color="#6f6f6f">([^<]*)<\/font>/g)].map((x) => x[1]);
    items.push({ title, source, pubDate: get('pubDate'), outlets: outlets.length ? outlets : [source] });
  }
  return items;
}
async function getText(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.text();
}
async function reference(id) {
  const f = FACTS[id] ?? {};
  const ed = EDITIONS[f.iso2];
  const ref = { nation: [], search: [] };
  if (ed) {
    const [hl, gl, ceid] = ed;
    ref.nation = parseRss(await getText(`https://news.google.com/rss/headlines/section/topic/NATION?hl=${hl}&gl=${gl}&ceid=${ceid}`)).slice(0, 30);
    await sleep(DELAY);
  }
  const q = encodeURIComponent(`"${f.name}" when:1d`);
  ref.search = parseRss(await getText(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`));
  return ref;
}

function score(run) {
  const { id, articles, fetchedAt } = run;
  const now = Date.parse(fetchedAt ?? run.at);
  const ignore = new Set(aliases(id).flatMap((a) => [...tokens(a)]));
  const ages = articles.filter((a) => a.publishedAt).map((a) => (now - Date.parse(a.publishedAt)) / 3.6e6);
  const toks = articles.map((a) => tokens(a.title));
  let dupPairs = 0;
  for (let i = 0; i < toks.length; i++) for (let j = i + 1; j < toks.length; j++) if (same(toks[i], toks[j], ignore)) dupPairs++;
  const pool = run.ref ? [...run.ref.nation, ...run.ref.search] : [];
  const poolToks = pool.map((p) => tokens(p.title));
  const cov = toks.map((t) => {
    const outlets = new Set();
    pool.forEach((p, k) => { if (same(t, poolToks[k], ignore)) for (const o of p.outlets) outlets.add(publisherKey(o)); });
    return outlets.size;
  });
  const top10 = run.ref ? run.ref.nation.slice(0, 10).map((p) => tokens(p.title)) : [];
  const refAt10 = top10.length ? toks.filter((t) => top10.some((r) => same(t, r, ignore))).length : null;
  // Cross-language: a shared capitalised name (not the country's own words) also counts.
  const ignoreNames = new Set(aliases(id).flatMap((a) => a.split(/[^\p{L}]+/u)).filter((w) => w.length >= 4));
  const top10Names = run.ref ? run.ref.nation.slice(0, 10).map((p) => capNames(p.title, ignoreNames)) : [];
  const refX = top10.length
    ? articles.filter((a, i) => top10.some((r, k) => same(toks[i], r, ignore) || [...capNames(a.title, ignoreNames)].some((w) => top10Names[k].has(w)))).length
    : null;
  // Relevant: the title names the country (or an alias), or Google lists the story in the national (NATION) feed.
  const nation30 = run.ref ? run.ref.nation.slice(0, 30).map((p) => tokens(p.title)) : [];
  const relevant = articles.filter((a, i) => namesCountry(a.title, id, false) || nation30.some((r) => same(toks[i], r, ignore))).length;
  return {
    id,
    n: articles.length,
    provider: run.provider,
    ms: run.ms,
    medAgeH: ages.length ? +median(ages).toFixed(1) : null,
    maxAgeH: ages.length ? +Math.max(...ages).toFixed(1) : null,
    fresh24: articles.length ? `${ages.filter((h) => h <= 24).length}/${articles.length}` : '0/0',
    publishers: new Set(articles.map((a) => publisherKey(a.source))).size,
    namesStrict: articles.length ? +(articles.filter((a) => namesCountry(a.title, id, true)).length / articles.length).toFixed(2) : null,
    namesAny: articles.length ? +(articles.filter((a) => namesCountry(a.title, id, false)).length / articles.length).toFixed(2) : null,
    dupPairs,
    sport: articles.filter((a) => SPORT.test(a.title)).length,
    soft: articles.filter((a) => SOFT.test(a.title)).length,
    cov: cov.join(','),
    covMed: cov.length ? median(cov) : null,
    refAt10,
    refX: refX,
    native: articles.filter((a) => a.lang).length,
    relevant: articles.length ? +(relevant / articles.length).toFixed(2) : null,
  };
}

// Capitalised words of 4+ letters, folded, without common words that both languages use.
const CAP_STOP = new Set(['november', 'deutschland', 'bank', 'union', 'europa', 'president', 'presidente', 'minister', 'ministro', 'police', 'polizei', 'news', 'live', 'world', 'trump', 'putin', 'after', 'with', 'from', 'this', 'that', 'what', 'will', 'says']);
function capNames(title, ignore) {
  const out = new Set();
  for (const m of ` ${title}`.matchAll(/(?<=[\s"“‘'(«])(\p{Lu}[\p{L}'’-]{3,})/gu)) {
    const w = fold(m[1].replace(/['’]s$/, ''));
    if (!CAP_STOP.has(w) && ![...ignore].some((x) => fold(x) === w)) out.add(w);
  }
  return out;
}

async function main() {
  let runs;
  if (args.from) {
    runs = JSON.parse(readFileSync(args.from, 'utf8'));
    // --ref other.json: score against the reference pools of another run, so before/after use one reference.
    if (args.ref) {
      const refs = new Map(JSON.parse(readFileSync(args.ref, 'utf8')).map((r) => [r.id, r.ref]));
      for (const r of runs) if (refs.get(r.id)) r.ref = refs.get(r.id);
    }
  } else {
    runs = [];
    for (const id of IDS) {
      const t0 = Date.now();
      let res, body;
      try {
        res = await fetch(`${BASE}/api/news?country=${id}`, { signal: AbortSignal.timeout(30000) });
        body = await res.json();
      } catch (e) {
        body = { articles: [], provider: null, error: String(e) };
      }
      const run = { id, at: new Date().toISOString(), ms: Date.now() - t0, cache: res?.headers.get('cache-control') ?? null, ...body };
      if (!args['no-ref']) {
        try { run.ref = await reference(id); } catch (e) { run.refError = String(e); }
        await sleep(DELAY);
      }
      runs.push(run);
      process.stderr.write(`${id} ${run.ms}ms n=${run.articles.length}\n`);
    }
    if (args.out) writeFileSync(args.out, JSON.stringify(runs, null, 1));
  }
  const rows = runs.map(score);
  console.table(rows);
  const all = (k) => rows.map((r) => r[k]).filter((v) => typeof v === 'number');
  console.log('SUMMARY', JSON.stringify({
    countries: rows.length,
    medianOfMedAgeH: median(all('medAgeH')),
    worstMaxAgeH: Math.max(...all('maxAgeH')),
    meanNamesStrict: +(all('namesStrict').reduce((a, b) => a + b, 0) / rows.length).toFixed(2),
    meanNamesAny: +(all('namesAny').reduce((a, b) => a + b, 0) / rows.length).toFixed(2),
    totalDupPairs: all('dupPairs').reduce((a, b) => a + b, 0),
    totalSport: all('sport').reduce((a, b) => a + b, 0),
    totalSoft: all('soft').reduce((a, b) => a + b, 0),
    medianCov: median(all('covMed')),
    refAt10Total: `${all('refAt10').reduce((a, b) => a + b, 0)}/${rows.filter((r) => r.refAt10 !== null).reduce((a, r) => a + r.n, 0)}`,
    refXAt10Total: `${all('refX').reduce((a, b) => a + b, 0)}/${rows.filter((r) => r.refX !== null).reduce((a, r) => a + r.n, 0)}`,
    totalNative: all('native').reduce((a, b) => a + b, 0),
    meanRelevant: +(all('relevant').reduce((a, b) => a + b, 0) / rows.length).toFixed(2),
    medianMs: median(all('ms')),
  }));
}
main();
