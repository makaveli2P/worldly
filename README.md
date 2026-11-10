# Worldly

Worldly is a 3D globe in the browser. The globe spins slowly until you drag it, hover a country or select a country. Click a country to raise it. Its facts open in a plate on the left and its top 5 news stories open in a plate on the right. A story opens in a new tab.

Built with Vite, TypeScript and three.js. There is no UI framework.

## Features

- **Satellite map (default).** The globe uses EOX Sentinel-2 cloudless 2025 imagery with NASA Blue Marble polar ice. The page loads the image only when the satellite style is on, in tiers of 2048, 4096 and 8192 px. See [Satellite image](#satellite-image).
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

## Satellite image

The files are in `public/textures/`. `scripts/build-texture.mjs` makes them:

```sh
npm run texture
```

1. The script requests the EOX WMS layer `s2cloudless-2025` in 8 parts of 4096 x 4096 px (EOX allows 4096 px for each request). It waits 2 s between requests.
2. It stitches the parts to 16384 x 8192 px and resamples the result to 8192 x 4096 px (Lanczos 3).
3. Poleward of 58°, it puts NASA Blue Marble Next Generation ice on the flat white EOX pixels. The Arctic Ocean has no sea ice in the result.
4. It writes the tiers, `public/textures/LICENSE.md` and `src/globe/textureManifest.ts`. The app gets the file names only from that module.

The downloads stay in `.cache/texture/` (git ignores it), so a second run makes no requests. The output is the same for the same downloads.

| File | Use | Size |
| --- | --- | --- |
| `earth-2025-<hash>-2048.webp` (WebP q70) | First tier, on every device | 97 KB |
| `earth-2025-<hash>-4096.webp` (WebP q80) | When the view needs more texels than 2048 gives (desktop at once, phone after a zoom or selection) | 549 KB |
| `earth-2025-<hash>-8192.webp` (WebP q80) | Only on a desktop with `MAX_TEXTURE_SIZE` >= 8192, a fine pointer and 8 GB or more memory, after the first zoom or selection, when the globe is at rest | 2.1 MB |
| `earth-2025-<hash>-4096.jpg` (JPEG q80) | Fallback when the WebP load fails | 642 KB |

`<hash>` is the start of the SHA-256 of the file. A rebuild that changes a file gives it a new name, so the files can have a one-year immutable cache. With Save-Data, the page loads only the first tier.

The page decodes the tiers with `createImageBitmap`, off the main thread. If that fails, it uses an `<img>`. The upload of a decoded tier to the GPU runs on the main thread (about 13 ms for 4096 and 42 ms for 8192 on an Apple M4 Pro). So a larger tier waits for a frame with no drag, no turn to a selection, no inertia and no zoom ease. The 8192 tier also waits for the idle spin to stop and for 800 ms with no input (`canUploadTexture` in `src/globe/textureTiers.ts`).

### Texture licence

The texture files are licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This licence is separate from the licence of the code. `public/textures/LICENSE.md` has the full notice: the attribution, the licence, and the changes to the source imagery.

- Attribution (EOX requires these words): "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)". Polar ice: NASA Earth Observatory.
- The map shows the credit when the satellite style is on: under the readout on desktop, and behind the "Imagery: EOX" button on mobile. Do not remove it.
- Put the credit on each screenshot or video of the satellite globe (the EOX FAQ requires it). Mobile screenshots do not show the full credit, so add it to the image.
- Non-commercial use only. A fork that earns money (ads, paid features) must replace the texture files: rebuild from the CC BY 4.0 layer `s2cloudless` (2016; change `YEAR` and `LAYER` in the script) or buy a licence from EOX.
- ShareAlike: if you change the texture files and share them, use the same licence.

## Performance

The page does this to show the globe sooner:

- `index.html` paints the loading text before the module runs. An inline script fetches `world.json`, `countries-lite.json` and `labels.json` with the HTML. When the first two are in, it fetches the full `countries.json` and the first texture tier. `src/main.ts` uses these requests.
- The start does not wait for the web fonts. The overlay measures the labels again when the fonts load.
- The build writes `/data/labels.json` (label sites and the features with a reversed winding) and `/data/countries-lite.json` (the fields that the first frame needs) from `public/data/` (`src/data/precompute.ts`, `vite.config.ts`). The dev server makes them on request. If `labels.json` does not match `world.json`, the page computes the label sites.
- The globe mesh build uses a squared-length test for long edges.
- The device pixel ratio is at most 1.5 on touch devices and 2 elsewhere.
- `vercel.json`: `/assets/*` and the texture files have `public, max-age=31536000, immutable`. `/data/*` has `public, max-age=600, stale-while-revalidate=3600`, because the data names have no hash.

Local preview, median of 3 cold loads (headless Chromium, DevTools throttling; Slow 4G is 390x844 with 6x CPU):

| Profile | Globe ready (before → after) | Texture shown | Bytes to the first view | All bytes |
| --- | --- | --- | --- | --- |
| Desktop | 364 → 256 ms | 435 → 310 ms | 1.69 → 0.68 MB | 1.69 → 1.25 MB |
| Fast 4G, 4x CPU | 2167 → 1406 ms | 3618 → 1552 ms | 1.69 → 0.68 MB | 1.69 → 1.25 MB |
| Slow 4G, 6x CPU | 6415 → 4426 ms | 13512 → 5141 ms | 1.67 → 0.64 MB | 1.67 → 0.64 MB |

"Bytes to the first view" stops 1 s after the first texture shows. "All bytes" also counts the tiers that load after the first view: a desktop then loads the 4096 tier (549 KB) about 1.5 s after the first texture. A phone loads the 4096 tier only after a zoom or a selection. The numbers change by about 5% with the load on the test machine. The preview sends gzip; Vercel sends brotli, which is about 12% smaller for the JS and `world.json`.

## News

`GET /api/news?country=<ISO3>` returns up to 5 stories, in order of importance. The server starts all sources at the same time and uses what arrives in 3 seconds:

1. Google News edition (no key): the national stories (NATION) and the front page (Top stories) of the country's English edition.
2. Google News search (no key): English titles that name the country, from the last day. For a country whose name is also the name of other places or people (Georgia, Jordan, Niger, Chad, Palestine), the search also asks for the capital or the demonym.
3. Front-page feeds of 11 outlets (no key): BBC, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India and The New York Times. Only titles that name the country count. NHK is not in the list: its English JSON feed and its Japanese RSS feed stopped in August and September 2026.
4. Native edition (no key): for a country with no English edition, the national stories in the country's language.

The server groups the stories of all feeds into clusters (one cluster for each event). It gives each cluster a score from the number of outlets, the rank in Google's national feed, the outlet type and the age. It lowers the score of sport, celebrity, opinion and market-data items, and it drops company filings, earthquake bots and posts from social platforms. Then it picks 5 clusters, with 1 story for each publisher on the first pass. A story that does not name the country needs a minimum score, so a small country can show fewer than 5 stories.

A title matches a country by its name, demonym, capital or leader, as whole words (`api/_lib/news-aliases.json`). `npm run aliases` builds that file from `scripts/news-aliases-base.json` and the leaders in `public/data/countries.json`. Run it after `npm run data`. The script keeps a leader's surname alone only when the surname is not a common word or name (so "Friday" and "Schmidt" never match).

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
- When 2 MBFC records share a host (for example 2 TV stations on one site), the record that fits the host name wins. If none fits, the host gets no rating. `bias-rules.json` "wrongRecords" lists hosts whose record names another outlet. They get no lean.
- The script keeps the raw response in `node_modules/.cache/worldly/mbfc-raw.json` and the count of each raw "Bias" value in `mbfc-values.json`. `npm run bias -- --rebuild` builds the table again from that response, with no request.
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

- The server keeps each list in memory for 10 minutes. When Google does not answer, it keeps a list for 1 minute only, and it shows the last good list (at most 24 hours old) if it has one. When no source answers and no earlier list exists, the API answers 503, so that the CDN can serve its older copy.
- The Vercel CDN keeps it for 15 minutes, and can serve it for 30 more minutes while it gets a new one.
- The browser keeps a list for at most 10 minutes.

### Audit

`npm run audit:news -- --base http://localhost:5173 --out after.json` loads the news of 15 countries and scores each list against Google's own national ranking (age, outlets, duplicates, sport and soft items, latency). `--from after.json --ref before.json` scores a saved run again on the reference of another run, with no network.

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
6. An alert ends 24 hours after its first evidence. A critical alert drops to major when no headline is newer than 6 hours. A story whose first evidence comes more than 36 hours after the start of the day of a matching ITN blurb is a follow-up and gives no alert. A matching blurb names the same country and kind, and shares a place, the death toll or 2 distinctive words.
7. The `key` is the country, the kind and the UTC day of the first evidence (`BGR-accident-20261110`). New outlets do not change it. The key can change in one case: the first headline of a story is from before 00:00 UTC, and it leaves its feed while all other headlines are from after 00:00. Then the key moves to the next day. A client must also treat an alert with the same country and kind, whose `since` is less than 24 hours after the `since` of a known alert, as the same story.

Limits:

- Precision comes first: the detector prefers a miss to a false alarm. It reads English headlines only, so an event that only local or non-English media report can come late or not at all.
- The server keeps no state. A Vercel CDN region caches the answer for 5 minutes (`s-maxage=300`). When fewer than half of the sources answer, the cache is 60 seconds.
- A story near the threshold (3 outlets) can come and go between polls, when one headline leaves a feed or one feed is slow.
- The rules are regular expressions. When a false alarm happens, save the inputs and add a test (see below).
- The leader names come from `public/data/countries.json`. A new leader is unknown until the next `npm run data`.

Tools:

- `npx tsx test/breaking/snapshot.ts`: a live run that prints the flagged headlines, the candidates and the response. `--save <name>` saves the flagged headlines to `test/breaking/fixtures/<name>.json` (5 to 10 KB). Add `--wide` to also save every headline that names a country, with no link (about 50 KB), so that a later rule change can be checked against headlines that the rules did not flag. `--replay <file>` runs the detector on a saved file.
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
- Satellite image: EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0, modified. Polar ice: NASA Blue Marble Next Generation, credit NASA Earth Observatory. See [Texture licence](#texture-licence).
- Fonts: Inter Tight and JetBrains Mono (SIL Open Font License).
- News:
  - Google News RSS (all editions and search) and the RSS feeds of BBC, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India and The New York Times. Terms risk: these feed terms allow personal, non-commercial use only, and Worldly is a public site. The owner accepts this risk. Use a licensed source for commercial use.
  - [NewsData.io](https://newsdata.io): follow its terms for your plan.
- Publisher ratings:
  - Lean: [Media Bias/Fact Check](https://mediabiasfactcheck.com), through its official RapidAPI product. The terms require a link to MBFC and do not allow redistribution, so the table stays out of git and out of the browser. The MBFC scale is tailored to the United States.
  - State media tags: Dragomir, M. (2026). State Media Monitor Global Dataset 2026 (Version 2026.1) [Data set]. Media and Journalism Research Center (MJRC). https://doi.org/10.5281/zenodo.23863495, CC BY 4.0. Worldly added domain names.

Worldly links each story to the publisher. It does not copy article text.
