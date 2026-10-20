## News API

`GET /api/news?country=<CountryId>` returns a `NewsResponse` (see `src/types.ts`) with up to 5 stories.

### Provider chain

The handler tries each provider in this order. When a provider gives fewer than 5 stories, the next provider adds more. The handler removes duplicate titles and URLs, and removes spam and reference pages.

1. **NewsData.io**: runs only when `NEWSDATA_API_KEY` is set. It asks for the country code with `prioritydomain=top`. If that gives no stories (or the code is not supported), it searches by the country name. Each call costs one credit (the free plan gives about 200 a day).
2. **Google News RSS**: needs no key. Countries with an English edition (IN, US, GB, AU, CA, NZ, IE, ZA, NG, KE, SG, MY, PH, PK, BW, ZW, GH, ET, UG, TZ, NA, IL) get the edition's NATION topic (domestic stories only). Other countries get a search for `"<name>"` in the last 3 days; titles that name the country come first. The feed terms allow personal, non-commercial use only.
3. **GDELT DOC 2.0**: needs no key. It allows one request every 5 seconds and often answers 429, so it is the last choice. The wait is 2 s, and after a 429 or a timeout the API skips GDELT for 2 minutes.

Each provider has a 4 second timeout. If all providers fail, the response is `200` with `articles: []` and `provider: null`.

### Caching

- The server keeps each result in memory for 3 hours. Parallel requests for one country share one upstream call. A failed result stays for 5 minutes.
- A success sends `Cache-Control: public, s-maxage=10800, stale-while-revalidate=86400`, so the Vercel CDN also keeps it. A failure sends `s-maxage=300`.

### API key

- Local: put `NEWSDATA_API_KEY=<key>` in `.env` (git ignores it). Restart `npm run dev`.
- Vercel: add `NEWSDATA_API_KEY` under Project Settings > Environment Variables. Redeploy.

The handler never writes the key or upstream error bodies to responses or logs.
