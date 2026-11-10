## News API

`GET /api/news?country=<CountryId>` returns a `NewsResponse` (see `src/types.ts`) with up to 5 stories.

### Provider chain

The handler tries each provider in this order. When the list holds fewer than 5 stories, the next provider adds more.

1. **Google News edition**: needs no key. A country with an English edition (IN, US, GB, AU, CA, NZ, IE, ZA, NG, KE, SG, MY, PH, PK, BW, ZW, GH, ET, UG, TZ, NA, IL) gets the edition's NATION topic (national stories only). Other countries skip this step without a request.
2. **NewsData.io**: runs only when `NEWSDATA_API_KEY` is set. Every call has `qInTitle="<name>"` and `language=en`, so each title names the country.
   - Call 1 adds `prioritydomain=top` (the top 10% of domains).
   - Call 2 runs only when call 1 gives fewer than 3 usable stories. It drops `prioritydomain`.
   - The provider does not use the `country` filter. That filter matches the publisher's country, not the subject: `country=cn` gave stories about other topics from Asian outlets.
   - The provider removes titles that name only a longer place ("Inner Mongolia" for Mongolia, "Papua New Guinea" for Guinea).
   - Each call costs one credit (the free plan gives about 200 a day). The server logs one line per call (`[news] newsdata call: prioritydomain+qInTitle`), without the key or the URL.
3. **Google News search**: needs no key. A search for `"<name>"` in the last 3 days. Titles that name the country come first. The feed terms allow personal, non-commercial use only.
4. **GDELT DOC 2.0**: needs no key. It allows one request every 5 seconds and often answers 429, so it is the last choice. The wait is 2 s, and after a 429 or a timeout the API skips GDELT for 2 minutes.

Each request has a 4 second timeout. Each provider has an 8 second budget. If all providers fail, the response is `200` with `articles: []` and `provider: null`. `provider` names the provider that gave the most stories.

### Filters

`addDistinct` in `news.ts` applies these filters to every story, across all providers:

- It drops repeated URLs and repeated titles.
- It drops a near-duplicate: a title whose word set has a Jaccard similarity of 0.6 or more with an earlier title. The words are lowercase, without accents, punctuation or stopwords (`titleTokens` in `text.ts`).
- It keeps at most 2 stories from one publisher. "The Hindu" and "thehindu.com" are one publisher (`publisherKey`).
- It drops press-release wires: Business Wire, PR Newswire, GlobeNewswire, ACCESSWIRE, EIN Presswire and others (`isPressRelease`).
- It drops spam streams, reference pages, course adverts and directory pages (`isJunk`).

### Caching

- The server keeps each result in memory for 3 hours. Parallel requests for one country share one upstream call. A failed result stays for 5 minutes.
- A success sends `Cache-Control: public, s-maxage=10800, stale-while-revalidate=86400`, so the Vercel CDN also keeps it. A failure sends `s-maxage=300`.

### API key

- Local: put `NEWSDATA_API_KEY=<key>` in `.env` (git ignores it). Restart `npm run dev`.
- Vercel: add `NEWSDATA_API_KEY` under Project Settings > Environment Variables. Redeploy.

The handler never writes the key or upstream error bodies to responses or logs.

## Breaking news API

`GET /api/breaking` returns a `BreakingResponse` (see `src/types.ts`) with at most 3 alerts. The code is in `breaking/`. `detect()` is pure: the inputs and the time decide the output, so saved inputs replay as tests.

### Files

- `breaking/sources.ts`: the 23 feeds, Wikipedia ITN, GDACS and USGS. The parsers and `fetchInputs()`.
- `breaking/match.ts`: the country matcher. One case-sensitive regex over `aliases.json`, longest alias first, with Unicode word boundaries. Block phrases ("Gulf of Guinea", "Indian Ocean", "New York Times") hide the country inside them. Trap rules: Georgia needs Caucasus context and no US context; Turkey the food; given names ("Jordan Davis"); a demonym before "nationals" or "tourists"; "US" in an upper-case title; plain "Congo" is DR Congo; "Paris, Texas" is the US.
- `breaking/classify.ts`: the family, the tier and the death count of one headline.
- `breaking/detect.ts`: stories, levels, follow-ups, the key and the response.
- `breaking/aliases.json`: made by `scripts/build-aliases.mjs`. Do not edit it by hand.

### Scene of the event

`primaryCountries()` scores each country in a title: 1 for a name, a demonym or a place (0.5 for a leader), plus 2 when a locative word comes before it ("in", "near", "hits", "invades", "strikes on"), plus 1 for a place. A country after the first clause break ("..., shaking felt in Greece") gets half weight and no bonus. The best country wins. Two countries on an exact tie both win (a war between two). Three or more on a tie give no country. When one story is in two countries, the detector keeps it only with the country that more headlines name alone.

### Classifier rules

- Head of state (tier 3): the country or demonym must be next to the title ("Paraguay president", "Japan's PM", "President of Paraguay"), and a death or removal verb must follow within 60 characters with no speaker verb ("says") between. "Former", "ex-", "late", "vice", universities, companies, clubs, banks, FIFA, leagues and unions do not count. A leader name or a safe surname with "dies", "killed" or "assassinated" also counts ("Putin dies").
- Coup (tier 3): "seizes power", "military takeover", "declares a coup", "<country> coup", or a verb such as "overthrows" with a leader or a government as its object. A plot, an attempt or an accusation is tier 1.
- War (tier 3): "invades", "declares war on" or "invasion of" with a country right after it; a full-scale or ground invasion; a nuclear test.
- Deaths: 50 or more is tier 3, 5 or more is tier 2. A year ("in 2026") and an age ("aged 5, 8 and 11") are not deaths. "More than 2,000 dead" is 2000.
- A magnitude of 7 or more, or a landfall of a category 4 or 5 storm, is tier 2. It is never tier 3 alone.
- Forecasts, questions, warnings, trials, films and sport give at most tier 1. So do de-escalation ("ceasefire", "talks") and follow-up words ("vigil", "suspect", "what we know").

### Sources and failures

- Each request has a 2.5 s timeout and the run has a 6 s budget. The server uses `Promise.allSettled`, so a failed source gives no items.
- GDACS: `eventlist=EQ;TC;FL;VO`. Do not add `TS`: it removes events. HTTP 204 means no events. The detector reads `episodealertlevel` (the current level) and `affectedcountries`, not `alertlevel` and `iso3`.
- USGS: the significant earthquakes of the week. The PAGER level is the level, and the place text gives the country.
- ITN: the blurb date comes from the `<!--Nov 7-->` comment. The "Ongoing" list gives the chronic wars. When ITN fails, the chronic list is UKR, RUS, PSE, SDN, IRN and YEM, and two more follow-up rules apply: a story that spans more than 12 hours, or aftermath words in 2 or more outlets.
- The server logs one line with the ids of the failed sources. It never logs a URL or a body.

### Caching

- Success: `Cache-Control: public, s-maxage=300, stale-while-revalidate=900, stale-if-error=3600`.
- Fewer than half of the sources answered, or an unexpected failure: `public, s-maxage=60`.
- The server keeps a result in memory for 5 minutes (60 seconds when degraded). Parallel requests share one upstream run.
