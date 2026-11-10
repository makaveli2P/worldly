// Internal shapes of the breaking-news detector. The public response shapes are in src/types.ts.
import type { BreakingKind } from '../../../src/types';

/** 'front': an outlet's own front page. 'gn': a Google News edition (many outlets). */
export type FeedKind = 'front' | 'gn';

/** One item of a feed, in feed order. */
export interface Headline {
  feed: string; // source id, for example "bbc_top"
  kind: FeedKind;
  edition: string | null; // Google News edition ("US", "WORLD"), else null
  position: number; // 1 = the top item of the feed
  title: string; // plain text, without " - Publisher"
  publisher: string; // "BBC News", or the <source> of a Google News item
  url: string;
  publishedAt: string | null; // ISO 8601
}

export interface ItnBlurb {
  text: string; // plain text
  date: string; // ISO 8601 (the event date from the date comment, at 00:00 UTC)
}

/** Wikipedia "In the news": the blurbs with their date, and the "Ongoing" list. */
export interface Itn {
  blurbs: ItnBlurb[];
  ongoing: string[];
}

export type HazardType = 'EQ' | 'TC' | 'FL' | 'VO';
export type HazardLevel = 'green' | 'yellow' | 'orange' | 'red';

/** A GDACS event or a USGS earthquake. */
export interface Hazard {
  source: 'gdacs' | 'usgs';
  type: HazardType;
  level: HazardLevel | null; // GDACS: the current (episode) level. USGS: the PAGER level.
  countries: string[]; // CountryId list
  name: string;
  from: string; // ISO 8601
  to: string; // ISO 8601
  url: string | null;
  magnitude: number | null;
}

/** Everything the detector needs. `detect()` is pure: the same inputs give the same output. */
export interface BreakingInputs {
  headlines: Headline[];
  itn: Itn | null; // null when the request failed
  hazards: Hazard[];
  now: number; // epoch ms
  sources: { ok: number; total: number } | null;
}

export type Family = BreakingKind;

/** The result of `classify()` for one headline. */
export interface Classification {
  family: Family;
  tier: 1 | 2 | 3; // 3: critical-class, 2: major-class, 1: supports a story only
  deaths: number;
}
