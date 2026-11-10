import { describe, expect, it } from 'vitest';
import { mockBreaking } from '../../src/dev/breaking-mock';
import {
  MAX_AGE_MS,
  MAX_ALERTS,
  POLL_BACKOFF_MS,
  POLL_MS,
  SessionSet,
  ageWords,
  announcement,
  newKeys,
  nextPollDelay,
  parseAlert,
  parseBreakingResponse,
  sameView,
  sortAlerts,
  stripBadge,
  visibleAlerts,
  withBadge,
} from '../../src/ui/alerts-model';
import type { BreakingAlert } from '../../src/ui/alerts-types';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

function alert(p: Partial<BreakingAlert> & Pick<BreakingAlert, 'key' | 'country'>): BreakingAlert {
  return {
    level: 'major',
    kind: 'disaster',
    headline: 'Headline',
    url: 'https://example.com/a',
    source: 'BBC News',
    since: iso(30),
    updatedAt: iso(10),
    outlets: 3,
    basis: ['news'],
    ...p,
  };
}

const names: Record<string, string> = { UKR: 'Ukraine', JPN: 'Japan', LBN: 'Lebanon', FRA: 'France' };
const nameOf = (id: string) => names[id] ?? null;
const resolve = (id: string) => (names[id.toUpperCase()] ? id.toUpperCase() : null);

describe('parseBreakingResponse', () => {
  it('accepts the DEV mock (the shared contract)', () => {
    const list = parseBreakingResponse(mockBreaking('mock', NOW));
    expect(list?.map((a) => a.country)).toEqual(['UKR', 'JPN', 'LBN']);
    expect(list?.[0].level).toBe('critical');
  });

  it('accepts a quiet day', () => {
    expect(parseBreakingResponse({ alerts: [], generatedAt: iso(0), sources: null })).toEqual([]);
  });

  it('rejects a body that is not a BreakingResponse', () => {
    expect(parseBreakingResponse(null)).toBeNull();
    expect(parseBreakingResponse('api error')).toBeNull();
    expect(parseBreakingResponse({ alerts: 'x' })).toBeNull();
  });

  it('drops alerts with a bad level, URL or date, and keeps the rest', () => {
    const good = alert({ key: 'a', country: 'JPN' });
    const list = parseBreakingResponse({
      alerts: [
        good,
        { ...good, key: 'b', level: 'minor' },
        { ...good, key: 'c', url: 'javascript:alert(1)' },
        { ...good, key: 'd', since: 'yesterday' },
        42,
      ],
    });
    expect(list?.map((a) => a.key)).toEqual(['a']);
  });

  it('cleans the headline and fills optional fields', () => {
    const a = parseAlert({
      key: 'k',
      country: 'FRA',
      level: 'major',
      headline: '  Two\n lines  ',
      url: 'https://x.org',
      since: iso(5),
    });
    expect(a).toMatchObject({ headline: 'Two lines', source: '', updatedAt: iso(5), outlets: 1, basis: [], kind: 'politics' });
  });
});

describe('order and filters', () => {
  it('puts critical first, then the newest evidence', () => {
    const list = sortAlerts([
      alert({ key: 'old-major', country: 'FRA', updatedAt: iso(50) }),
      alert({ key: 'new-major', country: 'JPN', updatedAt: iso(1) }),
      alert({ key: 'old-critical', country: 'UKR', level: 'critical', updatedAt: iso(90) }),
    ]);
    expect(list.map((a) => a.key)).toEqual(['old-critical', 'new-major', 'old-major']);
  });

  it('drops dismissed keys, unknown countries and a second alert for one country', () => {
    const list = visibleAlerts(
      [
        alert({ key: 'a', country: 'jpn' }),
        alert({ key: 'b', country: 'JPN', level: 'critical' }),
        alert({ key: 'c', country: 'ZZZ' }),
        alert({ key: 'd', country: 'FRA' }),
      ],
      new Set(['d']),
      resolve,
      NOW,
    );
    expect(list.map((a) => [a.key, a.country])).toEqual([['b', 'JPN']]);
  });

  it('shows at most MAX_ALERTS', () => {
    const list = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c) => alert({ key: c, country: c }));
    expect(visibleAlerts(list, new Set(), (id) => id, NOW)).toHaveLength(MAX_ALERTS);
  });

  it('drops an alert with no evidence in the last 24 hours', () => {
    const list = [
      alert({ key: 'fresh', country: 'JPN', since: iso(60 * 30), updatedAt: iso(60 * 23) }),
      alert({ key: 'stale', country: 'FRA', since: iso(60 * 30), updatedAt: iso(MAX_AGE_MS / 60_000 + 1) }),
    ];
    expect(visibleAlerts(list, new Set(), resolve, NOW).map((a) => a.key)).toEqual(['fresh']);
  });

  it('compares what the chip shows, but not the age', () => {
    const a = [alert({ key: 'a', country: 'JPN' }), alert({ key: 'b', country: 'FRA' })];
    expect(sameView(a, a.map((x) => ({ ...x, updatedAt: iso(0), outlets: 9 })))).toBe(true);
    expect(sameView(a, [a[1], a[0]])).toBe(false);
    expect(sameView(a, a.slice(0, 1))).toBe(false);
    expect(sameView(a, [{ ...a[0], headline: 'New headline' }, a[1]])).toBe(false);
    expect(sameView(a, [{ ...a[0], level: 'critical' }, a[1]])).toBe(false);
    expect(sameView(a, [a[0], { ...a[1], url: 'https://example.com/b' }])).toBe(false);
  });

  it('finds the keys that are new', () => {
    const list = [alert({ key: 'a', country: 'JPN' }), alert({ key: 'b', country: 'FRA' })];
    expect(newKeys(list, new Set(['a']))).toEqual(['b']);
    expect(newKeys(list, new Set(['a', 'b']))).toEqual([]);
  });
});

describe('announcement', () => {
  it('names one country and the headline', () => {
    expect(announcement([alert({ key: 'a', country: 'FRA', headline: 'Strike closes ports.' })], nameOf)).toBe(
      'Breaking news in France: Strike closes ports.',
    );
  });

  it('lists several countries', () => {
    const two = [alert({ key: 'a', country: 'UKR' }), alert({ key: 'b', country: 'JPN' })];
    expect(announcement(two, nameOf)).toBe('Breaking news in 2 countries: Ukraine and Japan.');
    const three = [...two, alert({ key: 'c', country: 'LBN' })];
    expect(announcement(three, nameOf)).toBe('Breaking news in 3 countries: Ukraine, Japan and Lebanon.');
  });

  it('says nothing when nothing is new', () => {
    expect(announcement([], nameOf)).toBe('');
  });
});

describe('title badge', () => {
  it('adds, replaces and removes the count', () => {
    expect(withBadge('Worldly', 1)).toBe('(1) Worldly');
    expect(withBadge('(1) Japan · Worldly', 3)).toBe('(3) Japan · Worldly');
    expect(stripBadge('(3) Japan · Worldly')).toBe('Japan · Worldly');
    expect(withBadge('(2) Worldly', 0)).toBe('Worldly');
  });
});

describe('ageWords', () => {
  it('reads the age in words', () => {
    expect(ageWords(iso(0), NOW)).toBe('just now');
    expect(ageWords(iso(1), NOW)).toBe('1 minute ago');
    expect(ageWords(iso(12), NOW)).toBe('12 minutes ago');
    expect(ageWords(iso(120), NOW)).toBe('2 hours ago');
    expect(ageWords(iso(60 * 49), NOW)).toBe('2 days ago');
    expect(ageWords('bad', NOW)).toBeNull();
  });
});

describe('nextPollDelay', () => {
  it('polls every 5 minutes with ±10 % jitter', () => {
    expect(nextPollDelay(0, 0)).toBe(POLL_MS * 0.9);
    expect(nextPollDelay(2, 1)).toBe(POLL_MS * 1.1);
  });

  it('backs off to 15 minutes after 3 failures in a row', () => {
    expect(nextPollDelay(3, 0.5)).toBe(POLL_BACKOFF_MS);
  });

  it('polls every 15 minutes while the page is hidden', () => {
    expect(nextPollDelay(0, 0.5, true)).toBe(POLL_BACKOFF_MS);
    expect(nextPollDelay(0, 0.5, false)).toBe(POLL_MS);
  });
});

describe('SessionSet', () => {
  function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }

  it('keeps keys across instances (a reload)', () => {
    const s = memory();
    new SessionSet('k', s).add('a', 'b');
    expect(new SessionSet('k', s).has('b')).toBe(true);
  });

  it('works when storage throws or holds junk', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const set = new SessionSet('k', throwing);
    set.add('a');
    expect(set.has('a')).toBe(true);
    const junk = memory();
    junk.data.set('k', '{not json');
    expect(new SessionSet('k', junk).has('a')).toBe(false);
    expect(new SessionSet('k', null).has('a')).toBe(false);
  });

  it('keeps only the newest entries', () => {
    const s = memory();
    const set = new SessionSet('k', s, 2);
    set.add('a', 'b', 'c');
    expect([...set.asSet()]).toEqual(['b', 'c']);
    expect(s.data.get('k')).toBe('["b","c"]');
  });
});

describe('DEV mock', () => {
  it('has 1 critical and 2 major alerts, and variants', () => {
    const all = mockBreaking('mock', NOW).alerts;
    expect(all.filter((a) => a.level === 'critical')).toHaveLength(1);
    expect(all.filter((a) => a.level === 'major')).toHaveLength(2);
    expect(mockBreaking('mock-none', NOW).alerts).toEqual([]);
    expect(mockBreaking('mock-major', NOW).alerts.map((a) => a.level)).toEqual(['major']);
  });
});
