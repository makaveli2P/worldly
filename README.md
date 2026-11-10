# Worldly

Worldly is a 3D globe in the browser. The globe spins slowly until you drag it, hover a country or select a country. Click a country to raise it. Its facts open in a plate on the left and its top 5 news stories open in a plate on the right. A story opens in a new tab.

Built with Vite, TypeScript and three.js. There is no UI framework.

## Features

- **Satellite map (default).** The globe uses the NASA Blue Marble image (`public/textures/earth-4k.jpg`, 4096x2048, about 1.1 MB). The page loads the image only when the satellite style is on.
- **Atlas map.** Flat land fills, a 15° graticule and a 1px limb. The selected country is solid red.
- **Light and dark themes.** The theme follows `prefers-color-scheme`. The sun/moon button in the header sets a theme and keeps it. Both map styles work in both themes.
- **Always-on labels.** Country names (uppercase) and capitals (small square and name) stay on the globe with no hover. The overlay hides labels on the far side, fades them near the limb, and stops labels from overlapping. Zoom in to see more countries. The selected country always has a label.
- **Leader lines.** Lines with a 45° elbow join the selected country to the inner edge of each panel. The lines follow the globe while it moves. The lines are white over the satellite globe and ink elsewhere.
- **Instrument readout.** `LAT / LON / ALT / SEL` at the bottom of the screen show the centre of view, the camera altitude and the selected country.
- **Mobile (< 768px).** A bottom sheet with `Overview | News` tabs. The first tap raises a country, and the second tap opens it. One short leader line goes into the sheet.
- **Keyboard.** Press `/` to search. Press `Esc` to close the selection. The map style toggle is a radio group (arrow keys).
- **Links.** A link to a country uses its ISO alpha-3 code, for example `/#JPN`.

## Design

The design is "Swiss / instrument". The reference mockup is in `mockups/swiss/`. The mockups are not part of the build.

- Type: Inter Tight (400/500/600) for text, JetBrains Mono for all figures. The fonts are local files in `src/assets/fonts/`.
- Grid: 8px.
- Colours: one accent, Swiss red. The tokens are CSS custom properties on `:root[data-theme=light|dark]` in `src/styles.css`. The globe colours come from `src/theme.ts`. Keep the two files in step.

| Token | Light | Dark |
| --- | --- | --- |
| paper | `#F4F4F1` | `#0E0E0E` |
| panel | `#FFFFFF` | `#161616` |
| ink | `#111111` | `#F2F2EE` |
| rule | `#DCDCD7` | `#2A2A2A` |
| muted | `#5C5C58` | `#9A9A94` |
| accent | `#E5361B` | `#F24B2F` |

## Preferences

The page keeps two values in `localStorage`:

- `worldly:style`: `satellite` (default) or `atlas`.
- `worldly:theme`: `light` or `dark`. With no value, the theme follows the system setting.

A small script in `index.html` applies both values before the first paint.

## Code map

- `src/main.ts`: loads the data and joins the globe, overlay and panels.
- `src/globe/`: the three.js globe (`Globe.ts`), its shaders, controls and picker.
- `src/overlay/`: labels and leader lines (DOM and SVG over the canvas).
- `src/ui/`: the header, search, panels, readout and preferences.
- `src/theme.ts`: light and dark palettes for the UI and the globe.
- `api/`: the news function (Vercel serverless).

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

## News

`GET /api/news?country=<ISO3>` returns up to 5 stories, in order of importance. The server starts all sources at the same time and uses what arrives in 3 seconds:

1. Google News edition (no key): the national stories (NATION) and the front page (Top stories) of the country's English edition.
2. Google News search (no key): English titles that name the country, from the last day.
3. Front-page feeds of 11 outlets (no key): BBC, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India and The New York Times. Only titles that name the country count.
4. Native edition (no key): for a country with no English edition, the national stories in the country's language.

The server groups the stories of all feeds into clusters (one cluster for each event). It gives each cluster a score from the number of outlets, the rank in Google's national feed, the outlet type and the age. It lowers the score of sport, celebrity, opinion and market-data items. Then it picks 5 clusters, with 1 story for each publisher on the first pass.

A country with no English edition (for example Germany, Japan or Mexico) gets English stories first. An English story that names a person or place from the native top 20 gets that native rank. A native-language story fills the list only when fewer than 3 English stories are strong. It has a language tag (for example "DE").

NewsData.io is a fallback only (see below). See `api/_lib/README.md` for the details.

Each story row shows the number of outlets that cover the story, when there are 3 or more.

### Publisher ratings

Under each headline, a small row can show two ratings of the publisher. They are never ratings of the story.

- **Lean** (Media Bias/Fact Check, MBFC): a 5-step mark from "Left" to "Right", and "MBFC" as a link to the MBFC page of the outlet. MBFC rates on a US scale.
- **State media tag** (State Media Monitor): "STATE-CONTROLLED", "CAPTURED" or "PUBLIC".

A publisher with no rating gets no row. The panel footer names a source only when the list shows its data.

The MBFC terms do not allow redistribution, and this repo is public. So the MBFC table is never in git and never goes to the browser:

- `npm run bias` (and `npm run dev` and `npm run build` before they start) writes the table to `api/_lib/generated/mbfc.json`. Git ignores this file.
- The script gets the data from the official MBFC RapidAPI product. It does this only when `RAPIDAPI_KEY` is set and the table is missing or older than 25 days. The free plan allows 3 requests a month.
- With no key, the script does nothing in about 50 ms. The lean stays hidden, and the state media tags still work.
- If a fetch fails, the script keeps the old table and exits with code 0. It never prints the key.
- On Vercel, the script fetches only for a production build. It keeps the last good table in `node_modules/.cache/worldly`, which Vercel keeps between builds.

The State Media Monitor table (`api/_lib/state-media.json`, CC BY 4.0) is in git. `npm run bias -- --smm` builds it again from the dataset and the hand map `scripts/bias-smm-domains.json` (State Media Monitor id to hosts).

#### Owner action: MBFC key

1. Sign in to RapidAPI and subscribe to the Basic plan of https://rapidapi.com/mbfcnews/api/media-bias-fact-check-ratings-api2. RapidAPI can ask for a card.
2. Local: set `RAPIDAPI_KEY=<key>` in `.env`. Run `npm run bias`.
3. Vercel: add `RAPIDAPI_KEY` under Project Settings > Environment Variables, for Production only. Redeploy.

Do not run `npm run bias -- --force` often: each fetch uses 1 of the 3 requests in the month.

### News API key (optional)

Worldly works with no key. A NewsData.io key helps small countries that have few Google stories. The free plan gives about 200 credits a day, but its data is 12 hours late. So the server calls NewsData only when fewer than 5 good stories come from the other sources, and it keeps each NewsData result for 6 hours.

1. Get a free key at https://newsdata.io/register.
2. Copy `.env.example` to `.env`.
3. Set `NEWSDATA_API_KEY=<your key>` in `.env`.
4. Restart `npm run dev`.

The key stays on the server.

### Cache

- The server keeps each list in memory for 10 minutes.
- The Vercel CDN keeps it for 15 minutes, and can serve it for 30 more minutes while it gets a new one.
- The browser keeps a list for at most 10 minutes.

### Audit

`npm run audit:news -- --base http://localhost:5173 --out after.json` loads the news of 15 countries and scores each list against Google's own national ranking (age, outlets, duplicates, sport and soft items, latency). `--from after.json --ref before.json` scores a saved run again on the reference of another run, with no network.

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
- Satellite image: NASA Blue Marble (public domain).
- Fonts: Inter Tight and JetBrains Mono (SIL Open Font License).
- News:
  - Google News RSS (all editions and search) and the RSS feeds of BBC, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India and The New York Times. Terms risk: these feed terms allow personal, non-commercial use only, and Worldly is a public site. The owner accepts this risk. Use a licensed source for commercial use.
  - [NewsData.io](https://newsdata.io): follow its terms for your plan.
- Publisher ratings:
  - Lean: [Media Bias/Fact Check](https://mediabiasfactcheck.com), through its official RapidAPI product. The terms require a link to MBFC and do not allow redistribution, so the table stays out of git and out of the browser. The MBFC scale is tailored to the United States.
  - State media tags: Dragomir, M. (2026). State Media Monitor Global Dataset 2026 (Version 2026.1) [Data set]. Media and Journalism Research Center (MJRC). https://doi.org/10.5281/zenodo.23863495, CC BY 4.0. Worldly added domain names.

Worldly links each story to the publisher. It does not copy article text.
