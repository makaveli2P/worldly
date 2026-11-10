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

`GET /api/news?country=<ISO3>` returns up to 5 stories. The server tries these providers in this order, and stops when it has 5 distinct stories:

1. Google News edition (no key): national stories, for countries that have an English edition.
2. NewsData.io (needs `NEWSDATA_API_KEY`): titles that name the country.
3. Google News search (no key).
4. GDELT (no key).

The server drops duplicates, near-duplicates, press releases and more than 2 stories from one publisher. See `api/_lib/README.md` for the details.

### News API key (optional)

Worldly works with no key. For better coverage, add a NewsData.io key. The free plan gives about 200 credits a day. Worldly uses NewsData.io instead of NewsAPI.org, because the NewsAPI.org free plan works only on localhost.

1. Get a free key at https://newsdata.io/register.
2. Copy `.env.example` to `.env`.
3. Set `NEWSDATA_API_KEY=<your key>` in `.env`.
4. Restart `npm run dev`.

The server caches the news for each country for 3 hours, and the Vercel CDN caches it too. One country costs 1 or 2 credits every 3 hours. The key stays on the server.

## Breaking news

`GET /api/breaking` returns a `BreakingResponse` (see `src/types.ts`): at most 3 alerts, most severe first. On a quiet day the list is empty. An alert is `critical` or `major`, and its `key` stays the same while the story lasts.

How it works:

1. The server reads 24 feeds in parallel: 16 front-page feeds of 12 outlets (BBC News, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India, The New York Times, Euronews) and 8 Google News editions (World, US, GB, IN, AU, CA, ZA, SG). It also reads Wikipedia "In the news" (ITN), GDACS and USGS. NHK has no English feed that works (its English JSON stopped on 5 September 2026), so the server does not read NHK.
2. A classifier gives each headline a kind (`conflict`, `attack`, `disaster`, `accident`, `politics`) and a tier. Tier 3 is a coup, the death or removal of a current head of state, the start of an invasion, or 50 or more dead. Tier 2 is a deadly strike, a mass shooting, or a deadly earthquake or crash.
3. A word-boundary matcher finds the country where the event happens. It uses an alias table of names, demonyms, places and leaders, so "Woman" does not match Oman and "Paris, Texas" is the US.
4. The detector groups headlines into stories. A story counts the independent outlets. Outlets that carry one wire story word for word count as one. Two outlets must agree on the tier.
5. Levels:
   - `major`: tier 2 or more, 3 or more outlets, and the story leads a front page (top 3) or a Google News edition (top 12).
   - `critical`: tier 3, 4 or more outlets, 2 leads or 2 editions, and 6 or more outlets or support from ITN, GDACS or USGS.
   - GDACS and USGS never start an alert. A red level can raise a deadly disaster story to critical. An orange or red level lets 2 outlets confirm a disaster.
   - Wars on the ITN "Ongoing" list give at most `major`, and only for a large escalation.
6. An alert ends 24 hours after its first evidence. A critical alert drops to major when no headline is newer than 6 hours. A story that ITN reported more than 36 hours ago is a follow-up and gives no alert.
7. The `key` is the country, the kind and the UTC day of the first evidence (`BGR-accident-20261110`). New outlets do not change it.

Limits:

- Precision comes first: the detector prefers a miss to a false alarm. It reads English headlines only, so an event that only local or non-English media report can come late or not at all.
- The server keeps no state. A Vercel CDN region caches the answer for 5 minutes (`s-maxage=300`). When fewer than half of the sources answer, the cache is 60 seconds.
- A story near the threshold (3 outlets) can come and go between polls, when one headline leaves a feed or one feed is slow.
- The rules are regular expressions. When a false alarm happens, save the inputs and add a test (see below).
- The leader names come from `public/data/countries.json`. A new leader is unknown until the next `npm run data`.

Tools:

- `npx tsx test/breaking/snapshot.ts`: a live run that prints the flagged headlines, the candidates and the response. `--save <name>` saves the flagged headlines to `test/breaking/fixtures/<name>.json` (5 to 10 KB). `--replay <file>` runs the detector on a saved file.
- `node scripts/build-aliases.mjs`: builds `api/_lib/breaking/aliases.json` from `public/data/countries.json`. Run it after `npm run data`, and commit the JSON.
- Optional env: `BREAKING_CONTACT` (a contact address or URL that the server adds to its Wikipedia User-Agent, as the Wikimedia policy asks) and `BREAKING_USER_AGENT`.

Terms: the feed terms of Google News, The Times of India, Al Jazeera and The Guardian allow personal use only, and the terms of other feeds were not all checked. The owner accepts this risk for this non-commercial site. Show BBC stories as "BBC News", with no BBC logo.

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
  - [NewsData.io](https://newsdata.io): follow its terms for your plan.
  - Google News RSS: the feed terms allow personal, non-commercial use only. Use a NewsData.io key or another licensed source for a public or commercial site.
  - [GDELT](https://www.gdeltproject.org): free to use with attribution.

Worldly links each story to the publisher. It does not copy article text.
