// Saved live inputs of the breaking-news detector, in a compact form.
//
// A fixture keeps only what the detector reads: per feed the position, title, date, outlet and link
// of each headline from the last 48 hours that classify() flags. The detector skips every other
// headline. That keeps a snapshot at a few KB of headlines, with no article text.
import { classify } from '../../api/_lib/breaking/classify.js';
import { CONFIG } from '../../api/_lib/breaking/detect.js';
import { FEEDS } from '../../api/_lib/breaking/sources.js';
import type { BreakingInputs, Hazard, Headline, Itn } from '../../api/_lib/breaking/types.js';

// [position, title, publishedAt, publisher (Google News only, else ""), url]
type Row = [number, string, string | null, string, string];

export interface Fixture {
  note: string;
  now: string;
  sources: { ok: number; total: number } | null;
  itn: Itn | null;
  hazards: Hazard[];
  feeds: Record<string, Row[]>;
}

/** Makes a fixture from live inputs. */
export function toFixture(inputs: BreakingInputs, note: string): Fixture {
  const feeds: Record<string, Row[]> = {};
  for (const h of inputs.headlines) {
    const time = h.publishedAt ? Date.parse(h.publishedAt) : NaN;
    if (Number.isFinite(time) && inputs.now - time > CONFIG.lookbackHours * 3.6e6) continue;
    if (classify(h.title) === null) continue;
    (feeds[h.feed] ??= []).push([h.position, h.title, h.publishedAt, h.kind === 'gn' ? h.publisher : '', h.url]);
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
    for (const [position, title, publishedAt, publisher, url] of rows) {
      headlines.push({
        feed,
        kind: src.kind,
        edition: src.edition,
        position,
        title,
        publisher: src.kind === 'gn' ? publisher : (src.publisher ?? ''),
        url: url || `https://example.invalid/${feed}/${position}`,
        publishedAt,
      });
    }
  }
  return { headlines, itn: f.itn, hazards: f.hazards, now: Date.parse(f.now), sources: f.sources };
}
