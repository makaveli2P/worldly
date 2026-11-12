// getBreaking() over several runs, with a stub fetch: the hold, the last good answer of a failed feed,
// and the shared state store (a stub of the Vercel Runtime Cache).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakingResult } from '../../api/_lib/breaking/index.js';

const T1 = Date.parse('2026-11-12T10:00:00Z');
const MIN = 60_000;

const item = (title: string, minutesAgo: number) =>
  `<item><title>${title}</title><link>https://example.org/${encodeURIComponent(title)}</link><pubDate>${new Date(T1 - minutesAgo * MIN).toUTCString()}</pubDate></item>`;
const rss = (...items: string[]) => `<rss><channel>${items.join('')}</channel></rss>`;
// Wikipedia ITN with an "Ongoing" list that does not name Gaza.
const ITN = JSON.stringify({
  query: { pages: [{ revisions: [{ slots: { main: { content: '* <!--Nov 11--> Something else happens.\n{{In the news/footer\n|ongoing=\n* [[Russo-Ukrainian war]]\n|recentdeaths=\n}}' } } }] }] },
});

const STORY: Record<string, string> = {
  'feeds.bbci.co.uk/news/rss.xml': 'Israeli strike on Gaza hospital kills six Palestinians',
  'rss.dw.com': 'Six killed in Israeli strike on Gaza hospital',
  'feeds.feedburner.com/euronews': 'Israeli strike on Gaza hospital kills 6, health officials say',
};

/** The feeds of one run. `drop` feeds answer with no story; `fail` feeds answer 503. */
function stubFetch({ drop = [] as string[], fail = [] as string[] } = {}) {
  const fn = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('gdacs')) return new Response(null, { status: 204 });
    if (url.includes('usgs')) return new Response('{}');
    if (url.includes('wikipedia')) return new Response(ITN);
    const host = Object.keys(STORY).find((h) => url.includes(h));
    if (host && fail.includes(host)) return new Response('down', { status: 503 });
    if (host && !drop.includes(host)) return new Response(rss(item(STORY[host], 40)));
    return new Response(rss(item('Markets rise in Asia', 30)));
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function load() {
  return (await import('../../api/_lib/breaking/index.js')).getBreaking;
}
const brief = (r: BreakingResult) => r.response.alerts.map((a) => `${a.country}:${a.level}:${a.outlets}`);

describe('getBreaking() over several runs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T1);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.doUnmock('@vercel/functions');
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a failed feed gives its last good headlines, and the hold keeps the alert when a voice leaves (warm instance)', async () => {
    const getBreaking = await load();
    stubFetch();
    const r1 = await getBreaking();
    expect(brief(r1)).toEqual(['PSE:major:3']);
    expect(r1.response.sources).toEqual({ ok: 27, total: 27 });

    // Run 2: Euronews times out. Its last good answer (5 minutes old) keeps the third voice.
    vi.setSystemTime(T1 + 6 * MIN);
    stubFetch({ fail: ['feeds.feedburner.com/euronews'] });
    const r2 = await getBreaking();
    expect(brief(r2)).toEqual(['PSE:major:3']);
    expect(r2.response.sources).toEqual({ ok: 26, total: 27, reused: 1 });
    expect(r2.degraded).toBe(false);
    // The log names the source and the reason only.
    expect(console.warn).toHaveBeenCalledWith('[breaking] 1/27 sources failed (1 reused last good): euronews:http 503');

    // Run 3: DW drops the story. Two voices remain, one of them leads: the alert is held.
    vi.setSystemTime(T1 + 12 * MIN);
    stubFetch({ drop: ['rss.dw.com'] });
    const r3 = await getBreaking();
    expect(brief(r3)).toEqual(['PSE:major:2']);
    expect(r3.response.alerts[0].key).toBe(r1.response.alerts[0].key);
  });

  it('a degraded run keeps the state, so the next good run can still hold the alert', async () => {
    const getBreaking = await load();
    stubFetch();
    expect(brief(await getBreaking())).toEqual(['PSE:major:3']);
    // 31 minutes later every feed fails: no last good answer is new enough, and the run is degraded.
    vi.setSystemTime(T1 + 31 * MIN);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const down = await getBreaking();
    expect(down.degraded).toBe(true);
    expect(down.response.alerts).toEqual([]);
    // The next run sees 2 voices: the state of run 1 still holds the alert.
    vi.setSystemTime(T1 + 33 * MIN);
    stubFetch({ drop: ['rss.dw.com'] });
    expect(brief(await getBreaking())).toEqual(['PSE:major:2']);
  });

  it('with no shared store, a cold instance starts with no state', async () => {
    stubFetch();
    expect(brief(await (await load())())).toEqual(['PSE:major:3']);
    vi.resetModules();
    vi.setSystemTime(T1 + 6 * MIN);
    stubFetch({ drop: ['rss.dw.com'] });
    expect((await (await load())()).response.alerts).toEqual([]);
  });

  it('on Vercel, a cold instance reads the state of another instance from the Runtime Cache', async () => {
    vi.stubEnv('VERCEL', '1');
    const entries = new Map<string, unknown>();
    const set = vi.fn(async (key: string, value: unknown, options?: { ttl?: number }) => {
      expect(options?.ttl).toBe(26 * 3600);
      entries.set(key, structuredClone(value));
    });
    vi.doMock('@vercel/functions', () => ({
      getCache: () => ({ get: async (key: string) => entries.get(key) ?? null, set }),
      waitUntil: () => {},
    }));
    stubFetch();
    expect(brief(await (await load())())).toEqual(['PSE:major:3']);
    expect(set).toHaveBeenCalledTimes(1);
    expect(entries.get('breaking-state-v1')).toMatchObject({ v: 1, savedAt: T1, alerts: [{ key: 'PSE-conflict-20261112', level: 'major' }] });

    // A new instance (empty memory) sees 2 voices and holds the alert from the shared state.
    vi.resetModules();
    vi.setSystemTime(T1 + 6 * MIN);
    stubFetch({ drop: ['rss.dw.com'] });
    expect(brief(await (await load())())).toEqual(['PSE:major:2']);
  });

  // The Vercel client does not throw: on a failure, get() gives null and set() does nothing.
  // A stub of it: `readDown` and `writeDown` make get() and set() fail in that way.
  function vercelStore() {
    const entries = new Map<string, unknown>();
    const store = { readDown: false, writeDown: false, entries, writes: 0 };
    vi.doMock('@vercel/functions', () => ({
      getCache: () => ({
        get: async (key: string) => (store.readDown ? null : entries.get(key) ?? null),
        set: async (key: string, value: unknown) => {
          if (store.writeDown) return;
          store.writes += 1;
          entries.set(key, structuredClone(value));
        },
      }),
      waitUntil: () => {},
    }));
    return store;
  }
  const sharedAlerts = (store: ReturnType<typeof vercelStore>) =>
    (store.entries.get('breaking-state-v1') as { alerts: { country: string }[] } | undefined)?.alerts.map((a) => a.country);

  it('on Vercel, a failed store read on a warm instance falls back to memory', async () => {
    vi.stubEnv('VERCEL', '1');
    const store = vercelStore();
    const getBreaking = await load();
    stubFetch();
    expect(brief(await getBreaking())).toEqual(['PSE:major:3']);
    store.readDown = true;
    store.writeDown = true;
    vi.setSystemTime(T1 + 6 * MIN);
    stubFetch({ drop: ['rss.dw.com'] });
    // The memory state of this instance still holds the alert.
    expect(brief(await getBreaking())).toEqual(['PSE:major:2']);
  });

  it('on Vercel, a cold instance with a failed read does not remove the alert from the shared state', async () => {
    vi.stubEnv('VERCEL', '1');
    const store = vercelStore();
    // Instance A, run 1: the alert, written to the store.
    const instanceA = await load();
    stubFetch();
    expect(brief(await instanceA())).toEqual(['PSE:major:3']);
    expect(sharedAlerts(store)).toEqual(['PSE']);
    expect(store.writes).toBe(1);

    // Cold instance B, 6 minutes later: DW drops the story and the read fails (the write would work).
    // B cannot hold the alert, and it does not write its state.
    // (The mock stays registered after resetModules(), so each new instance uses the same store.)
    vi.resetModules();
    store.readDown = true;
    vi.setSystemTime(T1 + 6 * MIN);
    stubFetch({ drop: ['rss.dw.com'] });
    expect((await (await load())()).response.alerts).toEqual([]);
    expect(store.writes).toBe(1);
    expect(sharedAlerts(store)).toEqual(['PSE']);

    // The store works again 12 minutes after run 1. A new cold instance C reads the state of A and holds the alert.
    store.readDown = false;
    vi.resetModules();
    vi.setSystemTime(T1 + 12 * MIN);
    stubFetch({ drop: ['rss.dw.com'] });
    expect(brief(await (await load())())).toEqual(['PSE:major:2']);
    // Warm instance A also still holds it.
    expect(brief(await instanceA())).toEqual(['PSE:major:2']);
    expect(sharedAlerts(store)).toEqual(['PSE']);
  });

  it('on Vercel, a store that throws (not the Vercel client) logs a short reason only', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.doMock('@vercel/functions', () => ({
      getCache: () => ({
        get: async () => {
          throw new Error('secret detail');
        },
        set: async () => {
          throw new Error('secret detail');
        },
      }),
      waitUntil: () => {},
    }));
    const getBreaking = await load();
    stubFetch();
    expect(brief(await getBreaking())).toEqual(['PSE:major:3']);
    vi.setSystemTime(T1 + 6 * MIN);
    stubFetch({ drop: ['rss.dw.com'] });
    expect(brief(await getBreaking())).toEqual(['PSE:major:2']);
    await new Promise((r) => setTimeout(r, 0));
    const lines = vi.mocked(console.warn).mock.calls.map((c) => String(c[0]));
    expect(lines).toContain('[breaking] state read: error');
    expect(lines).toContain('[breaking] state write: error');
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('on Vercel, an invalid store entry is not used', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.doMock('@vercel/functions', () => ({
      getCache: () => ({ get: async () => ({ v: 1, savedAt: 'x', alerts: [] }), set: async () => {} }),
      waitUntil: () => {},
    }));
    stubFetch();
    expect(brief(await (await load())())).toEqual(['PSE:major:3']);
    expect(vi.mocked(console.warn).mock.calls.map((c) => String(c[0]))).toContain('[breaking] state read: invalid entry');
  });
});
