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
- Colours: one accent, Swiss red, for the selection. Signal yellow is only for breaking news. The tokens are CSS custom properties on `:root[data-theme=light|dark]` in `src/styles.css`. The globe colours come from `src/theme.ts`. Keep the two files in step. `test/ui/contrast.test.ts` checks that the two files agree and that each text pair meets WCAG AA (4.5:1).
- Surfaces: the canvas uses paper. The header, the plates, the search list and the mobile sheet use panel. A 1px ink frame (2px at the top of a plate) separates a plate from the canvas and the globe. There is no shadow, radius or blur. The `theme-color` meta matches the header (panel) colour.

| Token | Light | Dark |
| --- | --- | --- |
| paper | `#E6E6E1` | `#0A0A0A` |
| panel | `#FFFFFF` | `#1A1A1A` |
| ink | `#111111` | `#F2F2EE` |
| rule | `#DCDCD7` | `#333333` |
| muted | `#5C5C58` | `#9A9A94` |
| faint | `#6B6B67` | `#8A8A84` |
| hover | `#F4F4F1` | `#202020` |
| accent | `#E5361B` | `#F24B2F` |
| alert | `#FFB800` | `#FFB800` |
| on-alert | `#111111` | `#111111` |

- Breaking news: an alert uses the alert yellow with an ink keyline, so one of the two colours is at least 3:1 on every background. Red stays the colour of the selection.
  - Globe: a yellow dot with open rings at the label point of the country, and the country name in bold. A critical alert has a larger dot, a heavier ring and a second outer ring. When the country is on the far side or off screen, a still yellow arrow with the name points to it from the globe edge.
  - Pulse: a new alert pulses 3 times in 4.8 s (0.625 Hz), then the rings stay still (WCAG 2.2.2 and 2.3.1). With `prefers-reduced-motion`, nothing pulses. The markers are DOM nodes over the canvas, so the globe does not render more frames for them.
  - Header chip (desktop: between the search and the map style; mobile: a third header row): `BREAKING`, the country, the headline, the age, a link to the story, `+N` for more alerts and a dismiss button. A click selects the country. A dismissed alert stays away for the browser session (`sessionStorage`: `worldly:breaking-dismissed`, `worldly:breaking-announced`). A polite live region announces each new alert once. While the tab is hidden, the title shows the count of new alerts, for example `(1) Worldly`.
  - To see the UI with no server data, open `http://localhost:5173/?alerts=mock` in `npm run dev` (also `mock-critical`, `mock-major` and `mock-none`). The production build does not contain the mock.

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
