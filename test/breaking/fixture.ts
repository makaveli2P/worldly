// Saved live inputs of the breaking-news detector, in a compact form.
//
// A fixture keeps only what the detector reads: per feed the position, title, date, outlet and link
// of each headline from the last 48 hours that classify() flags. The detector skips every other
// headline. That keeps a snapshot at a few KB of headlines, with no article text.
// With `wide`, a fixture also keeps every headline that names a country, so that a later rule
// change can be checked against headlines that the rules did not flag on the day of the save.
import { classify } from '../../api/_lib/breaking/classify.js';
import { CONFIG } from '../../api/_lib/breaking/detect.js';
import { namesAnyCountry } from '../../api/_lib/breaking/match.js';
import { FEEDS } from '../../api/_lib/breaking/sources.js';
import type { BreakingInputs, Hazard, Headline, Itn } from '../../api/_lib/breaking/types.js';

// [position, title, publishedAt, publisher (Google News only, else ""), url, cluster (Google News only, optional)]
// A fixture saved before the cluster field has rows of 5 values: their items have no cluster.
type Row = [number, string, string | null, string, string, string[]?];

export interface Fixture {
  note: string;
  now: string;
  sources: { ok: number; total: number } | null;
  itn: Itn | null;
  hazards: Hazard[];
  feeds: Record<string, Row[]>;
}

/** Makes a fixture from live inputs. */
export function toFixture(inputs: BreakingInputs, note: string, wide = false): Fixture {
  const feeds: Record<string, Row[]> = {};
  for (const h of inputs.headlines) {
    const time = h.publishedAt ? Date.parse(h.publishedAt) : NaN;
    if (Number.isFinite(time) && inputs.now - time > CONFIG.lookbackHours * 3.6e6) continue;
    const flagged = classify(h.title) !== null;
    if (!flagged && !(wide && namesAnyCountry(h.title))) continue;
    // The link of a headline that is not flagged is left out: it is the largest part of a row.
    const row: Row = [h.position, h.title, h.publishedAt, h.kind === 'gn' ? h.publisher : '', flagged ? h.url : ''];
    // Only a flagged item can add cluster voices, so only a flagged row keeps its cluster.
    if (flagged && h.cluster?.length) row.push(h.cluster);
    (feeds[h.feed] ??= []).push(row);
  }
  return { note, now: new Date(inputs.now).toISOString(), sources: inputs.sources, itn: inputs.itn, hazards: inputs.hazards, feeds };
}

/** Rebuilds the detector inputs from a fixture. */
export function fromFixture(f: Fixture): BreakingInputs {
  const byId = new Map(FEEDS.map((s) => [s.id, s]));
  const headlines: Headline[] = [];
  for (const [feed, rows] of Object.entries(f.feeds)) {
    const src = byId.get(feed);
    if (!src) continue;
    for (const [position, title, publishedAt, publisher, url, cluster] of rows) {
      headlines.push({
        feed,
        kind: src.kind,
        edition: src.edition,
        position,
        title,
        publisher: src.kind === 'gn' ? publisher : (src.publisher ?? ''),
        url: url || `https://example.invalid/${feed}/${position}`,
        publishedAt,
        ...(src.kind === 'gn' && cluster?.length ? { cluster } : {}),
      });
    }
  }
  return { headlines, itn: f.itn, hazards: f.hazards, now: Date.parse(f.now), sources: f.sources };
}
