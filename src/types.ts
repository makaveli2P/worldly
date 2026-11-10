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
  title: string;
  url: string; // the article itself, opened in a new tab
  source: string; // publisher name, e.g. "The Hindu"
  publishedAt: string | null; // ISO 8601
  imageUrl: string | null;
}

export type NewsProvider = 'newsdata' | 'google' | 'gdelt';

/** Response of GET /api/news?country=<CountryId> */
export interface NewsResponse {
  country: CountryId;
  articles: NewsArticle[]; // at most 5
  provider: NewsProvider | null; // null when every provider failed
  fetchedAt: string; // ISO 8601
}

// ---------- Breaking news (GET /api/breaking) ----------

export type BreakingLevel = 'critical' | 'major';
export type BreakingKind = 'conflict' | 'attack' | 'disaster' | 'accident' | 'politics';

export interface BreakingAlert {
  key: string; // stable id of the story: the same across polls while the story lasts
  country: CountryId; // ISO3 id as in public/data/countries.json
  level: BreakingLevel;
  kind: BreakingKind;
  headline: string; // plain text, at most 200 chars
  url: string; // the article (or the GDACS/USGS/Wikipedia page)
  source: string; // "BBC News"
  since: string; // ISO 8601, first evidence
  updatedAt: string; // ISO 8601, newest evidence
  outlets: number;
  basis: ('news' | 'itn' | 'gdacs' | 'usgs')[];
}

/** Response of GET /api/breaking. At most 3 alerts, most severe first. [] on a quiet day. */
export interface BreakingResponse {
  alerts: BreakingAlert[];
  generatedAt: string; // ISO 8601
  sources: { ok: number; total: number } | null; // upstream sources that answered; null after a failure
}
