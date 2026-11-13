# Server functions

The technical reference for the two Vercel functions in `api/`. `README.md` at the repo root is the overview: the features, the owner setup (keys), the scripts and the data sources and terms. This file does not repeat them.

## News API

`GET /api/news?country=<CountryId>` returns a `NewsResponse` (see `src/types.ts`) with up to 5 stories, in score order (not in date order).

Each `NewsArticle` can also have these optional fields:

- `domain`: the publisher host, for example `theguardian.com`.
- `lang`: the BCP-47 code of the source title when it is not in English, else `null`. It stays the source language after a translation.
- `originalTitle`: the source title when `title` is a translation, else absent or `null`.
- `translatedBy`: `'DeepL'` when `title` is a translation, else absent or `null`.
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
- `rss.ts`: the RSS item parser. It keeps the feed rank, the Google outlet list in `<description>` and the `<source url>` attribute. The news plate and the breaking-news detector (cluster voices) both read the outlet list.
- `translate.ts`: the DeepL step (see "Translation"). Tests in `test/news/translate.test.ts`.
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

CJK titles use character pairs. A few synonyms count as one word ("blast" and "explosion", "step down" and "resign", "motorway" and "highway", "pile-up" and "crash"). A number in words counts as its digits ("Twelve dead" and "kills 12").

`outlets` = the distinct publishers of the members plus the outlets that Google lists for each member.

### Score

`score = rel x pen x (0.35 x S_cov + 0.30 x S_rank + 0.10 x S_auth + 0.25 x S_rec)`

- `S_cov = min(1, log2(1 + outlets) / log2(11))`.
- `S_rank = 1 / (1 + (r - 1) / 5)`, with `r` = the best of the NATION rank, the Top rank + 2 and the native boost rank. No rank gives 0.
- `S_auth` = 1 for a tier-1 outlet (wires, public broadcasters, papers of record), 0.7 for a NewsData `source_priority` of 3000 or less, else 0.4.
- `S_rec = 0.5 ^ (age in hours / 12)`, from the newest member.
- `rel` = 1 when a member is from NATION or a title names the country, a demonym, the capital or a leader (whole words). 0.3 for no match. 0 for a homonym or a longer place ("New Mexico", "Mexico, NY", "Panama City Beach", "Niger State", "Palestine Action", "Jordan Fisher", the US state of Georgia), when trap titles are as many as the titles that name the country. For Georgia, Jordan, Niger, Chad and Palestine, the bare name alone is `weak` (0.3) unless the title also has a context word (Tbilisi, EU, Amman, junta, Gaza, ...) or the search asked for the capital. Blocked phrases ("Air India") are removed as whole words, so "Repair India-made trains" still names India.
- `pen` multiplies: 0.5 for sport (also a sport publisher or a publisher name with "Rugby" or "Cricket", NFL team names, ticket items, "Ireland XV v Fiji", cricket "first Test", score lines such as "80-72 victory"), 0.5 for soft items (celebrity, tours and concerts, literary, film and music festivals, travel, consumer, market-data sites and stock notes, weather and service items in native feeds), 0.7 for opinion, 0.5 for a list of countries, 0.3 for a Top story that is not national and does not name the country.

### Pick

The best score first. Pass 1 takes 1 cluster per publisher. Pass 2 allows a second one, only to fill the list. A cluster with `rel` under 1 needs a score of 0.2 or more, so a thin pool gives fewer stories, not filler. A cluster that tells the same story as a picked cluster is skipped. The pick step is looser than the clustering: two clusters are one story when they link to the same native story through the boost, or when both are younger than 12 hours and share 2 words (Dice 0.2 or more) or a name ("Exxon" and "ExxonMobil" count as one name; place words and leaders do not count). A third story on one event (a shared capitalised name) counts at 0.6 of its score. The representative article is the NATION member with the best rank; else, among the members whose title names the country, a tier-1 member, else the newest member.

### Hybrid language (no English edition)

1. An English cluster that shares a capitalised name with a native NATION top-20 title takes that native rank (with a stoplist). This works for Latin scripts only.
2. A strong English cluster has a score of 0.45 or more, and 3 or more outlets or a native rank. A fresh story from 1 or 2 outlets scores about 0.45 on age alone, so it is not strong.
3. The distinct strong English clusters take their places first.
4. The native clusters (with `lang`) and the other English clusters compete for the other places by score. So English filler does not push out a main national story. A native story that a strong English story already tells is skipped.
5. The list is in score order, not in language order.

### Translation

`translateTitles()` in `translate.ts` runs in `build()` after the pick and before the result goes into the cache. So the clusters and the dedupe use the original titles, and only the picked stories (at most 5) go to DeepL.

- Input: the stories with a `lang`. English (`en`) and a language that DeepL does not read as a source (for example Somali `so` and Kinyarwanda `rw`) are not sent. `deeplSource()` maps a BCP-47 tag to the DeepL code (`zh-Hans` → `ZH`, `pt-BR` → `PT`, `no` → `NB`, `iw` → `HE`). The list of DeepL source languages is a constant from `GET /v2/languages?type=source` (2026-11-11).
- Request: one `POST /v2/translate` with the JSON body `{ text: [...], target_lang: 'EN-GB', source_lang }` and the header `Authorization: DeepL-Auth-Key <key>`. The host is `api-free.deepl.com` for a key that ends in `:fx`, else `api.deepl.com`. `source_lang` is set when all titles have one language; else DeepL finds the language of each title. A title that is twice in the list goes once.
- Timeout: 1.5 s, and at least 0.5 s. The whole build, translation included, ends by 5 s (`BUILD_END_MS`).
- Result: `title` becomes the English text, `originalTitle` keeps the source text, `translatedBy` is `'DeepL'`, and `lang` stays the source language. When DeepL finds English, or gives back the same text, the story stays as it is.
- Memory: each translation (key: DeepL code and original title) stays in memory, at most 2000 entries (the oldest goes first). A title in memory is not sent again.
- DeepL emphasis: DeepL can put Markdown emphasis in a title (`*The Judge*`). `stripAddedEmphasis()` removes the `*` and `_` markers that are not in the source title.
- Failure: the titles stay as they are, and the log gets one line, for example `[news] translate failed: timeout`. It never contains the key or a body. Two types of failure:
  - An error that can go away soon (timeout, network error, HTTP 429 or 5xx, bad answer). The result gets `untranslated`, so the list stays in memory for 60 s and gets the failure cache header, and a later request tries again.
  - An error that stays (HTTP 403 bad key, 456 quota used up, another 4xx). The list keeps its normal cache. After a 403 or a 456 (`[news] translate failed: http 456 (quota), paused 1 h`), the instance sends no request to DeepL for 1 hour (`PAUSE_MS`).
- With no key, nothing is sent and nothing is logged; the list keeps its normal cache.
- Last good list: a list with `untranslated` does not replace a translated last good list, so a later Google failure does not bring back the source titles.

### Publisher ratings

`lookupBias(domain, name)` in `bias.ts` gives an `ArticleBias` or `null`. It runs once for each picked story, before the result goes into the cache.

- **Domain.** Google: the `<source url>` attribute. NewsData: `source_url`, else the article host. Outlet feeds: the article host. A news.google.com host is never a domain.
- **Lookup order.** The host, then each parent down to the registrable domain (with a list of 2-level suffixes), each with its alias from `bias-rules.json`. A host under a "stop parent" (indiatimes.com, yahoo.com, ...) does not fall back to that parent. A host on the deny list (news.google.com, msn.com, aol.com, medium.com, wikipedia.org, facebook.com, ...), or under one (`someone.medium.com`), gets no rating. A blog subdomain (`blogs.timesofisrael.com`) holds user posts, so it gets no rating. Yahoo: `news.yahoo.com` and its editions use the `yahoo.com` record; `finance.yahoo.com` gets none. A publisher name counts only when the domain is null, and only through the short allowlist `names` in `bias-rules.json`.
- **Lean** (MBFC): from `generated/mbfc.json`, which git ignores. Labels: "Left", "Lean left", "Centre", "Lean right", "Right". Factuality is not shown.
- **Other class** (MBFC): a record with no lean (MBFC's Questionable, Conspiracy-Pseudoscience, Satire and Pro-Science classes) gives `lean` null, `rater` 'MBFC' and the MBFC page in `ref`. The row shows "Other class" and the MBFC link, so Fox News or Breitbart do not look unrated. The table does not keep the class, so the row does not name it. The MBFC page names it.
- **State tag** (State Media Monitor, `state-media.json`): SC gives "STATE-CONTROLLED"; CaPu and CaPr give "CAPTURED"; IP, ISF, ISFM and ISM give "PUBLIC".
- `rater` and `ref` are null when only a state tag exists.
- MBFC rates the wire services AP and AFP "Lean left" and Reuters "Centre". The app shows the MBFC values as they are.

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
- Failure, and a list whose translation failed with an error that can go away (timeout, 429, 5xx): `public, s-maxage=60`.
- Client (`src/main.ts`): a list stays for at most 10 minutes.

### Keys and logs

The keys (`NEWSDATA_API_KEY`, `RAPIDAPI_KEY`, `DEEPL_API_KEY`) are in "Owner setup" in `README.md`. The handler never writes a key or an upstream error body to responses or logs. `NEWS_DEBUG=1` logs the score of each picked cluster.

## Breaking news API

`GET /api/breaking` returns a `BreakingResponse` (see `src/types.ts`) with at most 3 alerts. The code is in `breaking/`. `detect()` is pure: the inputs and the time decide the output, so saved inputs replay as tests.

### Files

- `breaking/sources.ts`: the 24 feeds, Wikipedia ITN, GDACS and USGS. The parsers and `fetchInputs()`. Euronews comes from its FeedBurner copy, because `euronews.com/rss` answers 406 to a server.
- `breaking/match.ts`: the country matcher. One case-sensitive regex over `aliases.json`, longest alias first, with Unicode word boundaries. Block phrases ("Gulf of Guinea", "Indian Ocean", "New York Times") hide the country inside them. Trap rules: Georgia needs Caucasus context and no US context; Turkey the food; given names ("Jordan Davis"); a demonym before "nationals" or "tourists"; "US" in an upper-case title; plain "Congo" is DR Congo; "Paris, Texas" is the US.
  A second pass looks up each capitalised word that no alias covers in `places.json` (a map from the first word to the forms, longest form first; no regex). Each match has `source: 'alias'` or `source: 'gazetteer'`. The context rules for a gazetteer place, in order:
  - A sea or a cape before it ("straits of Malacca", "Gulf of Finland") rejects it.
  - A given name right before it ("Lewis Hamilton", "Charles Darwin") rejects it.
  - A `context` place (a small place, an English word, a brand or a person name: "Nice", "Mobile", "Austin") needs a strong locative word before it ("in", "near", "off", "hits"), or a comma and a place of the same country after it ("Mobile, Alabama").
  - In a Title Case title, a one-word place needs a locative word or the end of the phrase ("Brooklyn Nets" does not match).
  - In a sentence-case title, a capitalised word after it ("Brixton Academy") or before it ("Sanya Vats") rejects it, unless a locative word comes first. A landmark word after it ("Brooklyn Bridge") is no name.
  - "Brooklyn-based" and "Shibuya-style" do not match.
- `breaking/classify.ts`: the family, the tier and the death count of one headline.
- `breaking/business.ts`: the business family (`businessEvent()`): a leader event at a top company, an index crash, a giant merger, a collapse, a halt of an exchange. It also has the index, exchange and currency tables and the money parser. The module is pure. See "Business rules".
- `breaking/companies.json`: made by `scripts/build-companies.mjs` (`npm run companies:breaking`) from Wikidata (CC0) and `scripts/companies-extra.json`. Do not edit it by hand: change `companies-extra.json` and build again. Each company has its QID, its names, its home country (the country of the headquarters, P159, else P17), its current CEO and chair, its founders that are alive (each with the number of Wikipedia sitelinks), and `gsib` for a global systemically important bank. The build rules:
  - A company stays when its revenue is $30bn or more, its market value $50bn, its total assets $300bn, or $10bn with 60 sitelinks; or when it is listed on an exchange and has 25 sitelinks; or when `companies-extra.json` includes it. Values from before 2018, values with an unknown currency, and values over $6 trillion (errors in the data) do not count.
  - Dissolved companies, sports clubs, cryptocurrencies, indices, exchanges, central banks, government agencies and international organizations are out.
  - A name that `aliases.json` has (a country, a demonym, a place, a leader) is not a company name. A common English word (3esl) is a company name only when `ambiguous` in `companies-extra.json` lists it. A name of two companies stays with the larger one when both are in one country, or when it has twice the sitelinks; else both lose it. A curated name (`names` in `companies-extra.json`) wins: "Merck" is Merck & Co., not Merck KGaA. The suffix strip also removes the "&" or "and" before the suffix ("Merck & Co." gives "Merck", "Eli Lilly and Company" gives "Eli Lilly").
  - A person at two companies stays with the larger one. The detector joins the leader headlines of one person (see "Business rules").
  - `mustHave` in `companies-extra.json` lists top companies with the name that headlines use. The build stops before the write when one is missing. Some items are services, not companies (Netflix Q907311 is the streaming service; the company is Q116452644), so `include` names the company item.
  - The people query drops a person with any ended term of the role, also when a later term goes on (Sam Altman at OpenAI). `people` in `companies-extra.json` adds such a person.
  - Many Wikidata items now have a `mul` label and no `en` label, so the build reads both. The Kingdom of the Netherlands (Q55) has no ISO code, so the build maps it to NLD.
  - The build prints a diff: new and removed companies, and each change of CEO. Read it before you commit.
- `breaking/detect.ts`: stories, levels, follow-ups, the life of an alert (`lifeOf()`), the article of the chip (`pickArticle()`), the key and the response. `detect()` is pure: the state is an argument and a result.
- `breaking/state.ts`: the detector state between runs. It checks a stored state (also a state from before the life rules: a missing field gets its default) and reads and writes it in the Vercel Runtime Cache.
- `breaking/aliases.json`: made by `scripts/build-aliases.mjs` (`npm run aliases:breaking`). Do not edit it by hand.
- `breaking/places.json`: the place gazetteer, made by `scripts/build-places.mjs` (`npm run places:breaking`) from GeoNames (CC BY 4.0). Do not edit it by hand. Each form belongs to one country, in one class: `major` (1 million people or more, or 2 or more words), `place`, or `context`. `given` lists given names for the person-name rule. The build rules:
  - A form stays only when its country has 10 times the population of the same form in every other country. A region or a suburb counts at one third of its population. So "Birmingham", "Victoria" and "Valencia" are not in the file.
  - A Natural Earth sea, range, desert or far-away feature with the same name removes the form ("Andes", "Samar").
  - Continents, months, peoples ("Naga"), royal titles ("Prince George") and generic words ("Gulf", "Free") never become forms.
  - A form that `aliases.json` has stays with `aliases.json`. The curated table is the manual override.
  - A place under 100,000 people (50,000 for a city district) must have a unique name, and is `context`. A one-word form that is an English word (3esl), a brand, a given name (Wikidata) or a frequent surname (US Census 2010) is `context`. An old name ("Bombay", "Romanov" for Murmansk) is `context`. The short name of a county or district with no type word ("Hennepin") is `context`, unless a city of the same country has the name too (Venice).

### Scene of the event

`primaryCountries()` scores each country in a title: 1 for a name, a demonym or a place (0.5 for a leader), plus 2 when a locative word comes before it ("in", "near", "hits", "invades", "strikes on"), plus 1 for a curated place. A gazetteer place gets 1, and 2 more after a locative word, but no place bonus: a curated country name or dateline wins over it ("Scotland: ... Hampden victory"). `classify()` ignores gazetteer places, so a city never makes a party to a war, a coup or a strike ("Tourists invade Venice"). A gazetteer place does not demote a dateline label before a colon. A country after the first clause break ("..., shaking felt in Greece") gets half weight and no bonus. The best country wins. Two countries on an exact tie both win (a war between two). Three or more on a tie give no country. When one story is in two countries, the detector keeps it only with the country that more headlines name alone.

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
- Press reviews ("The Papers: ...", "Thursday briefing: ...") give no classification. They quote the headlines of other stories.
- `test/breaking/traps.test.ts` holds every trap headline of the research review with its expected tier and country. `test/breaking/scenarios.test.ts` replays real headline forms of the second review (Lebanon strikes, the killing of the Iranian leader, the Air India crash, the deaths of Jimmy Carter and Queen Mother Sirikit, two attacks in Mogadishu, and the Kaziranga bus crash with its Google cluster). `test/breaking/cluster.test.ts` holds the cluster-voice traps.

### Business rules

`businessEvent()` in `business.ts`, owner decision of 2026-11-13 ("a top company's CEO leaves, a market crash, a giant merger or collapse"). The constants are in `BUSINESS_CONFIG`. A business story is `major` with tier 2, 4 or more outlets (`CONFIG.businessOutlets`, one more than other kinds) and a lead or an edition. Tier 3 goes through the normal critical gate. Out of scope: global IT outages, central-bank chiefs, currencies, sovereign defaults, IPOs, valuations and the stock of one company.

- The country is the home country of the company, or the country of the index or the exchange. It is never the country that the title names: "Nvidia CEO quits over affair with Chinese spy" is a US story. A leader of a company who is shot, stabbed or murdered is an `attack` in the country of the scene (else the home country).
- The subject is the QID of the company (`Q182477`), `mkt-<country>` for an index or an exchange (all indices of one country are one market story), or `x-<name>` for a failed firm that is not in the list. Headlines of two subjects never join one story.
- Leader (tier 2): a role word right after a company name ("Nvidia CEO Jensen Huang resigns", "Nvidia's chief quits"), "<Co> fires CEO", "<Name> resigns as <Co> CEO" or "as CEO of <Co>", "<Co>'s <Surname> quits", or a current CEO, chair or founder by full name ("Warren Buffett dies"). A name alone counts only for a person with 25 or more sitelinks, and a founder only of a company of $100bn or more. "president" counts only for companies in Japan, Korea, Taiwan, China and Hong Kong, where the president is the chief executive. A founder who resigns is tier 1, unless the title states the role ("resigns as CEO"). Tier 1: a former, interim, acting, ousted or new leader; a board seat; a plan ("to step down", "to retire", "next year"), unless "with immediate effect"; a verb with an object ("quits Trump administration", "removed posts").
- Leader traps (no leader event): a departure from a role outside the company. After the verb, "from <X>" counts only when X is the company, a word for the post ("office", "post", "role") or nothing; "as <role> of <X>" counts only when X is a company. So "Elon Musk steps down from DOGE" and "Jensen Huang steps down as chair of White House AI council" give no event. A sport word in the title ("team principal", "F1", "Grand Prix", "Racing") stops each leader event, and `block` holds team phrases ("Red Bull boss", "Aston Martin boss"). A loose role ("boss", "chief", "head") with a full name counts only when the name is a listed person of the company ("Mercedes boss Toto Wolff" is the team principal).
- The person: a leader event keeps the listed person that the title names. In `splitStories()`, two leader headlines of one person within 12 hours join, also with two subjects. So "Elon Musk resigns" (SpaceX in the data) joins "Elon Musk steps down as Tesla CEO", and the story takes the subject of most strong headlines.
- Crash: the `INDICES` table (an index, its country, an approximate level, and the fall that is major). A fall in percent, or in points over the level, after the index: 10% or more is tier 3, the major fall of the index (5% to 7%) is tier 2, 3% is tier 1. A record ("worst day since 1987") or a circuit breaker with the index is tier 2. A fall over many sessions is tier 1 at most: a span right after the amount ("from its record high", "since ...", "in a week", "in five sessions", "in October", "this year") or anywhere in the title ("correction", "bear market", "from its peak"), unless the title says one session ("in a single day", "intraday"). A record keeps tier 2 ("worst week since 2008"). A number after "below", "to" or "at" is a level, not a fall. Futures, pre-market, "could", "fears" or a question in the main clause give tier 1. A rebound gives tier 1.
- Merger: a merger verb, a listed company, and $50bn or more (tier 2; $20bn tier 1). Talks, a bid, an approval, a completion, a rejection or a hostile offer give tier 1. The country is the home country of the buyer.
- Collapse: the company right before a bankruptcy or collapse verb ("Evergrande files for bankruptcy", "UBS collapses"), or a rescue. Tier 3 for a G-SIB bank, else tier 2. A firm that is not in the list needs a record ("biggest US bank failure since 2008").
- Halt: an exchange that halts all trading, trading halted on an exchange, or a market-wide circuit breaker (tier 2). A halt of one stock gives no event.
- Support (tier 1): a company and a business word ("shares", "CEO", "resignation", "takeover"). The headline counts as a voice of the story of the company, but it never starts an alert.
- An ambiguous name ("Apple", "Shell", "Meta") counts for a merger, a collapse or support only with a legal suffix or a business word within 4 words. A merger with a second named company is enough context ("Shell to buy BP").
- Demotions: the general demotions (`NOT_EVENT`, "may", a feature start) apply to the main clause only (`mainClause()`: no reason clause after "over", "after", "as" and similar words, no text after ";" or a dash, no short label before a colon). So "arrested over alleged fraud" stays an arrest. The generic de-escalation and aftermath words do not apply ("halts" and "resigns" are business events). `BIZ_AFTERMATH` (testimony, a successor, a reaction of shares or markets, "what's next") and features, questions and market digests ("Morning Wrap") give tier 1.
- In `detect.ts`: the no-ITN aftermath rule counts `BIZ_AFTERMATH`, not `AFTERMATH`. The chronic gate does not apply. One alert per country: a business story comes after every other kind at the same level, so it never pushes a deadly event off the list. Business words ("ceo", "resigns", "shares", "billion") are generic story words, so two CEO stories in one country stay apart.
- `test/breaking/business.test.ts` holds the real Nvidia saga titles of 2026-11-12 and 2026-11-13, with the positives and traps. `test/breaking/business-detect.test.ts` replays `fixtures/scenarios/nvidia-ceo.json`.

### Stories

A story joins headlines of one country and kind. Two headlines join when they share 3 distinctive words or half of the shorter set, the same death toll within 12 hours, two critical-class headlines within 12 hours, or the same place (for example "mogadishu") within 12 hours. Up to 24 hours apart, the same place joins only with the same toll or 2 shared words. So an older attack in the same city does not hide a new one. `placeKeys()` gives one key to the curated and gazetteer forms of one place (`CANONICAL_PLACE` in `match.ts`: "Washington", "Washington DC", "D.C." give "washington dc"; "Washington state" stays apart).

### Life of an alert

`lifeOf()` in `detect.ts`. The constants are in `CONFIG`. Terms, per story:

- A strong item has tier 2 or more. A placed item is in the top 3 of a front page or the top 12 of a Google News edition. A fresh item has a date and is at most 6 hours old (`freshHours`); an undated item is never fresh. A junk item (`isJunk()`: a live blog, a video clip, an aggregator copy) is never a fresh item for the pulse, the 2-hour hold or a new wave. The chip skips the same items, so the pulse and the chip use the same items.
- `freshLeads`: the voices with a strong, placed and fresh item that is not junk. `windowVoices`: the voices with a strong item in the 12-hour window. The pulse is `freshLeads >= 1` and `windowVoices >= 2`. Cluster voices do not count for the pulse.
- Cluster voices (`clusterVoices()`, `Candidate.cluster`): `parseFeed()` keeps the other outlets that Google lists in the `<description>` of a Google News item (`RssItem.outlets` from `rss.ts`, the list of the news plate) as `Headline.cluster`, at most 4 (`CLUSTER_MAX`), without the publisher of the item. A strong, placed and fresh Google News item that is not junk adds its cluster to its story, the top item first. Only a story with victims gets cluster voices: an agreed toll of 5 or more (`clusterMinDeaths`), tier 3 or a matching hazard. A war story (`Candidate.war`) gets none, so the daily strikes of a war that is not chronic do not alert with 2 feed voices. An outlet with a headline in the story, or in an earlier cluster, counts once (`outletKey()`). An aggregator, a platform (`isPlatform()`), a press-release wire (`isPressRelease()`) or an official source (`NOT_OUTLET`: a government, a police force, a company newsroom) is no voice. A story gets at most 3 (`clusterVoicesMax`). Cluster voices count for the major bar ("major, cluster voices") and `outlets` of the response (feed voices plus cluster voices). They do not count for the agreed tier and toll, the critical gates, the business bar, the pulse, `freshLeads`, `freshVoices`, the chronic gate, a new wave or the score. The agreed tier needs 2 feed voices, so one Google item with a large cluster gives no alert. The chip article does not change. A fixture row can keep the cluster as a 6th value; the fixtures before 2026-11-13 have none.
- A new wave against a set of known item hashes: 3 or more voices (`waveVoices`) with fresh strong items that are not in the set, and one of these items is placed. An outlet that gives an old link a new date does not make a new wave.
- An escalation against the peak of the story: a higher agreed tier (a red GDACS or PAGER level gives tier 3), an agreed toll of at least `max(2 × peak, peak + 20)`, or an ITN development. ITN often posts an event on the next day, so a strictly matching blurb of the last 36 hours, dated on a later UTC day than the start of the wave and the first alert, is a development only when it tells more than the story showed: a higher tier or toll than the peak, or 2 shared words with a fresh strong headline that is not in the known hashes (`waveIds` of a live alert, `itemIds` of an ended story). An ended story also needs such a headline.

The rules, after `matchEntry()` finds the live entry (or else the ended entry) of each story:

- A new story: the full test, the chronic gate, the follow-up rules (ITN, and with no ITN the span and the aftermath rules), and the pulse ("stale: no fresh lead headline"). A story whose first evidence is more than 24 hours old also needs a new wave.
- A live alert: the chronic gate, the ITN follow-up rule (against the first evidence of the entry, and not when the story is larger than the blurb) and the aftermath rule with no ITN end it. The span rule does not apply: a long alert always spans more than 12 hours. With no pulse it ends ("ended: no fresh lead headline"), except in the first 2 hours, where one voice with a fresh strong item holds it. After 24 hours (`waveHours`) from the start of the wave, it needs an escalation, or a new wave against the hashes at the start of the wave while it is less than 72 hours (`storyCapHours`) from the first alert. Else it ends ("ended: wave over 24 h", "ended: story over 72 h"). A live alert that fails the full test is held as `major` ("held: fresh lead").
- An ended story (in the state for 48 hours, `endedHours`): the full test, the pulse, and an escalation or a new wave against all its known hashes (less than 72 hours from the first alert). It comes back with the same key and `since` ("renewed: ...").
- The chronic gate (conflict and attack): a country on the ITN "Ongoing" list (or the fallback list), or for war coverage a recurring war: conflict alerts started on 2 or more UTC days (`chronicDays`) of the 7 days (`historyDays`) before the first alert of the story. War coverage (`Candidate.war`) is a conflict story, or an attack story where at least half of the strong voices name another country as the attacker (`attackerCountries()`: "Israeli attack on Gaza"). The start of a war attack is stored as a conflict start. A terror bombing or a mass shooting is not war coverage. The start days of the story itself do not count. A chronic story is `major` only with an escalation (tier 3, 6 voices, 3 editions), a fresh wave (6 voices with fresh strong items, 3 fresh leads, and 20 dead or tier 3), or a strictly matching ITN blurb of the last 36 hours plus a new wave (for a live alert: plus the pulse).
- `matchEntry()`: a shared item hash needs no time check, so a story that lasts more than 48 hours keeps its entry when its oldest items leave the lookback. A match by 2 shared words only needs the same key, or a story that starts at most 24 hours before the stored first evidence and at most 24 hours after it (a live entry) or after the end (an ended entry).
- An alert that passes the rules but is not on the list (one per country, at most 3) leaves the state. A live alert whose story ended, or whose story is gone, goes to `ended`.

### The article of the chip

`pickArticle()` returns one item, and `articleOf()` gives `headline`, `url`, `source` and `publishedAt` from that item only. No other code sets these fields.

1. Junk items (`isJunk()`: live blogs, video clips (`/video/`, `/videos/`, BBC `/av/`, `/watch`, YouTube, a "Video:" or "Watch:" title) and aggregators (Yahoo, MSN, AOL, NewsBreak, ...)) are out when another item exists.
2. The first group that is not empty: items at the agreed tier (at least 2) that are placed and fresh, then any strong item that is placed and fresh, then the same two that are fresh, then the same two of any age, then the rest in the same order. An aftermath, feature or opinion headline is tier 1, so it comes last.
3. The items at most 1.5 hours (`pickSlackHours`) older than the newest item of the group. Of these, the items with the agreed toll, when any.
4. The article of the last run (`pickId` in the state), when it is still one of them. So the chip changes only when an article more than 1.5 hours newer comes, or when the old article drops out.
5. Else: a trusted outlet (the front-page outlets of `FEEDS`, AP, Reuters, AFP), a direct link (not a Google News item), no paywall (NYT, WSJ, FT, Telegraph, The Times, Washington Post, Bloomberg, The Australian, The Economist), the newer, the higher position, then the order of `FEEDS`.

### Sources and failures

- Each request has a 2.5 s timeout and the run has a 6 s budget. The server uses `Promise.allSettled`, so a failed source does not stop the run.
- A failed source gives its last good answer when that answer is at most 30 minutes old (`LAST_GOOD_MAX_MS`, `mergeLastGood()` in `sources.ts`), else no items. The module keeps the last good answers in memory only: all of them are about 280 KB, too large for a write to the Runtime Cache on each run. `sources.ok` counts live answers only, so the degraded rule stays true. `sources.reused` (only when more than 0) counts the reused answers. The client ignores both.
- GDACS: `eventlist=EQ;TC;FL;VO`. Do not add `TS`: it removes events. HTTP 204 means no events. The detector reads `episodealertlevel` (the current level) and `affectedcountries`, not `alertlevel` and `iso3`.
- USGS: the significant earthquakes of the week. The PAGER level is the level, and the place text gives the country.
- ITN: the blurb date comes from the `<!--Nov 7-->` comment. It is the UTC day of the event, at 00:00, so the follow-up rule compares it with the first evidence of the story and allows 36 hours. For the follow-up rule a blurb must share a place, the toll or 2 distinctive words with the story; for support of the critical gate, 1 word is enough. The "Ongoing" list gives the chronic wars. When ITN fails, the chronic list is UKR, RUS, PSE, SDN, IRN and YEM, and two more follow-up rules apply: a new story that spans more than 12 hours, or aftermath words in 2 or more outlets.
- The server logs one line with the ids of the failed sources. It never logs a URL or a body.
- User-Agent: `BREAKING_USER_AGENT` replaces the default for all requests. `BREAKING_CONTACT` is added to the Wikipedia request only (see "Owner setup" in `README.md`).

### Caching

- Success: `Cache-Control: public, s-maxage=300, stale-while-revalidate=900, stale-if-error=3600`.
- Fewer than half of the sources answered, or an unexpected failure: `public, s-maxage=60`.
- The server keeps a result in memory for 5 minutes (60 seconds when degraded). Parallel requests share one upstream run.
- The detector state (`BreakingState`) is in module memory. It holds:
  - `alerts`: per live alert the key, country, kind, level, first evidence (`since`), first alert time, last qualified time, the start of the wave (`waveAt`), the wave count, the peak tier and toll, the identity of the story (up to 40 short hashes of item URLs and up to 20 distinctive words), the hashes at the start of the wave (`waveIds`, up to 20) and the hash of the article of the chip (`pickId`).
  - `ended` (optional): up to 10 stories that ended in the last 48 hours, with the key, country, kind, first evidence, first alert, wave, end time, peak and identity.
  - `starts` (optional): up to 60 entries `PSE|conflict|20261112`, the UTC days on which an alert started or renewed (kept for 10 days), for the recurring-war rule.

  The state stays `v: 1`. Every new field is optional in a stored state, so a state from before the life rules still reads: the wave starts at the first alert, the peak tier comes from the level, and `waveIds` are the item hashes. The key is the same for all stories of one country, kind and day, so `matchEntry()` in `detect.ts` finds the story of an entry by a shared item hash, or by a headline that shares 2 words with the stored words. On Vercel (`VERCEL=1`), the server also writes the state to the Runtime Cache (`getCache()` from `@vercel/functions`, key `breaking-state-v1`, TTL 26 hours) after each run that is not degraded. It reads the cache at the start of each run, while the sources load, and merges the cache copy and the memory copy entry by entry (`mergeStates()` in `state.ts`): an alert that only one copy has stays when the two copies are at most 15 minutes apart; ended stories and start days are joined, and a live entry of a story wins over an ended entry. The Vercel client does not throw: on a failure (also its own 500 ms timeout) it logs the error object with `console.error` and gives null, so a failed read and a missing entry look the same. That error object names the address of the cache endpoint, but not the headers or the state. For this reason a run with no memory state and a null read ("blind") does not write a state with no alerts: such a write could remove the alerts of the other instances. When the cache loses the state, the memory of ended stories and recurring wars is lost, and those rules fail open. `state.ts` logs a short reason only for a store that throws (not the Vercel client) and for an invalid entry, never the state. The state is at most about 10 KB.
- The research review asked for `stale-if-error=900`. The shared contract of the app sets 3600, so the header keeps 3600. The handler answers 200 also when the sources fail, so `stale-if-error` applies only when the function itself fails. Then the CDN can show an old answer for at most 1 hour. The client drops an alert with no evidence in the last 24 hours, so an old answer cannot show a stale alert for long.

### Key and client

The `key` is `<country>-<kind>-<YYYYMMDD of since>` when the story first alerts. A business key ends with the subject (`USA-business-20261112-Q182477`), and the alert has `subject`, because one country can have two business stories on one day. The state keeps the key and `since` for the life of the story, also when its first headline leaves the feeds and when the story comes back with a new wave. With no state, in one rare case the key moves to the next day at 00:00 UTC (step 9 of "Breaking news" in `README.md`). `publishedAt` is the date of the article of the chip (null when it has no date). An older server sends no `publishedAt`; then `articleTime()` gives `since`, and the chip shows the age as before. The client (`src/ui/alerts-model.ts`) handles the key move and the flapping near the threshold:

- `sameStory()`: the same key, or the same country and kind with `since` values less than 24 hours apart. Two alerts with different `subject` values are two stories. A stored story with no subject (from before the business kind) keeps the rule of the country and kind. The dismiss and announce sets (`StorySet`) use this rule, and they add the new key, so a second move is also known.
- `holdDropped()`: an alert that is not in a good poll stays on screen for one more poll. A failed poll changes nothing.
- `visibleAlerts()`: an alert whose article is more than 8 hours old (`STALE_ARTICLE_MS`) does not show, also when its evidence is newer.
- The chip, its `+N` rows and the news-plate row show the age of the article (`articleTime()`). The labels add "First reported ..." (`firstReportedWords()`) when `since` is 1 hour or more before the article.
