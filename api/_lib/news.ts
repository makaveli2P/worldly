// Builds the news list for one country: gather all sources in parallel, cluster, score, pick 5.
// The result stays in memory for 10 minutes.
import type { NewsArticle, NewsProvider, NewsResponse } from '../../src/types';
import { lookupBias } from './bias.js';
import countries from './countries.json' with { type: 'json' };
import { editionsFor } from './editions.js';
import aliasTable from './news-aliases.json' with { type: 'json' };
import { nation, search, top } from './providers/google.js';
import { newsdata, newsdataCached, newsdataEnabled } from './providers/newsdata.js';
import { outletItems } from './providers/outlets.js';
import type { Candidate, NewsCountry } from './providers/types.js';
import { pick, rankContext, rankHybrid, rankPool, type Cluster, type RankContext } from './rank.js';
import { fold, relevance } from './text.js';
import { translateTitles } from './translate.js';

export const MAX_ARTICLES = 5;
const CACHE_TTL_MS = 10 * 60 * 1000;
const FAILURE_TTL_MS = 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
/** All sources start together. The list uses what arrived by this deadline. */
const DEADLINE_MS = 3000;
/** Timeout of each upstream request. */
const REQUEST_TIMEOUT_MS = 2500;
/** A search with fewer items than this in 1 day is repeated for 2 days. */
const MIN_SEARCH_ITEMS = 20;
/** The NewsData fallback starts only when at least this much of TOTAL_BUDGET_MS is left. */
const MIN_FALLBACK_MS = 600;
/** The whole build, NewsData fallback included, ends by this time. */
const TOTAL_BUDGET_MS = 4000;
/** The translation of the picked titles waits at most this long. */
const TRANSLATE_TIMEOUT_MS = 1500;
/** The translation gets at least this long, also after a late NewsData answer. */
const TRANSLATE_MIN_MS = 500;
/** The whole build, translation included, ends by this time (TOTAL_BUDGET_MS + 1 s). */
const BUILD_END_MS = TOTAL_BUDGET_MS + 1000;
/** A last good list stands in for a failed rebuild for at most this long (as stale-if-error). */
const LAST_GOOD_MS = 24 * 60 * 60 * 1000;

const COUNTRIES = countries as Record<string, { name: string; iso2: string | null }>;
const ALIASES = aliasTable as Record<string, string[]>;
// Countries whose bare name brings mostly other places or people ("Georgia" brings the US state).
// Their search also asks for the capital or the demonym; Google News matches it in the full text.
const SEARCH_HINTS: Record<string, string> = {
  GEO: '(Tbilisi OR Georgian)',
  JOR: '(Amman OR Jordanian)',
  NER: '(Niamey OR Nigerien)',
  TCD: "(N'Djamena OR Chadian)",
  PSE: '(Gaza OR "West Bank" OR Palestinian)',
};

/** The Google News search expression for a country. */
export function searchQuery(country: NewsCountry): string {
  const hint = Object.hasOwn(SEARCH_HINTS, country.id) ? SEARCH_HINTS[country.id] : '';
  return hint ? `"${country.name}" ${hint}` : `"${country.name}"`;
}

/** Folded words of every country's aliases. Two stories that share only such a word are not one story. */
const PLACE_WORDS: ReadonlySet<string> = new Set(
  Object.values(ALIASES).flatMap((list) => list.flatMap((a) => fold(a).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4))),
);
/** Lowercase id -> id, so "deu" and "x-kosovo" resolve. */
const ID_BY_LOWER = new Map(Object.keys(COUNTRIES).map((id) => [id.toLowerCase(), id]));

/** Returns the country for a known id, else null. Accepts any case. */
export function findCountry(raw: string | null): NewsCountry | null {
  if (!raw || raw.length > 64) return null;
  const id = Object.hasOwn(COUNTRIES, raw) ? raw : ID_BY_LOWER.get(raw.toLowerCase());
  if (!id) return null;
  const entry = COUNTRIES[id];
  return { id, name: entry.name, iso2: entry.iso2 };
}

/** Names, demonyms, capitals and leaders of a country, for the relevance check. */
export function aliasesOf(country: NewsCountry): string[] {
  const list = Object.hasOwn(ALIASES, country.id) ? ALIASES[country.id] : [];
  return list.includes(country.name) ? list : [country.name, ...list];
}

interface Pools {
  /** English stories: edition (when English), search, outlet feeds and NewsData. */
  english: Candidate[];
  /** Native-language NATION stories, for a country with no English edition. */
  native: Candidate[];
  ok: number;
  total: number;
  /** True when a Google feed answered with RSS (even with no items). False when Google failed or hung. */
  google: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Starts every source at once and returns what arrived by the deadline. */
async function gather(country: NewsCountry, aliases: readonly string[]): Promise<Pools> {
  const { english: en, native: nat } = editionsFor(country.iso2);
  const ctrl = new AbortController();
  const pools: Pools = { english: [], native: [], ok: 0, total: 0, google: false };
  const jobs: Promise<void>[] = [];
  // Each job adds its items through `add`, so a job can add a first part before a later part fails.
  const job = (name: string, google: boolean, run: (add: (items: Candidate[]) => void) => Promise<void>, into: Candidate[]) => {
    pools.total += 1;
    let answered = false;
    // A source counts as answered at its first result, even when a later part of the job fails or is late.
    const add = (items: Candidate[]) => {
      if (ctrl.signal.aborted) return;
      into.push(...items);
      if (!answered) pools.ok += 1;
      answered = true;
      if (google) pools.google = true;
    };
    jobs.push(
      run(add).then(
        () => {},
        (err: unknown) => {
          // Log only the source and a short reason. Never the URL or the body.
          const reason = err instanceof Error && err.name === 'UpstreamError' ? err.message : 'error';
          if (!ctrl.signal.aborted) console.warn(`[news] ${name} failed for ${country.id}: ${reason}`);
        },
      ),
    );
  };
  const simple = (fetchItems: () => Promise<Candidate[]>) => async (add: (items: Candidate[]) => void) => add(await fetchItems());

  if (en) {
    job('google nation', true, simple(() => nation(en, ctrl.signal, REQUEST_TIMEOUT_MS)), pools.english);
    job('google top', true, simple(() => top(en, ctrl.signal, REQUEST_TIMEOUT_MS)), pools.english);
  }
  if (nat) job('google native nation', true, simple(() => nation(nat, ctrl.signal, REQUEST_TIMEOUT_MS)), pools.native);
  const query = searchQuery(country);
  const confirm = (items: Candidate[]) => (query.includes('(') ? items.map((c) => ({ ...c, confirmed: true })) : items);
  job(
    'google search',
    true,
    async (add) => {
      const day = confirm(await search(query, 1, ctrl.signal, REQUEST_TIMEOUT_MS));
      // Keep the 1-day items now: a slow 2-day search must not lose them at the deadline.
      add(day);
      if (day.length >= MIN_SEARCH_ITEMS) return;
      // A small country: look at 2 days, and add only the items that the 1-day search did not give.
      try {
        const seen = new Set(day.map((c) => c.url));
        add(confirm(await search(query, 2, ctrl.signal, REQUEST_TIMEOUT_MS)).filter((c) => !seen.has(c.url)));
      } catch {
        // The 1-day items are in the pool.
      }
    },
    pools.english,
  );
  // The outlet feeds are global. Keep only the items whose title names the country.
  job(
    'outlet feeds',
    false,
    simple(async () => (await outletItems(REQUEST_TIMEOUT_MS)).filter((c) => relevance(c.title, country.name, aliases) === 'yes')),
    pools.english,
  );
  // A NewsData result in memory costs no credit, so it joins the pool at once.
  const kept = newsdataCached(country);
  if (kept) job('newsdata (memory)', false, simple(() => kept), pools.english);

  await Promise.race([Promise.allSettled(jobs), sleep(DEADLINE_MS)]);
  ctrl.abort();
  return pools;
}

/** Clusters that pass the relevance gate: they name the country, or Google lists them as national. */
const relevant = (clusters: readonly Cluster[]) => clusters.filter((cl) => cl.rel === 1 && cl.score > 0).length;

interface Ranking {
  picked: Cluster[];
  relevant: number;
}

function rankAll(pools: Pools, ctx: RankContext): Ranking {
  if (pools.native.length > 0) {
    const { clusters, all } = rankHybrid(pools.english, pools.native, ctx, MAX_ARTICLES);
    return { picked: clusters, relevant: relevant(all) };
  }
  const ranked = rankPool(pools.english, ctx);
  return { picked: pick(ranked, MAX_ARTICLES, ctx), relevant: relevant(ranked) };
}

function debugLog(country: NewsCountry, picked: readonly Cluster[], pools: Pools): void {
  if (process.env.NEWS_DEBUG !== '1') return;
  console.info(`[news] ${country.id}: english=${pools.english.length} native=${pools.native.length} sources ${pools.ok}/${pools.total}`);
  for (const cl of picked) {
    const r = Math.min(cl.nationRank, cl.topRank + 2, cl.boostRank);
    console.info(
      `[news]   ${cl.score.toFixed(3)} out=${cl.outlets} r=${Number.isFinite(r) ? r : '-'} age=${cl.ageH.toFixed(1)}h rel=${cl.rel} pen=${cl.pen} n=${cl.members.length} ${cl.rep.feed} | ${cl.rep.source} | ${cl.rep.title.slice(0, 90)}`,
    );
  }
}

function toArticle(cl: Cluster): NewsArticle {
  const rep = cl.rep;
  return {
    title: rep.title,
    url: rep.url,
    source: rep.source,
    publishedAt: rep.publishedAt,
    imageUrl: rep.imageUrl,
    domain: rep.domain,
    lang: rep.lang,
    outlets: cl.outlets,
    // A publisher name counts only when the host is unknown (hand allowlist in bias-rules.json).
    bias: lookupBias(rep.domain, rep.domain ? null : rep.source),
  };
}

/**
 * Gives the non-English titles of the picked list in English (DeepL, src/types.ts NewsArticle).
 * It runs after the pick, so the clusters and the dedupe use the original titles. On a failure the titles stay as they are.
 */
async function translated(articles: NewsArticle[], elapsedMs: number): Promise<{ articles: NewsArticle[]; failed: boolean }> {
  if (!articles.some((a) => a.lang)) return { articles, failed: false };
  const timeoutMs = Math.min(TRANSLATE_TIMEOUT_MS, Math.max(TRANSLATE_MIN_MS, BUILD_END_MS - elapsedMs));
  // translateTitles never throws on an upstream failure. This guard keeps the news response for any other fault.
  const result = await translateTitles(articles, { timeoutMs }).catch(() => null);
  if (!result) return { articles, failed: true };
  return { articles: articles.map((a, i) => (result.titles[i].translatedBy ? { ...a, ...result.titles[i] } : a)), failed: result.failed };
}

/** The provider label: the feed family that gave most of the picked stories. */
function providerOf(picked: readonly Cluster[]): NewsProvider | null {
  if (picked.length === 0) return null;
  const count = new Map<NewsProvider, number>();
  for (const cl of picked) {
    const feeds = new Set(cl.members.map((m) => m.feed));
    const p: NewsProvider = feeds.has('nation') || feeds.has('top') || feeds.has('search') ? 'google' : feeds.has('newsdata') ? 'newsdata' : 'feeds';
    count.set(p, (count.get(p) ?? 0) + 1);
  }
  let best: NewsProvider | null = null;
  for (const [p, n] of count) if (best === null || n > count.get(best)!) best = p;
  return best;
}

/** How a build went: 'ok', 'degraded' (Google gave nothing; the list can be partial) or 'failed' (no source answered). */
export type BuildState = 'ok' | 'degraded' | 'failed';

export interface NewsResult {
  news: NewsResponse;
  state: BuildState;
  /**
   * True when the translation failed: the list is good, but its native titles are not in English.
   * The list then stays in memory and on the CDN for 60 s only, so a later request tries the translation again.
   */
  untranslated?: boolean;
}

async function build(country: NewsCountry): Promise<NewsResult> {
  const started = Date.now();
  const aliases = aliasesOf(country);
  const pools = await gather(country, aliases);
  const ctx = rankContext(country.name, aliases, Date.now(), PLACE_WORDS);
  let { picked, relevant: passing } = rankAll(pools, ctx);

  // NewsData is only a fallback: small countries with no edition, or a Google failure.
  // It gets only the time that is left of TOTAL_BUDGET_MS. A late answer stays in memory for the next request.
  const left = TOTAL_BUDGET_MS - (Date.now() - started);
  if (passing < MAX_ARTICLES && newsdataEnabled() && !newsdataCached(country) && left >= MIN_FALLBACK_MS) {
    const call = newsdata(country, REQUEST_TIMEOUT_MS);
    try {
      const extra = await Promise.race([call, sleep(left).then(() => null)]);
      if (extra && extra.length > 0) {
        pools.english.push(...extra);
        ({ picked } = rankAll(pools, ctx));
      }
    } catch (err) {
      const reason = err instanceof Error && err.name === 'UpstreamError' ? err.message : 'error';
      console.warn(`[news] newsdata failed for ${country.id}: ${reason}`);
    }
  }

  debugLog(country, picked, pools);
  const { articles, failed: untranslated } = await translated(picked.map(toArticle), Date.now() - started);
  const news: NewsResponse = { country: country.id, articles, provider: providerOf(picked), fetchedAt: new Date().toISOString() };
  const state: BuildState = pools.ok === 0 ? 'failed' : pools.google ? 'ok' : 'degraded';
  return { news, state, untranslated };
}

interface CacheEntry {
  expires: number;
  value: Promise<NewsResult>;
}

const cache = new Map<string, CacheEntry>();
/** The last list that a full build ('ok', with stories) gave, per country. */
const lastGood = new Map<string, { at: number; news: NewsResponse }>();

/**
 * A failed or degraded build does not replace a good list: the last good list (at most 24 h old)
 * stands in for it, with the short failure cache, so the next request tries again soon.
 */
function settle(id: string, result: NewsResult): NewsResult {
  if (result.state === 'ok') {
    if (result.news.articles.length > 0) {
      lastGood.delete(id);
      lastGood.set(id, { at: Date.now(), news: result.news });
      if (lastGood.size > CACHE_MAX_ENTRIES) lastGood.delete(lastGood.keys().next().value!);
    }
    return result;
  }
  const good = lastGood.get(id);
  if (good && Date.now() - good.at < LAST_GOOD_MS && good.news.articles.length >= result.news.articles.length) {
    return { news: good.news, state: 'degraded' };
  }
  return result;
}

/**
 * Returns cached news when fresh, with the state of the build. Parallel calls for one country share one
 * upstream run. A degraded or failed result stays in memory for FAILURE_TTL_MS only.
 */
export function getNewsResult(country: NewsCountry): Promise<NewsResult> {
  const now = Date.now();
  const hit = cache.get(country.id);
  if (hit && hit.expires > now) return hit.value;

  const value = build(country).then((r) => settle(country.id, r));
  const entry: CacheEntry = { expires: now + CACHE_TTL_MS, value };
  cache.set(country.id, entry);
  value.then(
    (result) => {
      if (result.state !== 'ok' || result.news.provider === null || result.untranslated) entry.expires = Date.now() + FAILURE_TTL_MS;
    },
    () => cache.delete(country.id),
  );

  if (cache.size > CACHE_MAX_ENTRIES) {
    for (const [key, old] of cache) {
      if (old.expires <= now || cache.size > CACHE_MAX_ENTRIES) cache.delete(key);
      if (cache.size <= CACHE_MAX_ENTRIES) break;
    }
  }
  return value;
}

/** Returns cached news when fresh. See getNewsResult. */
export async function getNews(country: NewsCountry): Promise<NewsResponse> {
  return (await getNewsResult(country)).news;
}
