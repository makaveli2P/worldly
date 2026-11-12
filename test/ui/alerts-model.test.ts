import { describe, expect, it } from 'vitest';
import { mockBreaking } from '../../src/dev/breaking-mock';
import {
  MAX_AGE_MS,
  MAX_ALERTS,
  POLL_BACKOFF_MS,
  POLL_MS,
  NO_ALERTS,
  SAME_STORY_MS,
  StorySet,
  ageWords,
  announcement,
  holdDropped,
  newStories,
  nextIndex,
  nextPollDelay,
  parseAlert,
  parseBreakingResponse,
  sameStory,
  sameView,
  shownIndex,
  sortAlerts,
  stripBadge,
  visibleAlerts,
  withBadge,
} from '../../src/ui/alerts-model';
import type { BreakingAlert } from '../../src/types';

const NOW = Date.parse('2026-11-10T12:00:00Z');

/** A StoryMatcher that knows only keys. `none.with('a')` knows the key 'a'. */
const none = {
  has: () => false,
  with: (...keys: string[]) => ({ has: (a: { key: string }) => keys.includes(a.key) }),
};
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
      none.with('d'),
      resolve,
      NOW,
    );
    expect(list.map((a) => [a.key, a.country])).toEqual([['b', 'JPN']]);
  });

  it('shows at most MAX_ALERTS', () => {
    const list = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c) => alert({ key: c, country: c }));
    expect(visibleAlerts(list, none, (id) => id, NOW)).toHaveLength(MAX_ALERTS);
  });

  it('drops an alert with no evidence in the last 24 hours', () => {
    const list = [
      alert({ key: 'fresh', country: 'JPN', since: iso(60 * 30), updatedAt: iso(60 * 23) }),
      alert({ key: 'stale', country: 'FRA', since: iso(60 * 30), updatedAt: iso(MAX_AGE_MS / 60_000 + 1) }),
    ];
    expect(visibleAlerts(list, none, resolve, NOW).map((a) => a.key)).toEqual(['fresh']);
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

  it('finds the stories that are new', () => {
    const list = [alert({ key: 'a', country: 'JPN' }), alert({ key: 'b', country: 'FRA' })];
    expect(newStories(list, none.with('a')).map((a) => a.key)).toEqual(['b']);
    expect(newStories(list, none.with('a', 'b'))).toEqual([]);
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

describe('StorySet', () => {
  function memory(): Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  }
  const a = alert({ key: 'JPN-disaster-20261110', country: 'JPN', since: iso(30) });
  const b = alert({ key: 'FRA-attack-20261110', country: 'FRA', kind: 'attack' });

  it('keeps stories across instances (a reload)', () => {
    const s = memory();
    new StorySet('k', s).add(a, b);
    const again = new StorySet('k', s);
    expect(again.has(b)).toBe(true);
    expect(again.keys()).toEqual([a.key, b.key]);
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
    const set = new StorySet('k', throwing);
    set.add(a);
    expect(set.has(a)).toBe(true);
    const junk = memory();
    junk.data.set('k', '{not json');
    expect(new StorySet('k', junk).has(a)).toBe(false);
    junk.data.set('k', '[1, null, {"nokey": true}]');
    expect(new StorySet('k', junk).keys()).toEqual([]);
    expect(new StorySet('k', null).has(a)).toBe(false);
  });

  it('reads the key list of the format before 0.2.0, as keys only', () => {
    const s = memory();
    s.data.set('k', JSON.stringify([a.key]));
    const set = new StorySet('k', s);
    expect(set.has(a)).toBe(true);
    // A legacy entry has no country, so it cannot match a moved key.
    expect(set.has({ ...a, key: 'JPN-disaster-20261111' })).toBe(false);
  });

  it('keeps only the newest entries', () => {
    const s = memory();
    const set = new StorySet('k', s, 2);
    const c = alert({ key: 'c', country: 'DEU' });
    set.add(a, b, c);
    expect(set.keys()).toEqual([b.key, 'c']);
    expect(JSON.parse(s.data.get('k')!).map((r: { key: string }) => r.key)).toEqual([b.key, 'c']);
  });

  it('knows a story whose key moved at 00:00 UTC', () => {
    const set = new StorySet('k', memory());
    const before = alert({ key: 'UKR-attack-20261109', country: 'UKR', kind: 'attack', since: '2026-11-09T23:40:00Z' });
    set.add(before);
    const after = { ...before, key: 'UKR-attack-20261110', since: '2026-11-10T00:20:00Z' };
    expect(set.has(after)).toBe(true);
    // Another kind, another country, or a since 24 h or more later is a new story.
    expect(set.has({ ...after, kind: 'disaster' })).toBe(false);
    expect(set.has({ ...after, country: 'RUS' })).toBe(false);
    expect(set.has({ ...after, since: new Date(Date.parse(before.since) + SAME_STORY_MS).toISOString() })).toBe(false);
  });

  it('follows a moved key, so a second move a day later is still known', () => {
    const set = new StorySet('k', memory());
    const day1 = alert({ key: 'SDN-conflict-20261108', country: 'SDN', kind: 'conflict', since: '2026-11-08T22:00:00Z' });
    const day2 = { ...day1, key: 'SDN-conflict-20261109', since: '2026-11-09T18:00:00Z' };
    const day3 = { ...day1, key: 'SDN-conflict-20261110', since: '2026-11-10T14:00:00Z' };
    set.add(day1);
    expect(set.has(day3)).toBe(false); // 40 h after day1
    set.follow([day2]);
    expect(set.hasKey(day2.key)).toBe(true);
    expect(set.has(day3)).toBe(true); // 20 h after day2
    // follow() adds nothing for a story that is not known.
    set.follow([b]);
    expect(set.hasKey(b.key)).toBe(false);
  });
});

describe('story identity', () => {
  const base = alert({ key: 'UKR-disaster-20261109', country: 'UKR', since: '2026-11-09T23:50:00Z' });

  it('matches the same key, or the same country and kind less than 24 h apart', () => {
    expect(sameStory(base, { ...base })).toBe(true);
    expect(sameStory(base, { ...base, key: 'UKR-disaster-20261110', since: '2026-11-10T00:10:00Z' })).toBe(true);
    expect(sameStory(base, { ...base, key: 'x', since: '2026-11-08T23:51:00Z' })).toBe(true);
    expect(sameStory(base, { ...base, key: 'x', since: '2026-11-10T23:50:00Z' })).toBe(false);
    expect(sameStory(base, { ...base, key: 'x', kind: 'accident' })).toBe(false);
    expect(sameStory(base, { ...base, key: 'x', country: 'POL' })).toBe(false);
  });

  it('keeps a dismissed story hidden when its key moves at 00:00 UTC', () => {
    const dismissed = new StorySet('k', null);
    dismissed.add(base);
    const moved = { ...base, key: 'UKR-disaster-20261110', since: '2026-11-10T00:10:00Z', updatedAt: iso(5) };
    const other = alert({ key: 'FRA-attack-20261110', country: 'FRA', kind: 'attack' });
    expect(visibleAlerts([moved, other], none, resolve, NOW).map((a) => a.key)).toEqual([moved.key, other.key]);
    expect(visibleAlerts([moved, other], dismissed, resolve, NOW).map((a) => a.key)).toEqual([other.key]);
  });

  it('does not count a moved key as a new alert', () => {
    const announced = new StorySet('k', null);
    announced.add(base);
    const moved = { ...base, key: 'UKR-disaster-20261110', since: '2026-11-10T00:10:00Z' };
    const fresh = alert({ key: 'JPN-disaster-20261110', country: 'JPN' });
    expect(newStories([moved, fresh], announced).map((a) => a.key)).toEqual([fresh.key]);
  });
});

describe('holdDropped', () => {
  const jpn = alert({ key: 'JPN-disaster-20261110', country: 'JPN' });
  const fra = alert({ key: 'FRA-attack-20261110', country: 'FRA', kind: 'attack' });

  it('keeps a dropped alert for one more poll, then lets it go', () => {
    const p1 = holdDropped(NO_ALERTS, [jpn, fra]);
    expect(p1.alerts.map((a) => a.key)).toEqual([jpn.key, fra.key]);
    const p2 = holdDropped(p1, [jpn]);
    expect(p2.alerts.map((a) => a.key)).toEqual([jpn.key, fra.key]);
    expect(p2.missed.get(fra.key)).toBe(1);
    const p3 = holdDropped(p2, [jpn]);
    expect(p3.alerts.map((a) => a.key)).toEqual([jpn.key]);
  });

  it('resets the count when the alert comes back', () => {
    const p2 = holdDropped(holdDropped(NO_ALERTS, [fra]), []);
    const p3 = holdDropped(p2, [fra]);
    expect(p3.missed.size).toBe(0);
    const p4 = holdDropped(p3, []);
    expect(p4.alerts.map((a) => a.key)).toEqual([fra.key]);
  });

  it('holds nothing when the story comes back under a new key', () => {
    const moved = { ...jpn, key: 'JPN-disaster-20261111' };
    const p2 = holdDropped(holdDropped(NO_ALERTS, [jpn]), [moved]);
    expect(p2.alerts.map((a) => a.key)).toEqual([moved.key]);
  });

  it('holds nothing with polls = 0', () => {
    expect(holdDropped(holdDropped(NO_ALERTS, [jpn]), [], 0).alerts).toEqual([]);
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

describe('chip rotation', () => {
  it('moves to the next index and wraps after the last', () => {
    expect([0, 1, 2].map((i) => nextIndex(i, 3))).toEqual([1, 2, 0]);
    expect(nextIndex(0, 1)).toBe(0);
    expect(nextIndex(0, 0)).toBe(0);
  });

  const ukr = alert({ key: 'u', country: 'UKR', level: 'critical' });
  const jpn = alert({ key: 'j', country: 'JPN' });
  const lbn = alert({ key: 'l', country: 'LBN', kind: 'attack' });

  it('keeps the alert on screen when a poll still has it, at its new index', () => {
    expect(shownIndex(jpn, [ukr, jpn, lbn])).toBe(1);
    expect(shownIndex(jpn, [jpn, lbn])).toBe(0);
  });

  it('keeps the alert on screen when its key moved at 00:00 UTC (sameStory)', () => {
    const moved = { ...lbn, key: 'l2', since: iso(20) };
    expect(shownIndex(lbn, [ukr, jpn, moved])).toBe(2);
  });

  it('starts from the top when the alert on screen is gone, or when nothing was on screen', () => {
    expect(shownIndex(lbn, [ukr, jpn])).toBe(0);
    expect(shownIndex(null, [ukr, jpn])).toBe(0);
    expect(shownIndex(lbn, [])).toBe(0);
  });

  it('shows the first new story at once, in list order', () => {
    expect(shownIndex(ukr, [ukr, jpn, lbn], [lbn])).toBe(2);
    expect(shownIndex(ukr, [ukr, jpn, lbn], [lbn, jpn])).toBe(1);
    // A fresh key that is not in the list does not count.
    expect(shownIndex(jpn, [ukr, jpn], [lbn])).toBe(1);
  });
});
