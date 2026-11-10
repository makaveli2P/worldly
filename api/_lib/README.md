## News API

`GET /api/news?country=<CountryId>` returns a `NewsResponse` (see `src/types.ts`) with up to 5 stories, in score order (not in date order).

Each `NewsArticle` can also have these optional fields:

- `domain`: the publisher host, for example `theguardian.com`.
- `lang`: the BCP-47 code when the title is not in English, else `null`.
- `outlets`: the number of distinct outlets in the story's cluster.
- `bias`: the publisher rating (`ArticleBias`), or `null` when no rating exists.

### Files

- `news.ts`: gather, rank, cache. `getNews()` is the entry point.
- `editions.ts`: the only table of Google News editions (English and native).
- `providers/google.ts`: NATION, Top stories and search feeds.
- `providers/outlets.ts`: the front-page feeds of 11 outlets.
- `providers/newsdata.ts`: the NewsData.io fallback.
- `rank.ts`: clusters, scores and the pick step. Pure functions, with tests in `test/news/rank.test.ts`.
- `text.ts`: text helpers: whole-word country match, relevance, proper names, junk and press-release filters.
- `rss.ts`: the RSS item parser. It keeps the feed rank, the Google outlet list in `<description>` and the `<source url>` attribute.
- `domain.ts`: publisher hosts. It never takes the host of an aggregator link (news.google.com, msn.com, ...).
- `bias.ts`, `bias-rules.json`, `state-media.json`, `generated/mbfc.json`: publisher ratings (see below).

GDELT is removed. It answered 429 to 15 of 15 test requests, after 9 to 13 seconds each.

### Gather

`gather()` starts these requests at the same time. Each request has a 2.5 s timeout. After 3 s, the server uses what arrived and stops the rest.

1. **Google edition NATION** (English edition, else none): the national stories, in Google's order. The section URL answers 302 to a topic URL. The server keeps the topic URL for each edition, because the redirect costs up to 1 s. A silent fallback to another edition (a different `ceid` in the final URL) counts as a failure.
2. **Google edition Top stories** (English edition only): a "front page" signal.
3. **Google search**: `"<name>" when:1d`, US English edition, up to 100 items. With fewer than 20 items, the server searches 2 days.
4. **Outlet feeds**: the front pages of BBC, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India and The New York Times. One fetch serves all countries for 10 minutes. Only titles that name the country count.
5. **Native NATION** (only for a country with no English edition): the national stories in the edition language.

English editions: AU, BW, CA, ET, GB, GH, ID, IE, IL, IN, KE, MY, NA, NG, NZ, PH, PK, SG, TZ, UG, US, ZA, ZW. A country with neither edition (Fiji, Iran, ...) uses the search and the outlet feeds.

**NewsData.io** is a fallback. It runs only when `NEWSDATA_API_KEY` is set and fewer than 5 clusters pass the relevance gate. Parameters: `qInTitle="<name>"`, `language=en`, `prioritydomain=top`, `excludecategory=sports,entertainment,lifestyle`, `removeduplicate=1`, `size=10`. A second call without `prioritydomain` runs only when the first gives nothing. Each result stays in memory for 6 hours, because the free plan delays data by 12 hours. Each call costs one credit. The server logs one line for each call, without the key or the URL.

### Filters (before clustering)

- Items older than 36 hours.
- Press-release wires (`isPressRelease`) and spam, reference pages and adverts (`isJunk`).

### Clusters

Each candidate joins the cluster whose first member (the seed) tells the same story. The server compares a candidate with the seed only, so clusters do not chain. Same story, without the country's own words:

- (a) the Dice overlap of stemmed words is 0.4 or more; or
- (b) 3 or more words are shared (not for CJK titles); or
- (c) 2 or more proper names are shared; or
- (d) 2 words are shared, and one of them is a name that both titles capitalise.

CJK titles use character pairs. A few synonyms count as one word ("blast" and "explosion", "step down" and "resign").

`outlets` = the distinct publishers of the members plus the outlets that Google lists for each member.

### Score

`score = rel x pen x (0.35 x S_cov + 0.30 x S_rank + 0.10 x S_auth + 0.25 x S_rec)`

- `S_cov = min(1, log2(1 + outlets) / log2(11))`.
- `S_rank = 1 / (1 + (r - 1) / 5)`, with `r` = the best of the NATION rank, the Top rank + 2 and the native boost rank. No rank gives 0.
- `S_auth` = 1 for a tier-1 outlet (wires, public broadcasters, papers of record), 0.7 for a NewsData `source_priority` of 3000 or less, else 0.4.
- `S_rec = 0.5 ^ (age in hours / 12)`, from the newest member.
- `rel` = 1 when a member is from NATION or a title names the country, a demonym, the capital or a leader (whole words). 0.3 for no match. 0 for a homonym or a longer place ("New Mexico", "Mexico, NY"), and 0 when the shown title names only such a place.
- `pen` multiplies: 0.5 for sport (also a sport publisher), 0.5 for soft items (celebrity, travel, consumer, market-data sites, weather and service items in native feeds), 0.7 for opinion, 0.5 for a list of countries, 0.3 for a Top story that is not national and does not name the country.

### Pick

The best score first. Pass 1 takes 1 cluster per publisher. Pass 2 allows a second one, only to fill the list. A cluster that tells the same story as a picked cluster is skipped. A third story on one event (a shared capitalised name) counts at 0.6 of its score. The representative article is the NATION member with the best rank, else a tier-1 member, else the newest member.

### Hybrid language (no English edition)

1. An English cluster that shares a capitalised name with a native NATION top-20 title takes that native rank (with a stoplist). This works for Latin scripts only.
2. A strong English cluster has a score of 0.45 or more, and more than 1 outlet or a native rank.
3. With 3 or more distinct strong English clusters, the list is English only.
4. Else the list is: the strong English clusters, then native clusters (with `lang`), then the other English clusters. A native story that a strong English story already tells is skipped.

### Publisher ratings

`lookupBias(domain, name)` in `bias.ts` gives an `ArticleBias` or `null`. It runs once for each picked story, before the result goes into the cache.

- **Domain.** Google: the `<source url>` attribute. NewsData: `source_url`, else the article host. Outlet feeds: the article host. A news.google.com host is never a domain.
- **Lookup order.** The host, then each parent down to the registrable domain (with a list of 2-level suffixes), each with its alias from `bias-rules.json`. A host under a "stop parent" (indiatimes.com, yahoo.com, ...) does not fall back to that parent. A host on the deny list (news.google.com, msn.com, aol.com, medium.com, wikipedia.org, facebook.com, ...) gets no rating. A publisher name counts only when the domain is null, and only through the short allowlist `names` in `bias-rules.json`.
- **Lean** (MBFC): from `generated/mbfc.json`, which git ignores. Labels: "Left", "Lean left", "Centre", "Lean right", "Right". A record with no lean (Questionable, Satire, ...) gives no lean and no label. Factuality and "Questionable" are not shown.
- **State tag** (State Media Monitor, `state-media.json`): SC gives "STATE-CONTROLLED"; CaPu and CaPr give "CAPTURED"; IP, ISF, ISFM and ISM give "PUBLIC".
- `rater` and `ref` are null when only a state tag exists.

`bias.ts` reads the MBFC table at runtime with `readFileSync`, from a literal path. The Vercel file trace then adds the file to the function when it exists. With no file (fresh clone, tests, CI, a build with no key), every lean is null.

`scripts/build-bias.mjs` builds the table from the RapidAPI records:

- It maps the `Bias` values with a tolerant table. An unknown value gives no lean and a warning in the log.
- It drops a record whose `Source URL` has a path (`cbsnews.com/atlanta`), unless the host has no bare record and all its path records agree. `pathRecords` in `bias-rules.json` maps `www3.nhk.or.jp` to the NHK World record.
- It drops hosts on the deny list.
- It stores tuples `[name, lean, slug]`, about 0.7 MB.

### Caching

- Server memory: each list for 10 minutes. Parallel requests for one country share one run. A list with no provider stays for 60 seconds.
- Success: `Cache-Control: public, max-age=60, s-maxage=900, stale-while-revalidate=1800, stale-if-error=86400`. Vercel removes `s-maxage` and `stale-while-revalidate` before the browser. The worst age of a list is about 55 minutes.
- Failure: `public, s-maxage=60`.
- Client (`src/main.ts`): a list stays for at most 10 minutes.

### API keys

- `NEWSDATA_API_KEY` (optional): local in `.env` (git ignores it); on Vercel under Project Settings > Environment Variables.
- `RAPIDAPI_KEY` (optional): used only by `npm run bias` at build time. On Vercel, set it for Production only.

The handler never writes a key or an upstream error body to responses or logs. `NEWS_DEBUG=1` logs the score of each picked cluster.
