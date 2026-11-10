## News API

`GET /api/news?country=<CountryId>` returns a `NewsResponse` (see `src/types.ts`) with up to 5 stories, in score order (not in date order).

Each `NewsArticle` can also have these optional fields:

- `domain`: the publisher host, for example `theguardian.com`.
- `lang`: the BCP-47 code when the title is not in English, else `null`.
- `outlets`: the number of distinct outlets in the story's cluster.
- `bias`: the publisher rating (`ArticleBias`), or `null` when no rating exists.

### Files

- `news.ts`: gather, rank, cache. `getNewsResult()` is the entry point (`getNews()` gives only the list).
- `news-aliases.json`: the names, demonyms, capitals and leaders of each country, for the relevance check. `scripts/build-news-aliases.mjs` (`npm run aliases`) writes it from `scripts/news-aliases-base.json` and the leaders in `public/data/countries.json`. Do not edit it by hand. Each alias belongs to one country (a test checks this). A shared name ("Charles III") stays on the country with the most people. A bare surname stays only when it has 5 or more letters (or is on a short list: Modi, Merz, ...) and is not a common word, first name or frequent surname.
- `editions.ts`: the only table of Google News editions (English and native).
- `providers/google.ts`: NATION, Top stories and search feeds.
- `providers/outlets.ts`: the front-page feeds of 11 outlets.
- `providers/newsdata.ts`: the NewsData.io fallback.
- `rank.ts`: clusters, scores and the pick step. Pure functions, with tests in `test/news/rank.test.ts`.
- `text.ts`: text helpers: whole-word country match, relevance, proper names, junk and press-release filters.
- `rss.ts`: the RSS item parser. It keeps the feed rank, the Google outlet list in `<description>` and the `<source url>` attribute.
- `domain.ts`: publisher hosts. It never takes the host of an aggregator link (news.google.com, msn.com, ...). `isPlatform()` finds posts from social and aggregator platforms (Facebook, NewsBreak, ...), which the Google parser drops.
- `bias.ts`, `bias-rules.json`, `state-media.json`, `generated/mbfc.json`: publisher ratings (see below).

GDELT is removed. It answered 429 to 15 of 15 test requests, after 9 to 13 seconds each.

### Gather

`gather()` starts these requests at the same time. Each request has a 2.5 s timeout. After 3 s, the server uses what arrived and stops the rest.

1. **Google edition NATION** (English edition, else none): the national stories, in Google's order. The section URL answers 302 to a topic URL. The server keeps the topic URL for each edition, because the redirect costs up to 1 s. A silent fallback to another edition (a different `ceid` in the final URL) counts as a failure.
2. **Google edition Top stories** (English edition only): a "front page" signal.
3. **Google search**: `"<name>" when:1d`, US English edition, up to 100 items. With fewer than 20 items, the server searches 2 days too. The 1-day items go into the pool at once, so a slow 2-day search cannot lose them at the deadline. For Georgia, Jordan, Niger, Chad and Palestine the query also asks for the capital or the demonym (`"Georgia" (Tbilisi OR Georgian)`), and those items count as tied to the country (`confirmed`).
4. **Outlet feeds**: the front pages of BBC, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India and The New York Times. One fetch serves all countries for 10 minutes. Only titles that name the country count.
5. **Native NATION** (only for a country with no English edition): the national stories in the edition language.

English editions: AU, BW, CA, ET, GB, GH, ID, IE, IL, IN, KE, MY, NA, NG, NZ, PH, PK, SG, TZ, UG, US, ZA, ZW. A country with neither edition (Fiji, Iran, ...) uses the search and the outlet feeds.

**NewsData.io** is a fallback. It runs only when `NEWSDATA_API_KEY` is set and fewer than 5 clusters pass the relevance gate. It is one call: `qInTitle="<name>"`, `language=en`, `prioritydomain=top`, `excludecategory=sports,entertainment,lifestyle`, `removeduplicate=1`, `size=10`. The whole request ends by 4 s: the call starts only when 600 ms or more of that budget is left, and the server waits only for the rest of the budget. A late answer stays in memory, and a result in memory joins the gather at once with no credit. Each result stays in memory for 6 hours, because the free plan delays data by 12 hours. With `NEWS_DEBUG=1`, the server logs one line for each call, without the key or the URL.

**Title clean-up**: the parsers remove a dangling dash, a publisher credit (" | TygerBurger", " — ABC News Australia") and a site section path (" - Region - World"). A publisher name that is a URL becomes its host; a long name stops at a dash. For an English feed, `guessLang()` tags a title in another language (by script, or by 2 or more function words), so the row shows a language tag.

### Filters (before clustering)

- Items older than 36 hours.
- Press-release wires (`isPressRelease`) and spam, reference pages and adverts (`isJunk`). `isJunk` also drops company filings ("Form 6-K", "Form 4"), earthquake bots ("Light mag. 3.3 earthquake"), puzzle answers, "available for interviews" notices, scholarship and job adverts, and ReliefWeb documents.
- Titles that hold only the country's own words ("Saint Vincent and the Grenadines").

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
- `rel` = 1 when a member is from NATION or a title names the country, a demonym, the capital or a leader (whole words). 0.3 for no match. 0 for a homonym or a longer place ("New Mexico", "Mexico, NY", "Panama City Beach", "Niger State", "Palestine Action", "Jordan Fisher", the US state of Georgia), when trap titles are as many as the titles that name the country. For Georgia, Jordan, Niger, Chad and Palestine, the bare name alone is `weak` (0.3) unless the title also has a context word (Tbilisi, EU, Amman, junta, Gaza, ...) or the search asked for the capital. Blocked phrases ("Air India") are removed as whole words, so "Repair India-made trains" still names India.
- `pen` multiplies: 0.5 for sport (also a sport publisher, cricket "first Test", score lines such as "80-72 victory"), 0.5 for soft items (celebrity, tours and concerts, travel, consumer, market-data sites and stock notes, weather and service items in native feeds), 0.7 for opinion, 0.5 for a list of countries, 0.3 for a Top story that is not national and does not name the country.

### Pick

The best score first. Pass 1 takes 1 cluster per publisher. Pass 2 allows a second one, only to fill the list. A cluster with `rel` under 1 needs a score of 0.2 or more, so a thin pool gives fewer stories, not filler. A cluster that tells the same story as a picked cluster is skipped. The pick step is looser than the clustering: two clusters are one story when they link to the same native story through the boost, or when both are younger than 12 hours and share 2 words (Dice 0.2 or more) or a name ("Exxon" and "ExxonMobil" count as one name; place words and leaders do not count). A third story on one event (a shared capitalised name) counts at 0.6 of its score. The representative article is the NATION member with the best rank; else, among the members whose title names the country, a tier-1 member, else the newest member.

### Hybrid language (no English edition)

1. An English cluster that shares a capitalised name with a native NATION top-20 title takes that native rank (with a stoplist). This works for Latin scripts only.
2. A strong English cluster has a score of 0.45 or more, and more than 1 outlet or a native rank.
3. With 3 or more distinct strong English clusters, the list is English only.
4. Else the list is: the strong English clusters, then native clusters (with `lang`), then the other English clusters. A native story that a strong English story already tells is skipped.

### Publisher ratings

`lookupBias(domain, name)` in `bias.ts` gives an `ArticleBias` or `null`. It runs once for each picked story, before the result goes into the cache.

- **Domain.** Google: the `<source url>` attribute. NewsData: `source_url`, else the article host. Outlet feeds: the article host. A news.google.com host is never a domain.
- **Lookup order.** The host, then each parent down to the registrable domain (with a list of 2-level suffixes), each with its alias from `bias-rules.json`. A host under a "stop parent" (indiatimes.com, yahoo.com, ...) does not fall back to that parent. A host on the deny list (news.google.com, msn.com, aol.com, medium.com, wikipedia.org, facebook.com, ...), or under one (`someone.medium.com`), gets no rating. Yahoo: `news.yahoo.com` and its editions use the `yahoo.com` record; `finance.yahoo.com` gets none. A publisher name counts only when the domain is null, and only through the short allowlist `names` in `bias-rules.json`.
- **Lean** (MBFC): from `generated/mbfc.json`, which git ignores. Labels: "Left", "Lean left", "Centre", "Lean right", "Right". A record with no lean (Questionable, Satire, ...) gives no lean and no label. Factuality and "Questionable" are not shown.
- **State tag** (State Media Monitor, `state-media.json`): SC gives "STATE-CONTROLLED"; CaPu and CaPr give "CAPTURED"; IP, ISF, ISFM and ISM give "PUBLIC".
- `rater` and `ref` are null when only a state tag exists.

`bias.ts` reads the MBFC table at runtime with `readFileSync`, from a literal path. The Vercel file trace then adds the file to the function when it exists. With no file (fresh clone, tests, CI, a build with no key), every lean is null.

`scripts/build-bias.mjs` builds the table from the RapidAPI records:

- It maps the `Bias` values with a tolerant table. An unknown value gives no lean and a warning in the log.
- It drops a record whose `Source URL` has a path (`cbsnews.com/atlanta`), unless the host has no bare record and all its path records agree. `pathRecords` in `bias-rules.json` maps `www3.nhk.or.jp` to the NHK World record.
- It drops hosts on the deny list.
- When 2 or more bare records share a host, it takes the record whose slug or name fits the host label ("The Straits Times" on straitstimes.com). With no single best fit, it drops the host and logs a warning. It also warns when a single record has an extra word before the host label ("New Straits Times" on straitstimes.com).
- It logs the count of each raw `Bias` value and writes it, with the warnings, to `node_modules/.cache/worldly/mbfc-values.json`. It keeps the raw response in `mbfc-raw.json` there, so `--rebuild` can apply new rules with no request.
- `wrongRecords` in `bias-rules.json`: hosts whose record in the present table names another outlet (found on 2026-11-10 with a local comparison). `bias.ts` gives them no lean. Remove a host from the list after a rebuild shows the right record.
- It stores tuples `[name, lean, slug]`, about 0.7 MB.

### Caching

- Server memory: each list for 10 minutes. Parallel requests for one country share one run. A list with no provider, or from a run where Google gave nothing (`degraded`), stays for 60 seconds.
- Last good list: when a run is degraded or failed, the server gives the last full list of the country (at most 24 hours old) if that list is not shorter, with the failure header.
- Total failure (no source answered, no last good list): `503` with `no-store`. The CDN then serves its stale copy (`stale-if-error`), and the client shows the retry message.
- Success: `Cache-Control: public, max-age=60, s-maxage=900, stale-while-revalidate=1800, stale-if-error=86400`. Vercel removes `s-maxage` and `stale-while-revalidate` before the browser. The worst age of a list is about 55 minutes.
- Failure: `public, s-maxage=60`.
- Client (`src/main.ts`): a list stays for at most 10 minutes.

### API keys

- `NEWSDATA_API_KEY` (optional): local in `.env` (git ignores it); on Vercel under Project Settings > Environment Variables.
- `RAPIDAPI_KEY` (optional): used only by `npm run bias` at build time. On Vercel, set it for Production only.

The handler never writes a key or an upstream error body to responses or logs. `NEWS_DEBUG=1` logs the score of each picked cluster.

## Breaking news API

`GET /api/breaking` returns a `BreakingResponse` (see `src/types.ts`) with at most 3 alerts. The code is in `breaking/`. `detect()` is pure: the inputs and the time decide the output, so saved inputs replay as tests.

### Files

- `breaking/sources.ts`: the 24 feeds, Wikipedia ITN, GDACS and USGS. The parsers and `fetchInputs()`. Euronews comes from its FeedBurner copy, because `euronews.com/rss` answers 406 to a server.
- `breaking/match.ts`: the country matcher. One case-sensitive regex over `aliases.json`, longest alias first, with Unicode word boundaries. Block phrases ("Gulf of Guinea", "Indian Ocean", "New York Times") hide the country inside them. Trap rules: Georgia needs Caucasus context and no US context; Turkey the food; given names ("Jordan Davis"); a demonym before "nationals" or "tourists"; "US" in an upper-case title; plain "Congo" is DR Congo; "Paris, Texas" is the US.
- `breaking/classify.ts`: the family, the tier and the death count of one headline.
- `breaking/detect.ts`: stories, levels, follow-ups, the key and the response.
- `breaking/aliases.json`: made by `scripts/build-aliases.mjs`. Do not edit it by hand.

### Scene of the event

`primaryCountries()` scores each country in a title: 1 for a name, a demonym or a place (0.5 for a leader), plus 2 when a locative word comes before it ("in", "near", "hits", "invades", "strikes on"), plus 1 for a place. A country after the first clause break ("..., shaking felt in Greece") gets half weight and no bonus. The best country wins. Two countries on an exact tie both win (a war between two). Three or more on a tie give no country. When one story is in two countries, the detector keeps it only with the country that more headlines name alone.

These rules keep the attacker and other side countries from the scene:

- An attacker: a demonym before a strike word ("killed in Israeli strikes on Lebanon", "Russian missile strike") gets 0.1 and no bonus. So does a country joined to such a demonym ("US-Israeli attack", "US Israel Strike"). A name alone before a strike word stays the scene ("Pakistan attack kills 30"). A demonym before "forces", "troops" or "army" keeps its weight but gets no locative bonus ("Malian soldiers seize power" stays Mali).
- "London-bound", "Iran-backed", "Saudi-led", "Dubai-based", and a place before "flight" after "on" ("on London flight"), get 0.
- A dateline label before a colon ("Kyiv: Russian missile strike kills 30", "Gaza: ...") gets 1 more. The label loses its weight only when it names no event and the text after the colon names a country or a place (not only an attacker demonym). An event label ("Burkina Faso coup: Ousted ruler in Togo") keeps its country, and the countries after the colon lose their bonus.
- A speaker ("Lebanon says Israeli strikes kill 47") is removed only when the rest names a country with weight 0.5 or more. A second speaker clause ("... as Israel says ...", "..., Trump confirms") is removed.
- A given-name country ("India", "Jordan") before another capitalised word counts when that word is a country ("India Pakistan war").

### Classifier rules

- Head of state (tier 3): the country or demonym must be next to the title ("Paraguay president", "Japan's PM", "President of Paraguay"), and a death or removal verb must follow within 60 characters with no speaker verb ("says", "acknowledges", "admits") and no possessive ("Ruto's son") between. These do not count: "former", "ex-", "late", "vice", an ordinal ("39th US president"), "longest-lived", a relative ("grandson of", "mother of"), "Queen Mother", "Dowager", "consort", "King of comedy", universities, companies, clubs, banks, FIFA, leagues and unions. A name after the title that is not the current leader ("US President Jimmy Carter"), an appositive name before it ("Sirikit, Queen of Thailand") and a leader as the object of "kill" also do not count.
- A leader name or a safe surname from the alias table with a death or removal verb also counts ("Putin dies", "Peña resigns", "Pena resigns", "Xi dies", "King Charles dies"). A capitalised word before the surname that is not a title, a given name of the leader or a country makes it another person ("Eric Trump arrested", "Francesca Albanese detained"). Family names of ruling houses and common surnames are not safe ("Al Nahyan", "Traoré").
- A verb that can take an object counts only when the title ends, a punctuation mark follows, or a word such as "after", "in" or "by" follows. So "Trump toppled statue", "Trump quits Paris climate deal" and "Trump dead set on tariffs" do not count.
- Coup (tier 3): "seizes power", "military takeover", "declares a coup", "<country> coup", "coup in <country>", or a verb such as "overthrows" with a leader or a government as its object. A plot, an attempt, an accusation or a profile ("the general who seized power") is tier 1.
- War (tier 3): "invades" or "declares war on" with a country right after it; "launches an invasion of <country>"; the launch of a full-scale or ground invasion; a nuclear test. "Russia's invasion of Ukraine" and "invade Taiwan's airspace" do not count.
- Deaths: 50 or more is tier 3, 5 or more is tier 2. A year ("in 2026"), an age ("aged 5, 8 and 11", "19-year-old") and a total over weeks, since a date or for a season ("this summer", "so far this year") are not deaths. "More than 2,000 dead" is 2000. In a war, "death toll passes 70,000" does not count.
- An attack with 1 or 2 dead, with injuries only, or with one victim named by age, is tier 1. A bomb blast, a bomb attack and an explosive device are attacks, not accidents.
- A crash with a death count ("Lisbon funicular crash kills 15"), an aircraft that crashes or collides, and an airliner crash with 20 or more on board are accidents. A crash landing is not.
- A magnitude of 7 or more, or a landfall of a category 4 or 5 storm (the category before or after the verb), is tier 2. It is never tier 3 alone.
- Forecasts, plans, negations, questions, warnings, trials, court stories, films, sport and features ("How ...", "Today in History") give at most tier 1. So do de-escalation ("ceasefire", "talks") and follow-up words ("vigil", "suspect", "what we know").
- `test/breaking/traps.test.ts` holds every trap headline of the research review with its expected tier and country. `test/breaking/scenarios.test.ts` replays real headline forms of the second review (Lebanon strikes, the killing of the Iranian leader, the Air India crash, the deaths of Jimmy Carter and Queen Mother Sirikit, two attacks in Mogadishu).

### Stories

A story joins headlines of one country and kind. Two headlines join when they share 3 distinctive words or half of the shorter set, the same death toll within 12 hours, two critical-class headlines within 12 hours, or the same place (for example "mogadishu") within 12 hours. Up to 24 hours apart, the same place joins only with the same toll or 2 shared words. So an older attack in the same city does not hide a new one.

### Sources and failures

- Each request has a 2.5 s timeout and the run has a 6 s budget. The server uses `Promise.allSettled`, so a failed source gives no items.
- GDACS: `eventlist=EQ;TC;FL;VO`. Do not add `TS`: it removes events. HTTP 204 means no events. The detector reads `episodealertlevel` (the current level) and `affectedcountries`, not `alertlevel` and `iso3`.
- USGS: the significant earthquakes of the week. The PAGER level is the level, and the place text gives the country.
- ITN: the blurb date comes from the `<!--Nov 7-->` comment. It is the UTC day of the event, at 00:00, so the follow-up rule compares it with the first evidence of the story and allows 36 hours. For the follow-up rule a blurb must share a place, the toll or 2 distinctive words with the story; for support of the critical gate, 1 word is enough. The "Ongoing" list gives the chronic wars. When ITN fails, the chronic list is UKR, RUS, PSE, SDN, IRN and YEM, and two more follow-up rules apply: a story that spans more than 12 hours, or aftermath words in 2 or more outlets.
- The server logs one line with the ids of the failed sources. It never logs a URL or a body.

### Caching

- Success: `Cache-Control: public, s-maxage=300, stale-while-revalidate=900, stale-if-error=3600`.
- Fewer than half of the sources answered, or an unexpected failure: `public, s-maxage=60`.
- The server keeps a result in memory for 5 minutes (60 seconds when degraded). Parallel requests share one upstream run.
- The research review asked for `stale-if-error=900`. The shared contract of the app sets 3600, so the header keeps 3600. The handler answers 200 also when the sources fail, so `stale-if-error` applies only when the function itself fails. Then the CDN can show an old answer for at most 1 hour.
