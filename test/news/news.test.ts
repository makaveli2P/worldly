// The /api/news handler with a fake fetch: deadlines, partial results and source failures. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Mode = 'ok' | 'hang' | 'reject';
interface Routes {
  google: Mode;
  /** The 2-day Google search, when it differs from the other Google feeds. */
  search2d?: Mode;
  outlets: Mode;
  /** The DeepL API: 'ok', or an HTTP error for any other mode. */
  deepl?: Mode;
}

const NOW = Date.parse('2026-11-10T12:00:00Z');

function rss(titles: string[], publisher = 'Reuters', host = 'https://www.reuters.com'): string {
  const items = titles
    .map(
      (t, i) =>
        `<item><title>${t} - ${publisher}</title><link>https://news.google.com/rss/articles/${encodeURIComponent(t)}-${i}</link>` +
        `<pubDate>${new Date(NOW - (i + 1) * 3.6e6).toUTCString()}</pubDate><source url="${host}">${publisher}</source></item>`,
    )
    .join('');
  return `<?xml version="1.0"?><rss version="2.0"><channel>${items}</channel></rss>`;
}

const GERMAN = [
  'Germany passes rent cap law after long fight in parliament',
  'German exports fall for third month in a row as demand slows',
  'Berlin police arrest suspect after attack on synagogue guard',
  'Germany orders new air defence systems for the army',
  'German rail strike halts trains across the country for two days',
];
const JAPANESE = ['首相が臨時国会で所信表明演説', '東京株式市場で日経平均が反落', '台風が小笠原諸島に最接近へ', '阿波市長を詐欺容疑で逮捕', '政府が経済対策を閣議決定'];
const VATICAN = ['Vatican City hosts climate summit for faith leaders', 'Pope meets refugees in Vatican City gardens'];

function stubFetch(routes: Routes, titles: { google: string[]; outlets: string[] }) {
  const calls: string[] = [];
  const fake = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://api-free.deepl.com/')) {
      if (routes.deepl !== 'ok') return new Response('{"message":"error"}', { status: 503 });
      const text = (JSON.parse(String(init?.body)) as { text: string[] }).text;
      return Response.json({ translations: text.map((t) => ({ text: `EN: ${t}`, detected_source_language: 'JA' })) });
    }
    const google = url.startsWith('https://news.google.com/');
    const mode = google ? (url.includes('when:2d') && routes.search2d ? routes.search2d : routes.google) : routes.outlets;
    if (mode === 'reject') throw new TypeError('fetch failed');
    if (mode === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    const body = google ? rss(titles.google) : rss(titles.outlets, 'BBC News', 'https://www.bbc.com');
    return new Response(body, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  });
  vi.stubGlobal('fetch', fake);
  return calls;
}

async function load() {
  vi.resetModules();
  return (await import('../../api/news.js')) as { GET(request: Request): Promise<Response> };
}

/** Calls the handler and moves the fake clock past the 3 s deadline while it waits. */
async function get(api: Awaited<ReturnType<typeof load>>, id: string) {
  const pending = api.GET(new Request(`http://localhost/api/news?country=${id}`));
  await vi.advanceTimersByTimeAsync(4500);
  const res = await pending;
  return {
    status: res.status,
    cache: res.headers.get('cache-control'),
    body: (await res.json()) as { articles?: { title: string; lang?: string | null; originalTitle?: string | null; translatedBy?: string | null }[] },
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(NOW);
  delete process.env.NEWSDATA_API_KEY;
  delete process.env.DEEPL_API_KEY;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/news with failing sources', () => {
  it('keeps the 1-day search items when the 2-day search hangs past the deadline', async () => {
    stubFetch({ google: 'ok', search2d: 'hang', outlets: 'ok' }, { google: VATICAN, outlets: [] });
    const r = await get(await load(), 'VAT');
    expect(r.status).toBe(200);
    expect(r.body.articles?.map((a) => a.title)).toEqual(expect.arrayContaining(VATICAN));
    expect(r.cache).toContain('s-maxage=900');
  });

  it('gives the short failure cache when Google hangs and only the outlet feeds answer', async () => {
    stubFetch({ google: 'hang', outlets: 'ok' }, { google: [], outlets: ['Germany funds Pacific restoration project for coral reefs'] });
    const r = await get(await load(), 'DEU');
    expect(r.status).toBe(200);
    expect(r.body.articles).toHaveLength(1);
    expect(r.cache).toBe('public, s-maxage=60');
  });

  it('answers 503 when no source answers, so the CDN can serve its stale copy', async () => {
    stubFetch({ google: 'reject', outlets: 'reject' }, { google: [], outlets: [] });
    const r = await get(await load(), 'DEU');
    expect(r.status).toBe(503);
    expect(r.cache).toBe('no-store');
  });

  it('serves the last good list when a later rebuild fails', async () => {
    stubFetch({ google: 'ok', outlets: 'ok' }, { google: GERMAN, outlets: [] });
    const api = await load();
    const first = await get(api, 'DEU');
    expect(first.body.articles?.length).toBeGreaterThan(0);
    expect(first.cache).toContain('s-maxage=900');

    // 11 minutes later the memory cache has expired, and every source fails.
    vi.setSystemTime(NOW + 11 * 60 * 1000);
    stubFetch({ google: 'reject', outlets: 'reject' }, { google: [], outlets: [] });
    const second = await get(api, 'DEU');
    expect(second.status).toBe(200);
    expect(second.body.articles).toEqual(first.body.articles);
    expect(second.cache).toBe('public, s-maxage=60');
  });
});

describe('GET /api/news with translation', () => {
  it('gives the native titles in English, keeps the originals, and sends one DeepL request', async () => {
    process.env.DEEPL_API_KEY = 'test-key:fx';
    const calls = stubFetch({ google: 'ok', outlets: 'ok', deepl: 'ok' }, { google: JAPANESE, outlets: [] });
    const r = await get(await load(), 'JPN');
    expect(r.status).toBe(200);
    const native = r.body.articles?.filter((a) => a.lang === 'ja') ?? [];
    expect(native.length).toBeGreaterThan(0);
    for (const a of native) {
      expect(a.translatedBy).toBe('DeepL');
      expect(JAPANESE).toContain(a.originalTitle);
      expect(a.title).toBe(`EN: ${a.originalTitle}`);
    }
    expect(calls.filter((u) => u.includes('deepl.com'))).toHaveLength(1);
    expect(r.cache).toContain('s-maxage=900');
  });

  it('keeps the native titles when DeepL fails, with the short cache so a later request tries again', async () => {
    process.env.DEEPL_API_KEY = 'test-key:fx';
    stubFetch({ google: 'ok', outlets: 'ok', deepl: 'reject' }, { google: JAPANESE, outlets: [] });
    const r = await get(await load(), 'JPN');
    expect(r.status).toBe(200);
    expect(r.cache).toBe('public, s-maxage=60');
    expect(r.body.articles?.length).toBeGreaterThan(0);
    for (const a of r.body.articles ?? []) {
      expect(a.translatedBy ?? null).toBeNull();
      expect(JAPANESE).toContain(a.title);
    }
  });
});
