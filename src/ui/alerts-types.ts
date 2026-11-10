// Breaking-news contract of GET /api/breaking. The "breaking" track owns these types.
// This is a local copy, because src/types.ts does not have them in this branch.
// When the two branches merge, move the imports to src/types.ts and delete this file.

import type { CountryId } from '../types';

export type BreakingLevel = 'critical' | 'major';
export type BreakingKind = 'conflict' | 'attack' | 'disaster' | 'accident' | 'politics';

export interface BreakingAlert {
  key: string; // stable id of the story, the same across polls while the story lasts
  country: CountryId; // ISO3 id as used in public/data/countries.json
  level: BreakingLevel;
  kind: BreakingKind;
  headline: string; // plain text, at most 200 chars
  url: string; // the article (or GDACS/USGS/Wikipedia page)
  source: string; // "BBC News"
  since: string; // ISO 8601, first evidence
  updatedAt: string; // ISO 8601, newest evidence
  outlets: number;
  basis: ('news' | 'itn' | 'gdacs' | 'usgs')[];
}

export interface BreakingResponse {
  alerts: BreakingAlert[];
  generatedAt: string;
  sources: { ok: number; total: number } | null;
}
