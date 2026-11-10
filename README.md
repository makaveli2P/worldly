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

The page decodes the tiers with `createImageBitmap`, off the main thread. If that fails, it uses an `<img>`.

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

| Profile | Globe ready (before → after) | Texture shown | Bytes |
| --- | --- | --- | --- |
| Desktop | 364 → 258 ms | 435 → 309 ms | 1.69 → 0.68 MB |
| Fast 4G, 4x CPU | 2167 → 1411 ms | 3618 → 1547 ms | 1.69 → 0.68 MB |
| Slow 4G, 6x CPU | 6415 → 4500 ms | 13512 → 5159 ms | 1.67 → 0.64 MB |

The numbers change by about 5% with the load on the test machine. The preview sends gzip; Vercel sends brotli, which is about 12% smaller for the JS and `world.json`.

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
  - [NewsData.io](https://newsdata.io): follow its terms for your plan.
  - Google News RSS: the feed terms allow personal, non-commercial use only. Use a NewsData.io key or another licensed source for a public or commercial site.
  - [GDELT](https://www.gdeltproject.org): free to use with attribution.

Worldly links each story to the publisher. It does not copy article text.
