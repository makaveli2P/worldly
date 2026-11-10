// Builds the news list for one country: gather all sources in parallel, cluster, score, pick 5.
// The result stays in memory for 10 minutes.
import type { NewsArticle, NewsProvider, NewsResponse } from '../../src/types';
import { lookupBias } from './bias.js';
import countries from './countries.json' with { type: 'json' };
import { editionsFor } from './editions.js';
import aliasTable from './news-aliases.json' with { type: 'json' };
import { nation, search, top } from './providers/google.js';
import { newsdata, newsdataEnabled } from './providers/newsdata.js';
import { outletItems } from './providers/outlets.js';
import type { Candidate, NewsCountry } from './providers/types.js';
import { pick, rankContext, rankHybrid, rankPool, type Cluster, type RankContext } from './rank.js';
import { relevance } from './text.js';

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

const COUNTRIES = countries as Record<string, { name: string; iso2: string | null }>;
const ALIASES = aliasTable as Record<string, string[]>;
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
  /** True when a Google feed answered. */
  google: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Starts every source at once and returns what arrived by the deadline. */
async function gather(country: NewsCountry, aliases: readonly string[]): Promise<Pools> {
  const { english: en, native: nat } = editionsFor(country.iso2);
  const ctrl = new AbortController();
  const pools: Pools = { english: [], native: [], ok: 0, total: 0, google: false };
  const jobs: Promise<void>[] = [];
  const job = (name: string, google: boolean, run: () => Promise<Candidate[]>, into: Candidate[]) => {
    pools.total += 1;
    jobs.push(
      run().then(
        (items) => {
          if (ctrl.signal.aborted) return;
          into.push(...items);
          pools.ok += 1;
          if (google && items.length > 0) pools.google = true;
        },
        (err: unknown) => {
          // Log only the source and a short reason. Never the URL or the body.
          const reason = err instanceof Error && err.name === 'UpstreamError' ? err.message : 'error';
          if (!ctrl.signal.aborted) console.warn(`[news] ${name} failed for ${country.id}: ${reason}`);
        },
      ),
    );
  };

  if (en) {
    job('google nation', true, () => nation(en, ctrl.signal, REQUEST_TIMEOUT_MS), pools.english);
    job('google top', true, () => top(en, ctrl.signal, REQUEST_TIMEOUT_MS), pools.english);
  }
  if (nat) job('google native nation', true, () => nation(nat, ctrl.signal, REQUEST_TIMEOUT_MS), pools.native);
  job(
    'google search',
    true,
    async () => {
      const day = await search(country.name, 1, ctrl.signal, REQUEST_TIMEOUT_MS);
      if (day.length >= MIN_SEARCH_ITEMS) return day;
      // A small country: look at 2 days. Keep the 1-day items if this fails.
      try {
        return await search(country.name, 2, ctrl.signal, REQUEST_TIMEOUT_MS);
      } catch {
        return day;
      }
    },
    pools.english,
  );
  // The outlet feeds are global. Keep only the items whose title names the country.
  job(
    'outlet feeds',
    false,
    async () => (await outletItems(REQUEST_TIMEOUT_MS)).filter((c) => relevance(c.title, country.name, aliases) === 'yes'),
    pools.english,
  );

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
  return { picked: pick(ranked, MAX_ARTICLES, ctx.ignore), relevant: relevant(ranked) };
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

async function build(country: NewsCountry): Promise<NewsResponse> {
  const aliases = aliasesOf(country);
  const pools = await gather(country, aliases);
  const ctx = rankContext(country.name, aliases, Date.now());
  let { picked, relevant: passing } = rankAll(pools, ctx);

  // NewsData is only a fallback: small countries with no edition, or a Google failure.
  if (passing < MAX_ARTICLES && newsdataEnabled()) {
    try {
      const extra = await newsdata(country, REQUEST_TIMEOUT_MS);
      if (extra.length > 0) {
        pools.english.push(...extra);
        ({ picked } = rankAll(pools, ctx));
      }
    } catch (err) {
      const reason = err instanceof Error && err.name === 'UpstreamError' ? err.message : 'error';
      console.warn(`[news] newsdata failed for ${country.id}: ${reason}`);
    }
  }

  debugLog(country, picked, pools);
  const articles = picked.map(toArticle);
  return { country: country.id, articles, provider: providerOf(picked), fetchedAt: new Date().toISOString() };
}

interface CacheEntry {
  expires: number;
  value: Promise<NewsResponse>;
}

const cache = new Map<string, CacheEntry>();

/** Returns cached news when fresh. Parallel calls for one country share one upstream run. */
export function getNews(country: NewsCountry): Promise<NewsResponse> {
  const now = Date.now();
  const hit = cache.get(country.id);
  if (hit && hit.expires > now) return hit.value;

  const value = build(country);
  const entry: CacheEntry = { expires: now + CACHE_TTL_MS, value };
  cache.set(country.id, entry);
  value.then(
    (result) => {
      if (result.provider === null) entry.expires = Date.now() + FAILURE_TTL_MS;
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
