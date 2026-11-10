// Replays saved real inputs through the detector. Each expected result was judged by hand:
// the reason is in the test name and in the fixture "note".
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detect } from '../../api/_lib/breaking/detect.js';
import { fromFixture, type Fixture } from './fixture.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const replay = (name: string) => detect(fromFixture(JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as Fixture)).response;
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
});
