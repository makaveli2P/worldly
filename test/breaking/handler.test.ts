// GET /api/breaking with a stub fetch: the response contract and the cache headers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakingResponse } from '../../src/types';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const item = (title: string, minutesAgo: number) =>
  `<item><title>${title}</title><link>https://example.org/${encodeURIComponent(title)}</link><pubDate>${new Date(NOW - minutesAgo * 60000).toUTCString()}</pubDate></item>`;
const rss = (...items: string[]) => `<rss><channel>${items.join('')}</channel></rss>`;

function stubFetch(answer: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => answer(String(input))));
}

async function get(): Promise<{ status: number; cache: string | null; body: BreakingResponse }> {
  const { GET } = await import('../../api/breaking.js');
  const res = await GET();
  return { status: res.status, cache: res.headers.get('cache-control'), body: (await res.json()) as BreakingResponse };
}

describe('GET /api/breaking', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('gives [] and the long cache on a quiet day', async () => {
    stubFetch((url) => (url.includes('gdacs') ? new Response(null, { status: 204 }) : url.includes('usgs') || url.includes('wikipedia') ? new Response('{}') : new Response(rss(item('Markets rise in Asia', 30)))));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.cache).toBe('public, s-maxage=300, stale-while-revalidate=900, stale-if-error=3600');
    expect(r.body.alerts).toEqual([]);
    expect(r.body.sources).toEqual({ ok: 25, total: 26 }); // the empty ITN answer counts as failed
    expect(r.body.generatedAt).toBe(new Date(NOW).toISOString());
  });

  it('gives the alert of a story that leads the front pages', async () => {
    const leads: Record<string, string> = {
      bbci: 'Russia invades Estonia as tanks cross border',
      aljazeera: 'Russia launches invasion of Estonia',
      theguardian: 'Russia invades Estonia in dawn assault',
      france24: 'Russian forces invade Estonia',
      'dw.com': 'Russia invades Estonia, NATO meets',
      skynews: 'Russia invades Estonia',
    };
    stubFetch((url) => {
      const lead = Object.entries(leads).find(([host]) => url.includes(host))?.[1];
      if (url.includes('gdacs')) return new Response(null, { status: 204 });
      if (url.includes('usgs') || url.includes('wikipedia')) return new Response('{}');
      return new Response(rss(lead ? item(lead, 40) : item('Markets rise in Asia', 30)));
    });
    const r = await get();
    expect(r.body.alerts.map((a) => `${a.country}:${a.level}:${a.kind}:${a.outlets}`)).toEqual(['EST:critical:conflict:6']);
  });

  it('marks a degraded answer with a short cache when fewer than half the sources answer', async () => {
    stubFetch((url) => (url.includes('bbci') ? new Response(rss(item('Markets rise', 10))) : new Response('down', { status: 503 })));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.cache).toBe('public, s-maxage=60');
    expect(r.body.sources).toEqual({ ok: 2, total: 26 });
    expect(r.body.alerts).toEqual([]);
  });

  it('shares one upstream run between calls within 5 minutes', async () => {
    const fetchMock = vi.fn(async () => new Response(rss(item('Markets rise', 10))));
    vi.stubGlobal('fetch', fetchMock);
    const { GET } = await import('../../api/breaking.js');
    await Promise.all([GET(), GET()]);
    await GET();
    expect(fetchMock).toHaveBeenCalledTimes(26);
  });
});
