// DEV only: a fake GET /api/breaking body for work on the alert UI before the server exists.
// Open http://localhost:5173/?alerts=mock. main.ts imports this file only behind import.meta.env.DEV,
// so the production build does not contain it. Other values: ?alerts=mock-critical (Ukraine only),
// ?alerts=mock-major (Japan only), ?alerts=mock-none (a quiet day).
//
// 1 critical and 2 major alerts: Ukraine (large, near Europe), Japan (on the far side of the globe
// from Europe and the Americas) and Lebanon (a small country).

import type { BreakingResponse } from '../ui/alerts-types';

const ago = (min: number, now: number) => new Date(now - min * 60_000).toISOString();

export function mockBreaking(variant: string | null = 'mock', now = Date.now()): BreakingResponse {
  const all = mockAlerts(now);
  const alerts =
    variant === 'mock-critical'
      ? all.slice(0, 1)
      : variant === 'mock-major'
        ? all.slice(1, 2)
        : variant === 'mock-none'
          ? []
          : all;
  return { generatedAt: new Date(now).toISOString(), sources: { ok: 4, total: 4 }, alerts };
}

function mockAlerts(now: number): BreakingResponse['alerts'] {
  return [
    {
      key: 'mock-ukr-grid',
      country: 'UKR',
      level: 'critical',
      kind: 'conflict',
      headline: 'Large overnight missile strike hits the power grid in several regions',
      url: 'https://example.com/mock/ukraine',
      source: 'BBC News',
      since: ago(12, now),
      updatedAt: ago(4, now),
      outlets: 9,
      basis: ['news', 'itn'],
    },
    {
      key: 'mock-jpn-quake',
      country: 'JPN',
      level: 'major',
      kind: 'disaster',
      headline: 'Magnitude 7.1 earthquake off the north-east coast; tsunami advisory issued',
      url: 'https://example.com/mock/japan',
      source: 'NHK World',
      since: ago(48, now),
      updatedAt: ago(20, now),
      outlets: 6,
      basis: ['usgs', 'news'],
    },
    {
      key: 'mock-lbn-blast',
      country: 'LBN',
      level: 'major',
      kind: 'attack',
      headline: 'Explosion reported near the port of Beirut',
      url: 'https://example.com/mock/lebanon',
      source: 'Al Jazeera',
      since: ago(95, now),
      updatedAt: ago(60, now),
      outlets: 4,
      basis: ['news'],
    },
  ];
}
