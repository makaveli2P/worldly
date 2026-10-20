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
