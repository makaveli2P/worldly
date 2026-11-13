# Worldly

Worldly is a 3D globe in the browser. The globe spins slowly until you drag it, hover a country or select a country. Click a country to raise it. Its facts open in a plate on the left and its top 5 news stories open in a plate on the right. A story opens in a new tab.

Built with Vite, TypeScript and three.js. There is no UI framework.

This file is the overview for release 0.2.0. `api/_lib/README.md` is the technical reference for the two server functions (`/api/news` and `/api/breaking`).

## Features

New in 0.2.0:

- **News ranking across all feeds.** The server reads Google News, the front pages of 11 outlets and the native edition of the country at the same time. It groups the stories into events and ranks them by coverage, rank and age. See [News](#news).
- **Publisher ratings.** Under a headline, a small row can show the lean of the publisher (Media Bias/Fact Check) and a state media tag (State Media Monitor). These are ratings of the publisher, not of the story. See [Publisher ratings](#publisher-ratings).
- **Breaking news.** A chip in the header, a yellow marker on the globe and a BREAKING row at the top of the news plate show a major event, such as a coup, a large attack or a deadly earthquake. See [Breaking news](#breaking-news).
- **New satellite image.** The globe uses EOX Sentinel-2 cloudless 2025 imagery with NASA Blue Marble polar ice. The page loads it in tiers of 2048, 4096 and 8192 px. See [Satellite image](#satellite-image).
- **Faster first load.** `index.html` starts the data and the first texture before the app code runs, and the build makes the label sites in advance. See [Performance](#performance).

Also:

- **Atlas map.** Flat land fills, a 15° graticule and a 1px limb. The selected country is solid red.
- **Light and dark themes.** The theme follows `prefers-color-scheme`. The sun/moon button in the header sets a theme and keeps it. Both map styles work in both themes.
- **Always-on labels.** Country names (uppercase) and capitals (small square and name) stay on the globe with no hover. The overlay hides labels on the far side, fades them near the limb, and stops labels from overlapping. Zoom in to see more countries. The selected country always has a label.
- **Leader lines.** Lines with a 45° elbow join the selected country to the inner edge of each panel. The lines follow the globe while it moves. The lines are white over the satellite globe and ink elsewhere.
- **Instrument readout.** `LAT / LON / ALT / SEL` at the bottom of the screen show the centre of view, the camera altitude and the selected country. When the satellite style is on, the image credit is under the readout.
- **Mobile (< 768px).** A bottom sheet with `Overview | News` tabs. The first tap raises a country, and the second tap opens it. One short leader line goes into the sheet.
- **Keyboard.** Press `/` to search. Press `Esc` to close the selection. The map style toggle is a radio group (arrow keys).
- **Links.** A link to a country uses its English name, for example `/country/japan`. An old link with the ISO alpha-3 code, for example `/#JPN`, still works. The page changes it to the new form. See [Search and sharing](#search-and-sharing).

## Design

The design is "Swiss / instrument". The reference mockup is in `mockups/swiss/`. The mockups are not part of the build.

- Type: Inter Tight (400/500/600) for text, JetBrains Mono for all figures. The fonts are local files in `src/assets/fonts/`.
- Grid: 8px.
- Colours: one accent, Swiss red, for the selection. Signal yellow is only for breaking news. The tokens are CSS custom properties on `:root[data-theme=light|dark]` in `src/styles.css`. `src/theme.ts` holds the same UI tokens (paper, panel, ink, rule, muted, accent, alert) and the globe colours. Keep the two files in step. `test/ui/contrast.test.ts` checks that the two files agree and that each text pair meets WCAG AA (4.5:1).
- Surfaces: the canvas uses paper. The header, the plates, the search list and the mobile sheet use panel. A 1px ink frame (2px at the top of a plate) separates a plate from the canvas and the globe. There is no shadow, radius or blur. The `theme-color` meta matches the header (panel) colour.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| paper | `#E6E6E1` | `#0A0A0A` | The canvas |
| panel | `#FFFFFF` | `#1A1A1A` | The header, the plates, the sheet |
| ink | `#111111` | `#F2F2EE` | Text, frames, keylines |
| rule | `#DCDCD7` | `#333333` | Hairlines |
| muted | `#5C5C58` | `#9A9A94` | Secondary text |
| faint | `#6B6B67` | `#8A8A84` | Numbers in lists (`styles.css` only) |
| hover | `#F4F4F1` | `#202020` | Row hover (`styles.css` only) |
| accent | `#E5361B` | `#F24B2F` | The selection: fills and markers |
| accent-text | `#D12F15` | `#F24B2F` | Small red text (`styles.css` only) |
| lean-left | `#1F5BD6` | `#5C8DF6` | Left steps of the lean scale (`styles.css` only) |
| lean-right | `#C8102E` | `#F0505A` | Right steps of the lean scale (`styles.css` only) |
| on-ink | `#FFFFFF` | `#0E0E0E` | Text on an ink fill (`styles.css` only) |
| alert | `#FFB800` | `#FFB800` | Breaking news |
| on-alert | `#111111` | `#111111` | Text and keyline on the alert yellow (`styles.css` only) |

Breaking news uses the alert yellow with an ink keyline, so one of the two colours is at least 3:1 on every background. Red stays the colour of the selection.

- **Globe.** A yellow dot with open rings at the label point of the country, and the country name in bold. A critical alert has a larger dot, a heavier ring and a second outer ring. When the country rises (hover or selection), the marker rises with it (`Globe.liftOf`). On the selected country, the red anchor replaces the dot and the outer ring is off at rest, so the capital name has room. When the country is on the far side or off screen, a still yellow arrow with the name points to it from the globe edge.
- **Pulse.** The map rings and the chip dot pulse until the user does something on the page (a click, a tap, a key or a scroll): critical every 1.6 s (0.625 Hz), major every 2.4 s. Then they stay still. A new alert makes them pulse again, and a hover on the chip blinks its marker 3 times. A story that is new in the browser session first gets 3 fast cycles. The rate is far below 3 flashes a second (WCAG 2.3.1). The dismiss button stops the pulse of an alert (WCAG 2.2.2). With `prefers-reduced-motion`, nothing pulses. The markers are DOM nodes over the canvas, so the globe does not render more frames for them.
- **Header chip.** `BREAKING`, the country, the headline, the age of the article (for example `25m`), a link to the article, `+N` for more alerts and a dismiss button. The chip is in the header between the search and the map style at 1000 px and wider (the headline goes away below 1100 px). From 768 to 999 px it is in a second header row, and on mobile in a third header row. A long country name gets an ellipsis. With 2 or more alerts, the chip shows the next alert every 8 seconds, and the marker of that country pulses one time (one ring cycle of 1.6 s) when it is in clear view. The chip does not rotate while the pointer or the focus is on it, while the `+N` list is open, while the page is hidden, or when the system asks for reduced motion. A click selects the country. The tooltip and the screen-reader label also give the source and, when the story is 1 hour or more older than the article, when it was first reported ("DW, 25 minutes ago. First reported 6 hours ago."). A polite live region announces each new story once. The age changes in place every minute, so a screen reader does not read the chip again.
- **News plate row.** When the selected country has an alert, the news plate (the News tab on mobile) shows one BREAKING row above the stories: the tag, the source, the age of the article and the headline. The headline links to that article in a new tab. A story in the list with the same link or the same headline does not show again under the row.
- **Story identity.** A dismissed story stays away for the browser session (`sessionStorage`: `worldly:breaking-dismissed`, `worldly:breaking-announced`). The server key can move to the next day at 00:00 UTC. So the client also treats an alert with the same country and kind, and a `since` less than 24 hours from a known alert, as the same story (`sameStory` in `src/ui/alerts-model.ts`). An alert that drops out of the feed stays on screen for one more poll, because a story near the threshold can come and go.
- **Poll.** Every 5 minutes while the page is visible, and every 15 minutes while it is hidden. While the tab is hidden, the title shows the count of new alerts, for example `(1) Japan: facts and top news · Worldly`. The message and the pulse wait until the tab is visible again. The client drops an alert with no evidence in the last 24 hours, and an alert whose article is more than 8 hours old (an old answer from the CDN).
- **Mock.** To see the UI with no server data, open `http://localhost:5173/?alerts=mock` in `npm run dev` (also `mock-critical`, `mock-major` and `mock-none`). The production build does not contain the mock.

## Preferences

The page keeps two values in `localStorage`:

- `worldly:style`: `atlas` (default) or `satellite`.
- `worldly:theme`: `dark` (default) or `light`. The system light or dark setting does not change the theme.

A small script in `index.html` applies both values before the first paint.

## Code map

- `index.html`: the boot script, which starts the data requests and the first texture.
- `src/main.ts`: loads the data and joins the globe, overlay, panels and breaking-news feed.
- `src/globe/`: the three.js globe (`Globe.ts`), its shaders, controls, picker and texture tiers.
- `src/overlay/`: labels, leader lines and breaking-news markers (DOM and SVG over the canvas).
- `src/ui/`: the header, search, panels, readout, image credit, preferences and the breaking-news chip (`alerts*.ts`).
- `src/data/precompute.ts`: the label sites and the lite country file that the build makes.
- `src/data/site.ts`, `src/data/slug.ts`, `src/data/seo.ts`: the canonical domain, the country URLs and the search files that the build makes. See [Search and sharing](#search-and-sharing).
- `src/dev/`: the breaking-news mock (dev server only).
- `src/theme.ts`: light and dark palettes for the UI and the globe.
- `src/types.ts`: the shared types, with the `/api/news` and `/api/breaking` contracts.
- `api/`: the two Vercel functions, `news.ts` and `breaking.ts`. See `api/_lib/README.md`.
- `scripts/`: the data, alias, rating and texture builders.

## Run locally

Use Node 22 or later.

```sh
npm install
npm run dev
```

Open http://localhost:5173. The dev server also runs the `api/` handlers, so news and breaking news work locally.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the dev server. It runs `npm run bias` first (see below). |
| `npm run build` | Checks the types and builds to `dist/`. It runs `npm run bias` first. |
| `npm run preview` | Serves the build. The preview does not run `api/`, so news does not load there. |
| `npm run typecheck` | Checks the types. |
| `npm test` | Runs the tests (Vitest). `vitest.config.ts` collects only the tests of this repo, not `.claude/`. |
| `npm run data` | Builds the country data again. See [Refresh the country data](#refresh-the-country-data). |
| `npm run aliases` | Builds `api/_lib/news-aliases.json` (the news relevance check). Run it after `npm run data`. |
| `npm run aliases:breaking` | Builds `api/_lib/breaking/aliases.json` (the breaking-news matcher). Run it after `npm run data`. Optional: `-- --mledoze <file>` reads a local copy of mledoze/countries. |
| `npm run places:breaking` | Builds `api/_lib/breaking/places.json` (the place gazetteer of the breaking-news matcher) from GeoNames and four name lists. Run it after `npm run aliases:breaking`. The first run downloads about 230 MB into `.cache/places/`. Options: `-- --refresh` downloads again, `-- --offline` uses the cache only. It needs the `unzip` command. |
| `npm run companies:breaking` | Builds `api/_lib/breaking/companies.json` (the companies, leaders and banks of the business family) from Wikidata and `scripts/companies-extra.json`. Run it each month, after `npm run aliases:breaking`. It prints the new and removed companies and each change of CEO: read that list before you commit. It stops with an error when a company of `mustHave` in `scripts/companies-extra.json` (or its headline name) is missing. The answers go into `.cache/companies/`. Options: `-- --refresh` queries again, `-- --offline` uses the cache only. |
| `npm run bias` | Builds the MBFC table `api/_lib/generated/mbfc.json` when `RAPIDAPI_KEY` is set. See [Publisher ratings](#publisher-ratings). |
| `npm run audit:news` | Scores the news lists against Google's own ranking. See [Audit](#audit). |
| `npm run texture` | Builds the satellite texture tiers. See [Satellite image](#satellite-image). |
| `npm run icons` | Builds the PNG app icons in `public/` from `public/favicon.svg`. |

Commit the JSON files that `npm run data`, `npm run aliases`, `npm run aliases:breaking`, `npm run places:breaking` and `npm run companies:breaking` write. Do not commit the MBFC table.

## Owner setup

Worldly works with no key. Each key below adds one feature. Set a key locally in `.env` (copy `.env.example`; git ignores `.env`) and on Vercel under Project Settings > Environment Variables. The server never writes a key to a response or a log.

| Variable | Needed for | Where |
| --- | --- | --- |
| `RAPIDAPI_KEY` | The MBFC publisher lean. Only `npm run bias` uses it, at build time. | Local, and Vercel **Production only** |
| `NEWSDATA_API_KEY` (optional) | The NewsData.io fallback for small countries. | Local and Vercel |
| `BREAKING_CONTACT` (optional) | A contact address or URL in the User-Agent of the Wikipedia request, as the Wikimedia policy asks. | Vercel (local is optional) |
| `DEEPL_API_KEY` (optional) | English titles for native-language stories. | Local and Vercel |

**RAPIDAPI_KEY (MBFC lean)**

1. Sign in to RapidAPI and subscribe to the Basic plan of https://rapidapi.com/mbfcnews/api/media-bias-fact-check-ratings-api2. RapidAPI can ask for a card.
2. Local: set `RAPIDAPI_KEY=<key>` in `.env`. Run `npm run bias`.
3. Vercel: add `RAPIDAPI_KEY` for Production only. Redeploy.

The Basic plan allows 3 requests a month. Do not run `npm run bias -- --force` often: each fetch uses 1 of these requests.

**NEWSDATA_API_KEY (optional)**

A NewsData.io key helps small countries that have few Google stories. The free plan gives about 200 credits a day, but its data is 12 hours late. So the server calls NewsData only when fewer than 5 good stories come from the other sources, and it keeps each NewsData result for 6 hours.

1. Get a free key at https://newsdata.io/register.
2. Set `NEWSDATA_API_KEY=<your key>` in `.env`.
3. Restart `npm run dev`.

**DEEPL_API_KEY (optional)**

A DeepL key translates the native-language titles of the news plate to English. The server uses `api-free.deepl.com` for a DeepL API Free key (it ends in `:fx`) and `api.deepl.com` for a Pro key.

1. Get a key at https://www.deepl.com/pro-api (the API Free plan is enough).
2. Local: set `DEEPL_API_KEY=<key>` in `.env`. Restart `npm run dev`.
3. Vercel: run `vercel env add DEEPL_API_KEY production` (or add it under Project Settings > Environment Variables). Redeploy.

The API Free plan has a monthly character limit (1,000,000 characters for the owner's key on 2026-11-11; `GET /v2/usage` shows it). One list sends 3 to 5 titles, about 100 to 400 characters. The server keeps each translation in memory and the CDN keeps each list for 15 minutes, so a title goes to DeepL about once for each server instance. When the limit is used up, DeepL answers 456, the log shows `[news] translate failed: http 456 (quota), paused 1 h`, and the titles stay in their language. The server then sends no request to DeepL for 1 hour, and the lists keep their normal cache. A wrong key (HTTP 403) gives the same pause. With no key, the server sends nothing and the titles stay in their language.

**BREAKING_CONTACT (optional)**

Set it to an address or a URL where Wikimedia can reach the owner. The server adds it, in brackets, to the User-Agent of the Wikipedia request only. `BREAKING_USER_AGENT` (optional) replaces the default User-Agent of all breaking-news requests.

## Deploy to Vercel

1. Push the repo to GitHub.
2. Import the repo in Vercel. Vercel detects Vite. The build command is `npm run build` and the output folder is `dist`.
3. Add the variables of [Owner setup](#owner-setup).
4. Deploy. Vercel runs `api/news.ts` and `api/breaking.ts` as serverless functions. `vercel.json` sets the cache headers and puts the MBFC table in the news function when the table exists.

## Search and sharing

The canonical domain is `https://worldly.today`. `SITE_ORIGIN` in `src/data/site.ts` holds it. Change the domain there only.

- **Country URLs.** Each country has a page at `/country/<slug>`, for example `/country/japan` or `/country/sao-tome-and-principe`. `countrySlug()` in `src/data/slug.ts` makes the slug from the English name. The app writes this path when you select a country, and writes `/` when you close it. A test checks that all slugs are unique.
- **Prerendered pages.** `npm run build` writes `dist/country/<slug>/index.html` for each country (`src/data/seo.ts`, `worldlySeo` in `vite.config.ts`). Each page has its own title, description, canonical link, Open Graph and Twitter tags and JSON-LD (`WebPage`, `BreadcrumbList`). Each page also has a short text summary of the facts for crawlers that do not run JavaScript. The summary shows under the loader line, and the app removes it when the globe is on screen.
- **Home page.** The dev server and the build put the head tags, the JSON-LD (`WebSite`) and the summary into `index.html`, between the `worldly:head` and `worldly:summary` markers. Keep the markers.
- **Internal links.** The home summary links to each country page, by region. Each country summary links to its land neighbours and to the other countries in its subregion. So a crawler finds each country page from the home page, and not only from the sitemap. The long lists are in closed `<details>` elements.
- **Sitemap and robots.** The build writes `/sitemap.xml` (the home page and all country pages, with the build date) and `/robots.txt`. The dev server makes both on request.
- **Social image.** `public/og-image.png` (1200x630) is a screenshot of the app. All pages use it.
- **Hosts.** `vercel.json` sends `www.worldly.today` and `worldly-cyan.vercel.app` to `https://worldly.today` with a 308 redirect. Other `*.vercel.app` hosts (the previews) get `X-Robots-Tag: noindex`. `trailingSlash: false` sends `/country/japan/` to `/country/japan` with a 308 redirect, so each page has one URL.
- **Caution.** Do not add a redirect from `worldly.today` to `www.worldly.today` in Vercel > Project > Settings > Domains. `vercel.json` sends `www` to the apex, so the two redirects make a loop. Browsers keep a 308 redirect, so the error stays with the visitors.
- **Not found.** An unknown path, for example `/country/nowhere`, gets `public/404.html` on Vercel. The dev server shows the globe and changes the URL to `/`.

After a deploy, submit `https://worldly.today/sitemap.xml` in Google Search Console.

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

The texture files are licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/). This licence is separate from the licence of the code (MIT, see [License](#license)). `public/textures/LICENSE.md` has the full notice: the attribution, the licence, and the changes to the source imagery.

- Attribution (EOX requires these words): "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025)". Polar ice: NASA Earth Observatory.
- The map shows the credit when the satellite style is on: on one line under the readout on desktop, and behind the "Imagery: EOX" button on mobile (`src/ui/credit.ts`). The credit is small (9.5px) and muted, but it stays on the solid readout paper, so its contrast is 4.5:1 or more over any imagery (also over white ice). Do not remove it.
- The map shows the EOX attribution and the licence only. NASA imagery is public domain, so the NASA credit (polar ice) is in `public/textures/LICENSE.md` and in this file, not on the map.
- Put the credit on each screenshot or video of the satellite globe (the EOX FAQ requires it). Mobile screenshots do not show the full credit, so add it to the image.
- Non-commercial use only. A fork that earns money (ads, paid features) must replace the texture files: rebuild from the CC BY 4.0 layer `s2cloudless` (2016; change `YEAR` and `LAYER` in the script) or buy a licence from EOX.
- ShareAlike: if you change the texture files and share them, use the same licence.

## Analytics

The production build loads Vercel Web Analytics and Speed Insights (`src/vitals.ts`). Both use no cookies and keep no IP address. `src/main.ts` loads them as a separate chunk after the first globe frame, so they do not delay the globe.

- **Web Analytics** counts a page view for each page load, also for a country link such as `/country/japan`. The app changes the path with `replaceState` when a visitor selects a country, and the script does not count that change. The Hobby plan includes 50,000 events a month for all projects of the account.
- **Speed Insights** sends the real-user speed score. All country pages share one route, `/country/[slug]`. The Hobby plan includes 10,000 events in 30 days. If the site gets near this limit, set `sampleRate` in `src/vitals.ts`.
- The dev server does not load them.

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
5. NewsData.io (optional key): a fallback only, when fewer than 5 good stories come from the sources above. See [Owner setup](#owner-setup).

The server groups the stories of all feeds into clusters (one cluster for each event). It gives each cluster a score from the number of outlets, the rank in Google's national feed, the outlet type and the age. It lowers the score of sport, celebrity, opinion and market-data items, and it drops company filings, earthquake bots and posts from social platforms. Then it picks 5 clusters, with 1 story for each publisher on the first pass. A story that does not name the country needs a minimum score, so a small country can show fewer than 5 stories.

A title matches a country by its name, demonym, capital or leader, as whole words (`api/_lib/news-aliases.json`, built by `npm run aliases`). The script keeps a leader's surname alone only when the surname is not a common word or name (so "Friday" and "Schmidt" never match).

Language (hybrid): for a country with no English edition (for example Germany, Japan or Mexico), the strong English stories take their places first. A strong story has 3 or more outlets, or names a person or place from the native top 20 (then it gets that native rank). Native-language stories and the other English stories compete for the other places by score, so English filler does not push out a main national story. The list is in score order. A native-language story has a language tag (for example "DE").

Translation (DeepL): after the pick, the server sends the non-English titles of the list (at most 5) to DeepL in one request, and the story shows the English title (British English). The clusters and the dedupe use the original titles, because the translation comes after the pick. On a translated story:

- The language tag shows the translation, for example "ZH → EN". A screen reader reads "Translated from Chinese by DeepL".
- A hover on the headline shows the original title. The "Original" button under the headline shows it too (touch, keyboard and screen readers). The original text has the `lang` of its language.
- "Read in English" opens the article through the Google Translate page proxy (`https://<host>.translate.goog/...`). It shows only for a link to the publisher. Most native stories come from Google News, and their links are news.google.com redirects: the proxy shows an empty page for them, so these stories have no "Read in English" link.
- The panel footer shows "Translations: DeepL".

With no `DEEPL_API_KEY`, or when DeepL fails or takes more than 1.5 s, the titles stay in their language with the language tag (as before). The server keeps each translation in memory, so it never sends one title twice. See [Owner setup](#owner-setup).

Each story row shows the number of outlets that cover the story, when there are 3 or more. `api/_lib/README.md` has the full rules for the gather, the filters, the clusters, the score and the pick.

### Publisher ratings

Under each headline, a small row can show two ratings of the publisher. They are never ratings of the story.

- **Lean** (Media Bias/Fact Check, MBFC): a 5-step mark from "Left" to "Right" (left steps blue, right steps red, the centre ink), and "MBFC" as a link to the MBFC page of the outlet. MBFC rates on a US scale.
- **Other class** (MBFC): MBFC puts some outlets outside the left-right scale (Questionable, Conspiracy-Pseudoscience, Satire, Pro-Science). The row then shows "Other class" and the "MBFC" link. So Fox News and Breitbart do not look unrated. The MBFC page names the class.
- **State media tag** (State Media Monitor): "STATE-CONTROLLED", "CAPTURED" or "PUBLIC".

A publisher with no rating gets no row. A blog subdomain (`blogs.*`) gets no rating of its parent outlet. The app shows the MBFC values as they are: MBFC rates AP and AFP "Lean left". The panel footer names a source only when the list shows its data.

The MBFC terms do not allow redistribution, and this repo is public. So the MBFC table is never in git and never goes to the browser. The server adds the lean to each story:

- `npm run bias` (and `npm run dev` and `npm run build` before they start) writes the table to `api/_lib/generated/mbfc.json`. Git ignores this file.
- The script gets the data from the official MBFC RapidAPI product. It does this only when `RAPIDAPI_KEY` is set and the table is missing or older than 25 days.
- With no key, the script does nothing in about 50 ms. The lean stays hidden, and the state media tags still work.
- If a fetch fails, the script keeps the old table and exits with code 0. It never prints the key.
- On Vercel, the script fetches only for a production build. It keeps the last good table in `node_modules/.cache/worldly`, which Vercel keeps between builds.
- `npm run bias -- --rebuild` builds the table again from the last raw response, with no request. `api/_lib/README.md` has the rules for hosts that share a record.

The State Media Monitor table (`api/_lib/state-media.json`, CC BY 4.0) is in git. `npm run bias -- --smm` builds it again from the dataset and the hand map `scripts/bias-smm-domains.json` (State Media Monitor id to hosts).

### Cache

- The server keeps each list in memory for 10 minutes. When Google does not answer, it keeps a list for 1 minute only, and it shows the last good list (at most 24 hours old) if it has one. When the translation fails, the list also stays for 1 minute only (in memory and on the CDN), so a later request tries the translation again. When no source answers and no earlier list exists, the API answers 503, so that the CDN can serve its older copy.
- The Vercel CDN keeps a list for 15 minutes, and can serve it for 30 more minutes while it gets a new one.
- The browser keeps a list for at most 10 minutes.

### Audit

`npm run audit:news -- --base http://localhost:5173 --out after.json` loads the news of 15 countries and scores each list against Google's own national ranking (age, outlets, duplicates, sport and soft items, latency). `--from after.json --ref before.json` scores a saved run again on the reference of another run, with no network.

## Breaking news

`GET /api/breaking` returns a `BreakingResponse` (see `src/types.ts`): at most 3 alerts, most severe first. On a quiet day the list is empty. An alert is `critical` or `major`, and its `key` stays the same while the story lasts.

How it works:

1. The server reads 24 feeds in parallel: 16 front-page feeds of 12 outlets (BBC News, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India, The New York Times, Euronews) and 8 Google News editions (World, US, GB, IN, AU, CA, ZA, SG). It also reads Wikipedia "In the news" (ITN), GDACS and USGS. NHK has no English feed that works (its English JSON stopped on 5 September 2026), so the server does not read NHK.
2. A classifier gives each headline a kind (`conflict`, `attack`, `disaster`, `accident`, `politics`, `business`) and a tier. Tier 3 is a coup, the death or removal of a current head of state, the start of an invasion, or 50 or more dead. Tier 2 is a deadly strike, a mass shooting, or a deadly earthquake or crash. A press review ("The Papers: ...") gets no kind.
   - Business (tier 2): the CEO, the chair or a famous founder of a top company resigns, is fired, dies or is arrested ("Jensen Huang resigns as Nvidia CEO"); a stock index falls by 5 to 7% or more, or has its worst day since a year before 2010; a merger of $50bn or more; a top company or bank collapses; an exchange halts all trading. Tier 3: an index falls by 10% or more, or a global systemically important bank collapses. A plan ("to step down next year"), a rumour ("in talks to buy"), an interim or former leader, a board seat, the stock of one company, or a reaction ("shares fall after ...") is tier 1. A fall over many sessions ("10% from its record high", "in a week", "in October", a correction or a bear market) is tier 1. A record ("worst week since 2008") stays tier 2. The head of a Formula 1 team with a company name ("Red Bull boss") is no business leader. A departure from a role outside the company ("Elon Musk steps down from DOGE") is no leader event.
   - A title with no event word but a death toll of 10 or more for one event is a tier-2 `accident` (`TOLL_EVENT_DEATHS` in `api/_lib/breaking/classify.ts`): "24 killed in head-on collision between mini-bus, truck in Assam's Kaziranga". The toll must be in digits. A disease toll, the deaths of animals, a war total ("death toll passes 70,000") and a total over weeks do not count. In the country of a chronic war, a story of such titles stays under the chronic-war gate.
   - The country of a business story is the home country of the company (from Wikidata, `api/_lib/breaking/companies.json`), or the country of the index or the exchange. It is not the country that the title names: "Nvidia CEO quits over affair with Chinese spy" is a US story.
3. A word-boundary matcher finds the country where the event happens. It uses an alias table of names, demonyms, places and leaders (`api/_lib/breaking/aliases.json`, built by `npm run aliases:breaking`), so "Woman" does not match Oman and "Paris, Texas" is the US. A gazetteer of cities, districts and regions (`api/_lib/breaking/places.json`, from GeoNames) adds places such as Brooklyn or Flatbush. The forms of one place ("Washington", "Washington DC", "D.C.") give one place key, so their headlines join one story. A place name that is also a word or a person's name counts only after "in" or "near". A name that two countries share does not count, unless one country has 10 times the population.
4. The detector groups headlines into stories. A story counts the independent outlets. Outlets that carry one wire story word for word count as one. Two outlets must agree on the tier.
5. Levels:
   - `major`: tier 2 or more, 3 or more outlets, and the story leads a front page (top 3) or a Google News edition (top 12). A business story needs 4 or more outlets.
   - Cluster voices. Google News lists other outlets under each item (the outlets that the news plate counts). When a Google News item of the story is strong (tier 2 or more), in the top 12, at most 6 hours old and not a live blog, a video clip or an aggregator copy, the outlets that Google lists under it count as more outlets of the story, at most 3. Only a story with victims gets cluster voices: 2 feed outlets agree on a toll of 5 or more, or the tier is 3, or GDACS or USGS confirms it. War coverage (a conflict story, or an attack by a state) gets none. An outlet that the feeds already give counts once. An aggregator, a social platform, a press-release wire, a government, a police force or a company newsroom is no voice. Cluster voices count for the `major` bar and `outlets` only. They do not count for the agreed tier, the critical rules, the business bar, the pulse, the chronic-war gate or a new wave. So the story still needs 2 feed outlets that agree on the tier, and a sport or film item with a large cluster adds nothing. Example: the Kaziranga bus crash of 13 November 2026 had 2 feed outlets, and Google listed Reuters and NDTV under The Hindu item.
   - `critical`: tier 3, 4 or more outlets, 2 leads or 2 editions, and 6 or more outlets or support from ITN, GDACS or USGS.
   - One alert per country. At the same level, a business story comes after every other kind, so it never pushes a deadly event off the list. Two business stories of one country (a company and a market crash) are two stories with two keys.
   - GDACS and USGS never start an alert. A red level can raise a deadly disaster story to critical. An orange or red level lets 2 outlets confirm a disaster.
   - A chronic war gives at most `major`. A war is chronic when it is on the ITN "Ongoing" list, or when conflict alerts in that country started on 2 or more days of the last 7 days ("recurring"). An attack story that names another country as the attacker ("Israeli attack on Gaza tent camp kills 18") is war coverage: the recurring rule applies to it, and its start counts as a conflict start. A terror bombing or a mass shooting names no state attacker. A chronic war alerts only for a large escalation (tier 3, 6 outlets and 3 editions), a big fresh wave (6 outlets with headlines of 6 hours or less, 3 of them in a lead position, and 20 or more dead), or a new development that ITN posts in the last 36 hours, with a new wave of headlines. So the daily coverage of a war does not alert.
6. The pulse. Fresh coverage decides if an alert lives, not the age of its first headline. An alert starts and stays only while an outlet runs a strong headline that is at most 6 hours old in a lead position (top 3 of a front page, top 12 of a Google News edition), and 2 outlets have a strong headline in the last 12 hours. When the pulse stops, the alert ends. In the first 2 hours after an alert starts, one outlet with a fresh strong headline is enough. The pulse counts the feed outlets only, not the cluster voices. A live blog, a video clip or an aggregator copy is never a fresh headline for the pulse: an outlet changes the date of a live blog at each update.
7. Waves. One wave of an alert lasts at most 24 hours. Then the alert needs a renewal:
   - A new wave: 3 or more outlets with new fresh strong headlines (new links, not old links with a new date), and one of them in a lead position. A new wave renews the story for at most 72 hours after its first alert.
   - An escalation: a higher tier, an agreed death toll that at least doubles and rises by 20 or more, or a new development in ITN. ITN often posts an event on the next day, so a blurb is a development only when it is from a later day than the start of the wave and tells more than the story showed: a higher tier or toll, or a new fresh headline that tells the blurb. A story that ended also needs a new headline. An escalation renews the story at any time.
   - A story that ended in the last 48 hours alerts again only with a new wave or an escalation. So a war or a disaster that gets a new wave of coverage (new outlets, new headlines, a new development) can be breaking again, but old coverage does not keep it on screen.
   - A new story whose first headline is more than 24 hours old also needs a new wave.
   - Follow-ups: a story whose first evidence comes more than 36 hours after the start of the day of a matching ITN blurb is a follow-up and gives no alert, unless it is larger than the blurb (a higher tier, or a toll that doubles and rises by 20). A matching blurb names the same country and kind, and shares a place, the death toll or 2 distinctive words. A live alert compares the blurb with its own first evidence, so a long alert that started on the day of the blurb goes on.
8. The article. The chip shows one article: its headline, its link, its source and its date all come from that one article (`publishedAt`). The detector takes the newest strong headline in a lead position that is at most 6 hours old. A trusted outlet (an outlet of the feed list, AP, Reuters or AFP) with a direct link wins when it is at most 1.5 hours older than the newest one. A live blog, a video clip, an aggregator (Yahoo, MSN, ...), an aftermath or feature headline and a headline with an old death toll do not win. The pulse skips the same items, so a live alert always has a strong article of at most 6 hours. A paywall site comes after a free one. The article stays the same from run to run until a new article is more than 1.5 hours newer. `since` is the first report of the story, and it stays the same while the story lasts.
9. The `key` is the country, the kind and the UTC day of the first evidence (`BGR-accident-20261110`). A business key also names the company or market (`USA-business-20261112-Q182477`), and the alert has a `subject` field. New outlets do not change it, and the server keeps the key of an alert for the life of the story. With no state, the key can change in one case: the first headline of a story is from before 00:00 UTC, and it leaves its feed while all other headlines are from after 00:00. Then the key moves to the next day. The client treats the two keys as one story (see [Design](#design), "Story identity").
10. The state. Each run starts from the state of the last run: the live alerts (with their wave, peak and article), the stories that ended in the last 48 hours, and the days on which alerts started. The life rules follow the story of an alert (its links and words), not every story of that country and kind. A new alert that passes the full test comes before a held alert. The server keeps this state in memory, and on Vercel also in the Runtime Cache (26-hour TTL), so a new instance continues from the same state.
11. A failed feed. When a source fails or times out, the server uses its last good answer, if that answer is at most 30 minutes old. Each headline keeps its own date, so its age stays true. `sources.ok` counts only the live answers, and `sources.reused` counts the reused ones. The last good answers stay in memory only.

Limits:

- Precision comes first: the detector prefers a miss to a false alarm. It reads English headlines only, so an event that only local or non-English media report can come late or not at all.
- A Vercel CDN region caches the answer for 5 minutes (`s-maxage=300`). When fewer than half of the sources answer, the cache is 60 seconds, and the run does not change the state.
- The Runtime Cache is regional and can drop an entry at any time. A failed read looks the same as a missing entry. Then the life rules start again from the memory of the instance, or from no state. With no state, the memory of ended stories and of recurring wars is lost, and the rules fail open. A new instance with no state does not write an empty state over the shared one. The client also keeps a dropped alert for one more poll.
- The rules are regular expressions. When a false alarm happens, save the inputs and add a test (see below).
- The life constants are not yet calibrated on a week of live data. The 6-hour pulse has little margin: in the saved real alerts, the newest strong lead was at most 5.6 hours old. At night, a real story can end before outlets stop leading with it; a new wave then brings it back. The 72-hour story cap and the chronic-wave values (6 outlets, 3 leads, 20 dead) are judgments. Save hourly snapshots (`--save`) before you change them.
- Some outlets change the date of an old link when they edit the article (BBC). A new wave ignores old links, but such a link can keep the pulse of a live alert.
- Business: the thresholds are not calibrated on a real peak. A replay of the Nvidia resignation (live titles, shifted back in time) reached only 4 outlets, because the peak-hour items had left the feeds. The feeds are general front pages and 8 Google News editions, so a national business event (a 5% Sensex fall, a Nigerian bank collapse) seldom reaches 4 outlets. Wikidata can be late with a new CEO, and the role forms ("<company> CEO resigns") do not need the name. The index levels and the currency rates in `business.ts` are approximate (late 2025): refresh them each year. A company named after a common word ("Apple", "Shell") counts only with a business word near it.
- The leader names come from `public/data/countries.json`. A new leader is unknown until the next `npm run data` and `npm run aliases:breaking`.
- The gazetteer does not know the edition of a feed. "Perth" goes to Australia, also in a UK story. A club or a company with the name of a city gets the country of that city ("Liverpool"). A name that two countries share ("Birmingham", "Victoria") or a district that GeoNames does not list ("Gangnam") does not match. Add such a place to `EXTRA_PLACES` in `scripts/build-aliases.mjs` only when it names one country with no doubt.

Tools:

- `npx tsx test/breaking/snapshot.ts`: a live run that prints the flagged headlines, the candidates and the response. `--save <name>` saves the flagged headlines to `test/breaking/fixtures/<name>.json` (5 to 10 KB). Add `--wide` to also save every headline that names a country, with no link (about 50 KB), so that a later rule change can be checked against headlines that the rules did not flag. `--replay <file>` runs the detector on a saved file. `--state <file>` gives a saved detector state to the run, to check the life rules. For each story the tool prints the pulse (fresh leads, outlets in the window), the cluster voices (`cluster=+3`), the wave, the reason and the article of the chip.

## Refresh the country data

```sh
npm run data
npm run aliases
npm run aliases:breaking
npm run places:breaking
npm run companies:breaking
```

`npm run data` takes 3 to 4 minutes. It writes `public/data/world.json`, `public/data/countries.json` and `api/_lib/countries.json`. Leaders come from live Wikidata. After a run, check the `GOVERNMENT_OVERRIDES` list in `scripts/build-data.mjs`: it holds hand fixes for holders that Wikidata gets wrong or does not have (for example Guyana: the Wikidata item of the Prime Minister has the label "Hugo Chávez"). Then build the two alias tables, the place gazetteer and the company list again, and commit all the JSON files. Run `npm run companies:breaking` also each month: CEOs change. Read the CEO diff that it prints. Refresh the G-SIB list in `scripts/companies-extra.json` each November (FSB). GeoNames changes every day, so a rebuild of the gazetteer gives a small diff.

## Data sources and terms

- Country shapes: [world-atlas](https://github.com/topojson/world-atlas) (Natural Earth, public domain).
- Country facts: [mledoze/countries](https://github.com/mledoze/countries) (ODbL), [Wikidata](https://www.wikidata.org) (CC0), [World Bank Open Data](https://data.worldbank.org) (CC BY 4.0) and the IANA time zone database.
- Flags: [flagcdn.com](https://flagcdn.com) and Wikimedia Commons.
- Satellite image: EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025), CC BY-NC-SA 4.0, modified. Polar ice: NASA Blue Marble Next Generation, credit NASA Earth Observatory. See [Texture licence](#texture-licence).
- Fonts: Inter Tight and JetBrains Mono (SIL Open Font License).
- News and breaking news:
  - Google News RSS (all editions and search), and the RSS feeds of BBC, Al Jazeera, The Guardian, France 24, DW, NPR, Sky News, ABC Australia, CBC, The Times of India, The New York Times and Euronews.
  - [NewsData.io](https://newsdata.io) (optional): follow its terms for your plan.
  - Translations: [DeepL API](https://www.deepl.com/pro-api) (optional). The server sends only the titles, never article text. The panel footer credits DeepL when a translated title shows. "Read in English" links to the Google Translate page proxy; Worldly does not copy the translated page.
  - Wikipedia "In the news" (CC BY-SA 4.0), [GDACS](https://www.gdacs.org) and the [USGS](https://earthquake.usgs.gov) earthquake feed (US public domain). None of them starts an alert. They confirm, raise or limit an alert that the news feeds start.
  - Breaking-news companies: [Wikidata](https://www.wikidata.org) (CC0): revenue, market value, total assets, stock exchange listings, headquarters, CEO, chair and founders (`api/_lib/breaking/companies.json`, built by `npm run companies:breaking`). The common-word filter uses the 3esl list (public domain). The list of global systemically important banks comes from the Financial Stability Board.
  - Breaking-news place names: [GeoNames](https://www.geonames.org) (CC BY 4.0): cities1000, the admin1 and admin2 codes, and the English alternate names. Worldly selected, filtered and grouped the names (`api/_lib/breaking/places.json`, built by `npm run places:breaking`). Physical and marine feature names come from [Natural Earth](https://www.naturalearthdata.com) (public domain). The common-word filter uses the 3esl list of alt12dicts by Alan Beale (public domain, through [SCOWL](http://wordlist.aspell.net)). The person-name filter uses Wikidata given names (CC0) and the US Census Bureau 2010 surname list (public domain).
- Publisher ratings:
  - Lean: [Media Bias/Fact Check](https://mediabiasfactcheck.com), through its official RapidAPI product. The terms require a link to MBFC and do not allow redistribution, so the table stays out of git and out of the browser. The MBFC scale is tailored to the United States.
  - State media tags: Dragomir, M. (2026). State Media Monitor Global Dataset 2026 (Version 2026.1) [Data set]. Media and Journalism Research Center (MJRC). https://doi.org/10.5281/zenodo.23863495, CC BY 4.0. Worldly added domain names.

**Terms risk (all news feeds).** The feed terms of Google News, The Times of India, Al Jazeera and The Guardian allow personal, non-commercial use only. The terms of the other feeds were not all checked. Worldly is a public site, and it uses all of these feeds for the news plate and for breaking news. The owner accepts this risk for this non-commercial site. For commercial use, replace the feeds with a licensed source.

Worldly links each story to the publisher. It does not copy article text. Show BBC stories as "BBC News", with no BBC logo.

## License

The code is licensed under the [MIT License](LICENSE).

These files keep their own licences. The MIT License does not apply to them:

- `public/textures/earth-2025-*`: CC BY-NC-SA 4.0 (EOX, modified). See [Texture licence](#texture-licence) and `public/textures/LICENSE.md`.
- `public/data/countries.json` and the files made from it: ODbL (mledoze/countries) and CC BY 4.0 (World Bank Open Data). Wikidata is CC0.
- `public/data/world.json`: Natural Earth, public domain.
- `api/_lib/state-media.json`: CC BY 4.0 (State Media Monitor, MJRC). Worldly added domain names.
- `api/_lib/breaking/places.json`: CC BY 4.0 (GeoNames, https://www.geonames.org). Worldly selected, filtered and grouped the names.
- `src/assets/fonts/` and `mockups/swiss/fonts/`: SIL Open Font License.

The MBFC table is not in the repo. Each build gets it with the owner's own RapidAPI key.
