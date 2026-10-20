# Worldly

Worldly is a 3D globe in the browser. Drag the globe to spin it on any axis. Hover a country to raise it. Click the country to see its facts on the right and its top 5 news stories on the left. A story opens in a new tab.

Built with Vite, TypeScript and three.js. There is no UI framework.

## Run locally

Use Node 22 or later.

```sh
npm install
npm run dev
```

Open http://localhost:5173. The dev server also runs the `api/` handlers, so news works locally.

Other commands:

- `npm run typecheck`: check the types.
- `npm run build`: check the types and build to `dist/`.
- `npm run preview`: serve the build. The preview does not run `api/`, so news does not load there.

A link to a country uses its ISO alpha-3 code, for example `/#JPN`.

## News API key (optional)

Worldly works with no key. It then gets news from Google News RSS, and from GDELT when Google fails.

For better country coverage, add a NewsData.io key. The free plan gives about 200 credits a day. Worldly uses NewsData.io instead of NewsAPI.org, because the NewsAPI.org free plan works only on localhost.

1. Get a free key at https://newsdata.io/register.
2. Copy `.env.example` to `.env`.
3. Set `NEWSDATA_API_KEY=<your key>` in `.env`.
4. Restart `npm run dev`.

The server caches each country's news for 3 hours, and the Vercel CDN caches it too. One country costs about one credit every 3 hours. The key stays on the server. See `api/_lib/README.md` for the provider chain.

## Refresh the country data

```sh
npm run data
```

The script takes 3 to 4 minutes. It writes `public/data/world.json`, `public/data/countries.json` and `api/_lib/countries.json`. Leaders come from live Wikidata. Check the `GOVERNMENT_OVERRIDES` list in `scripts/build-data.mjs` after a run.

## Deploy to Vercel

1. Push the repo to GitHub.
2. Import the repo in Vercel. Vercel detects Vite. The build command is `npm run build` and the output folder is `dist`.
3. Optional: add `NEWSDATA_API_KEY` under Project Settings > Environment Variables.
4. Deploy. Vercel runs `api/news.ts` as a serverless function.

## Data sources and terms

- Country shapes: [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth, public domain).
- Country facts: [mledoze/countries](https://github.com/mledoze/countries) (ODbL), [Wikidata](https://www.wikidata.org) (CC0), [World Bank Open Data](https://data.worldbank.org) (CC BY 4.0) and the IANA time zone database.
- Flags: [flagcdn.com](https://flagcdn.com) and Wikimedia Commons.
- News:
  - [NewsData.io](https://newsdata.io): follow its terms for your plan.
  - Google News RSS: the feed terms allow personal, non-commercial use only. Use a NewsData.io key or another licensed source for a public or commercial site.
  - [GDELT](https://www.gdeltproject.org): free to use with attribution.

Worldly links each story to the publisher. It does not copy article text.
