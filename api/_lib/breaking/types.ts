// Internal shapes of the breaking-news detector. The public response shapes are in src/types.ts.
import type { BreakingKind, BreakingLevel } from '../../../src/types';

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
  sources: { ok: number; total: number; reused?: number } | null; // `ok` counts live answers only
}

export type Family = BreakingKind;

/** One alert of the last run. The hold uses it to keep a story near the threshold on the alert list. */
export interface HeldAlert {
  key: string; // BreakingAlert.key in the last run
  country: string; // CountryId
  family: Family;
  level: BreakingLevel; // the level in the last run
  since: number; // epoch ms: the earliest first evidence that the runs saw
  firstAlertAt: number; // epoch ms: the run that first gave the alert
  lastQualifiedAt: number; // epoch ms: the last run where the story passed the full test
  // The identity of the story. The key is the same for all stories of one country, kind and day, so the
  // hold also needs these to find the same story again.
  itemIds: string[]; // short hashes of the item URLs of the story (this run and the last runs)
  words: string[]; // the distinctive words of the headlines of the story, the most frequent first
}

/** The memory of the detector between runs. `detect()` takes it as an argument and returns the next state. */
export interface BreakingState {
  v: 1;
  savedAt: number; // epoch ms: `now` of the run that made the state
  alerts: HeldAlert[];
}

/** The result of `classify()` for one headline. */
export interface Classification {
  family: Family;
  tier: 1 | 2 | 3; // 3: critical-class, 2: major-class, 1: supports a story only
  deaths: number;
}
