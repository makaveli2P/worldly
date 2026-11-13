// Shared contracts. Every module (globe, ui, api, scripts) builds against these shapes.

import type { MultiPolygon, Polygon } from 'geojson';

/**
 * Country key used everywhere: ISO 3166-1 alpha-3 ("IND").
 * Areas with no ISO code (Kosovo, Northern Cyprus, Somaliland, ...) use "X-<slug>" ("X-kosovo").
 */
export type CountryId = string;

/** One country shape for the globe. Produced at runtime from public/data/world.json. */
export interface CountryFeature {
  id: CountryId;
  name: string;
  geometry: Polygon | MultiPolygon;
}

/** Static facts per country. public/data/countries.json is Record<CountryId, CountryInfo>. */
export interface CountryInfo {
  id: CountryId;
  iso2: string | null;
  name: string;
  officialName: string | null;
  flag: string | null; // URL of an SVG flag
  capital: string[];
  capitalLatLng?: [number, number] | null; // [lat, lng] of capital[0], for the globe label
  region: string | null;
  subregion: string | null;
  latlng: [number, number] | null; // representative point, for globe focus
  area: number | null; // km²
  population: number | null;
  populationYear: number | null;
  languages: string[];
  currencies: { code: string; name: string; symbol: string | null }[];
  callingCode: string | null; // "+91"
  timezones: string[];
  borders: CountryId[];
  government: {
    type: string | null; // "federal parliamentary republic"
    headOfState: string | null;
    headOfStateTitle: string | null; // "President"
    headOfGovernment: string | null;
    headOfGovernmentTitle: string | null; // "Prime Minister"
  };
  economy: {
    gdpUsd: number | null; // nominal
    gdpYear: number | null;
    gdpPerCapitaUsd: number | null;
    hdi: number | null;
    hdiYear: number | null;
  };
  demographics: {
    lifeExpectancy: number | null;
    urbanPopulationPct: number | null; // optional, null when unknown
  };
  unMember: boolean | null;
  wikipedia: string | null; // English Wikipedia URL
}

export interface NewsArticle {
  title: string; // in English: a translation when translatedBy is set
  url: string; // the article itself, opened in a new tab
  source: string; // publisher name, e.g. "The Hindu"
  publishedAt: string | null; // ISO 8601
  imageUrl: string | null;
  domain?: string | null; // publisher host, for example "theguardian.com"
  lang?: string | null; // BCP-47 code of the source title when it is not English, else null
  originalTitle?: string | null; // the source title (in `lang`) when `title` is a translation, else null
  translatedBy?: 'DeepL' | null; // the translation service of `title`, else null
  outlets?: number | null; // distinct outlets that cover the same story (cluster size)
  bias?: ArticleBias | null;
}

/**
 * Publisher-level rating, never a rating of the article.
 * `lean` comes from MBFC (a US scale). `state` comes from the State Media Monitor.
 * `rater` and `ref` are null when only a state tag exists. `lean` is null with `rater` 'MBFC' when MBFC
 * rates the outlet outside the left-right scale (Questionable, Conspiracy-Pseudoscience, Satire, Pro-Science).
 */
export interface ArticleBias {
  lean: -2 | -1 | 0 | 1 | 2 | null;
  leanLabel: string | null; // "Left", "Lean left", "Centre", "Lean right", "Right"
  rater: 'MBFC' | null;
  ref: string | null; // the MBFC page of the outlet
  state: 'state-controlled' | 'captured' | 'public' | null;
  stateLabel: string | null; // "STATE-CONTROLLED", "CAPTURED", "PUBLIC"
}

/** 'feeds' = outlet front-page RSS feeds (BBC, Al Jazeera, ...). 'gdelt' is no longer used by the server. */
export type NewsProvider = 'newsdata' | 'google' | 'gdelt' | 'feeds';

/** Response of GET /api/news?country=<CountryId> */
export interface NewsResponse {
  country: CountryId;
  articles: NewsArticle[]; // at most 5
  provider: NewsProvider | null; // null when every provider failed
  fetchedAt: string; // ISO 8601
}

// ---------- Breaking news (GET /api/breaking) ----------

export type BreakingLevel = 'critical' | 'major';
export type BreakingKind = 'conflict' | 'attack' | 'disaster' | 'accident' | 'politics' | 'business';

export interface BreakingAlert {
  key: string; // stable id of the story: the same across polls while the story lasts
  country: CountryId; // ISO3 id as in public/data/countries.json
  level: BreakingLevel;
  kind: BreakingKind;
  // `headline`, `url`, `source` and `publishedAt` describe one article: a current representative of the story.
  headline: string; // plain text, at most 200 chars
  url: string; // the article (or the GDACS/USGS/Wikipedia page)
  source: string; // "BBC News"
  publishedAt?: string | null; // ISO 8601, the date of that article; null when it has no date (absent from an older server)
  since: string; // ISO 8601, first evidence of the story ("first reported"); it stays the same while the story lasts
  updatedAt: string; // ISO 8601, newest evidence
  outlets: number;
  basis: ('news' | 'itn' | 'gdacs' | 'usgs')[];
  // Business alerts only: the company (a Wikidata QID such as "Q182477") or the market ("mkt-USA") of the
  // story. Two business stories of one country and day have different subjects.
  subject?: string;
}

/** Response of GET /api/breaking. At most 3 alerts, most severe first. [] on a quiet day. */
export interface BreakingResponse {
  alerts: BreakingAlert[];
  generatedAt: string; // ISO 8601
  // Upstream sources that answered live; null after a failure. `reused` (only when more than 0): failed
  // sources whose last good answer (at most 30 minutes old) the server used. Clients can ignore it.
  sources: { ok: number; total: number; reused?: number } | null;
}
