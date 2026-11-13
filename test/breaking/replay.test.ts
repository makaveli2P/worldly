// Replays saved real inputs through the detector. Each expected result was judged by hand:
// the reason is in the test name and in the fixture "note".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CONFIG, detect } from '../../api/_lib/breaking/detect.js';
import type { BreakingInputs, BreakingState } from '../../api/_lib/breaking/types.js';
import { fromFixture, type Fixture } from './fixture.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const inputsOf = (name: string): BreakingInputs => fromFixture(JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Fixture);
const replay = (name: string) => detect(inputsOf(name)).response;
const brief = (name: string) => replay(name).alerts.map((a) => `${a.country}:${a.level}:${a.kind}:${a.basis.join('+')}`);

describe('replays of real inputs', () => {
  it('2026-10-23 06Z: the M7.0 Tibet quake (16 dead) is major, confirmed by GDACS and USGS, and the GDACS cyclone gives nothing', () => {
    const r = replay('replay-2026-10-23T0600Z');
    expect(brief('replay-2026-10-23T0600Z')).toEqual(['CHN:major:disaster:news+gdacs+usgs']);
    expect(r.alerts[0].headline).toBe('Tibet earthquake kills at least 16');
  });

  it('2026-10-16 08Z: the Oregon school shooting that leads BBC is major; the hazard-only Guam cyclone gives nothing', () => {
    expect(brief('replay-2026-10-16T0800Z')).toEqual(['USA:major:attack:news']);
  });

  it('2026-10-28 22:30Z: the Spain train crash is on one outlet only (BBC), so no alert; the India cyclone has no news', () => {
    expect(replay('replay-2026-10-28T2230Z').alerts).toEqual([]);
  });

  it('2026-11-10 13:15Z live: the Bulgaria motorway pile-ups (12 dead) lead DW and Sky and are on BBC: major', () => {
    const r = replay('live-2026-11-10T1315Z');
    expect(brief('live-2026-11-10T1315Z')).toEqual(['BGR:major:accident:news']);
    expect(r.alerts[0].outlets).toBe(3);
    expect(r.sources).toEqual({ ok: 26, total: 26 });
  });

  it('2026-11-10 15:10Z live: the same pile-ups on 2 outlets only (NDTV left its edition, Euronews and NYT timed out): no alert', () => {
    const r = replay('live-2026-11-10T1510Z');
    expect(r.alerts).toEqual([]);
    expect(r.sources).toEqual({ ok: 24, total: 27 });
  });

  it('2026-11-10 15:45Z live: the pile-ups on DW, Sky and Euronews are major again with the same key; the 1-death Spain explosion gives nothing', () => {
    const r = replay('live-2026-11-10T1545Z');
    expect(brief('live-2026-11-10T1545Z')).toEqual(['BGR:major:accident:news']);
    expect(r.alerts[0].key).toBe('BGR-accident-20261110');
    expect(r.alerts[0].outlets).toBe(3);
  });

  it('2026-11-10 16:30Z live, wide (every headline that names a country): the pile-ups are major on 6 outlets; no other alert', () => {
    // This snapshot also keeps the headlines that the rules did not flag, so a later rule change
    // that makes a new false alarm from an ordinary headline fails here.
    const r = replay('live-2026-11-10T1630Z-wide');
    expect(brief('live-2026-11-10T1630Z-wide')).toEqual(['BGR:major:accident:news']);
    expect(r.alerts[0].key).toBe('BGR-accident-20261110');
    // 6 since the toll-only rule: "At least 12 people killed and dozens hurt in crashes on a foggy
    // Bulgarian motorway" has no event word in the order that the accident rule reads.
    expect(r.alerts[0].outlets).toBe(6);
  });
});

const FIXTURES = [
  'replay-2026-10-16T0800Z', 'replay-2026-10-23T0600Z', 'replay-2026-10-28T2230Z',
  'live-2026-11-10T1315Z', 'live-2026-11-10T1510Z', 'live-2026-11-10T1545Z', 'live-2026-11-10T1630Z-wide',
];

describe('the article of each alert', () => {
  it.each(FIXTURES)('%s: the headline, link, source and date come from one fresh input headline', (name) => {
    const inputs = inputsOf(name);
    for (const a of detect(inputs).response.alerts) {
      // One URL can be in two feeds with two titles (BBC changes a title), so look up the link and the title.
      const h = inputs.headlines.find((x) => x.url === a.url && x.title === a.headline)!;
      expect(h).toBeDefined();
      expect([a.source, a.publishedAt]).toEqual([h.publisher, new Date(Date.parse(h.publishedAt!)).toISOString()]);
      expect(inputs.now - Date.parse(a.publishedAt!)).toBeLessThanOrEqual(CONFIG.freshHours * 3.6e6);
    }
  });
});

describe('the live Bulgaria runs in order, each with the state of the run before', () => {
  it('the alert stays in every run with one key; at 15:10 the pulse holds it (DW#2 at 3.2 h, 2 voices)', () => {
    let state: BreakingState | null = null;
    const out: string[] = [];
    for (const name of ['live-2026-11-10T1315Z', 'live-2026-11-10T1510Z', 'live-2026-11-10T1545Z', 'live-2026-11-10T1630Z-wide']) {
      const r = detect(inputsOf(name), state);
      state = r.state;
      const bgr = r.candidates.find((c) => c.id === 'BGR')!;
      out.push(`${r.response.alerts.map((a) => `${a.key}:${a.level}`).join(',')} ${bgr.reason}`);
    }
    expect(out).toEqual([
      'BGR-accident-20261110:major major',
      'BGR-accident-20261110:major held: fresh lead',
      'BGR-accident-20261110:major major',
      'BGR-accident-20261110:major major',
    ]);
  });
});
