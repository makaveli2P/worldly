// The DeepL step of the news build (api/_lib/translate.ts), with a fake fetch. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_MAX_ENTRIES,
  PAUSE_MS,
  clearTranslationCache,
  deeplEndpoint,
  deeplSource,
  stripAddedEmphasis,
  translateTitles,
  translationCacheSize,
} from '../../api/_lib/translate';

const FREE_KEY = 'test-key-123:fx';
const PRO_KEY = 'test-key-456';

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { text: string[]; target_lang: string; source_lang?: string };
}

/** A fake DeepL: it answers "EN(<text>)" for each text, and keeps each request. */
function fakeDeepl(answer?: (text: string) => { text: string; detected_source_language: string }) {
  const sent: Sent[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Sent['body'];
    sent.push({ url: String(input), headers: init?.headers as Record<string, string>, body });
    const translations = body.text.map((t) => answer?.(t) ?? { text: `EN(${t})`, detected_source_language: body.source_lang ?? 'ZH' });
    return new Response(JSON.stringify({ translations }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fn as unknown as typeof fetch, sent, fn };
}

let warn: { mock: { calls: unknown[][] } } & ((...args: unknown[]) => void);

beforeEach(() => {
  clearTranslationCache();
  delete process.env.DEEPL_API_KEY;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('deeplSource', () => {
  it('maps BCP-47 codes to DeepL source codes', () => {
    expect(deeplSource('zh')).toBe('ZH');
    expect(deeplSource('zh-Hans')).toBe('ZH');
    expect(deeplSource('ja')).toBe('JA');
    expect(deeplSource('ko')).toBe('KO');
    expect(deeplSource('ru')).toBe('RU');
    expect(deeplSource('uk')).toBe('UK');
    expect(deeplSource('de')).toBe('DE');
    expect(deeplSource('pt-BR')).toBe('PT');
    expect(deeplSource('es-419')).toBe('ES');
    expect(deeplSource('ar')).toBe('AR');
    expect(deeplSource('he')).toBe('HE');
    expect(deeplSource('iw')).toBe('HE');
    expect(deeplSource('no')).toBe('NB');
    expect(deeplSource('fil')).toBe('TL');
  });

  it('gives null for English, for no code and for a language that DeepL does not read', () => {
    expect(deeplSource('en')).toBeNull();
    expect(deeplSource('en-GB')).toBeNull();
    expect(deeplSource(null)).toBeNull();
    expect(deeplSource('')).toBeNull();
    expect(deeplSource('so')).toBeNull(); // Somali
    expect(deeplSource('rw')).toBeNull(); // Kinyarwanda
    expect(deeplSource('xx')).toBeNull();
  });
});

describe('deeplEndpoint', () => {
  it('uses the free host for a key that ends in ":fx", else the pro host', () => {
    expect(deeplEndpoint(FREE_KEY)).toBe('https://api-free.deepl.com/v2/translate');
    expect(deeplEndpoint(PRO_KEY)).toBe('https://api.deepl.com/v2/translate');
  });
});

describe('translateTitles', () => {
  it('sends all non-English titles of a list in one request, and keeps the originals', async () => {
    const d = fakeDeepl();
    const { titles: out } = await translateTitles(
      [
        { title: '中国经济增长放缓', lang: 'zh' },
        { title: 'China trade surplus grows', lang: null },
        { title: '国务院召开常务会议', lang: 'zh' },
        { title: 'Beijing hosts summit', lang: 'en' },
        { title: '台风登陆广东', lang: 'zh' },
      ],
      { key: FREE_KEY, fetch: d.fetch },
    );
    expect(d.fn).toHaveBeenCalledTimes(1);
    expect(d.sent[0].url).toBe('https://api-free.deepl.com/v2/translate');
    expect(d.sent[0].headers.authorization).toBe(`DeepL-Auth-Key ${FREE_KEY}`);
    expect(d.sent[0].body).toEqual({ text: ['中国经济增长放缓', '国务院召开常务会议', '台风登陆广东'], target_lang: 'EN-GB', source_lang: 'ZH' });
    expect(out).toEqual([
      { title: 'EN(中国经济增长放缓)', originalTitle: '中国经济增长放缓', translatedBy: 'DeepL' },
      { title: 'China trade surplus grows', originalTitle: null, translatedBy: null },
      { title: 'EN(国务院召开常务会议)', originalTitle: '国务院召开常务会议', translatedBy: 'DeepL' },
      { title: 'Beijing hosts summit', originalTitle: null, translatedBy: null },
      { title: 'EN(台风登陆广东)', originalTitle: '台风登陆广东', translatedBy: 'DeepL' },
    ]);
  });

  it('uses the pro host for a pro key', async () => {
    const d = fakeDeepl();
    await translateTitles([{ title: 'Regierung beschließt Haushalt', lang: 'de' }], { key: PRO_KEY, fetch: d.fetch });
    expect(d.sent[0].url).toBe('https://api.deepl.com/v2/translate');
  });

  it('reads the key from DEEPL_API_KEY', async () => {
    process.env.DEEPL_API_KEY = FREE_KEY;
    const d = fakeDeepl();
    await translateTitles([{ title: 'Правительство одобрило бюджет', lang: 'ru' }], { fetch: d.fetch });
    expect(d.sent[0].headers.authorization).toBe(`DeepL-Auth-Key ${FREE_KEY}`);
  });

  it('omits source_lang when the titles have more than one language, and still sends one request', async () => {
    const d = fakeDeepl((t) => ({ text: `EN(${t})`, detected_source_language: 'JA' }));
    await translateTitles(
      [
        { title: '首相が会見', lang: 'ja' },
        { title: '정부 예산안 발표', lang: 'ko' },
      ],
      { key: FREE_KEY, fetch: d.fetch },
    );
    expect(d.fn).toHaveBeenCalledTimes(1);
    expect(d.sent[0].body.source_lang).toBeUndefined();
    expect(d.sent[0].body.text).toHaveLength(2);
  });

  it('sends no request with no key, and keeps the titles', async () => {
    const d = fakeDeepl();
    const result = await translateTitles([{ title: '中国经济增长放缓', lang: 'zh' }], { fetch: d.fetch });
    expect(d.fn).not.toHaveBeenCalled();
    // No key is not a failure: the list keeps its normal cache.
    expect(result).toEqual({ titles: [{ title: '中国经济增长放缓', originalTitle: null, translatedBy: null }], retry: false });
  });

  it('does not send English titles or languages that DeepL does not read', async () => {
    const d = fakeDeepl();
    const { titles: out } = await translateTitles(
      [
        { title: 'China trade surplus grows', lang: null },
        { title: 'Beijing hosts summit', lang: 'en' },
        { title: 'Dowladda oo ku dhawaaqday', lang: 'so' },
      ],
      { key: FREE_KEY, fetch: d.fetch },
    );
    expect(d.fn).not.toHaveBeenCalled();
    expect(out.every((o) => o.translatedBy === null && o.originalTitle === null)).toBe(true);
  });

  it('sends a title that is twice in the list once', async () => {
    const d = fakeDeepl();
    const { titles: out } = await translateTitles(
      [
        { title: '台风登陆广东', lang: 'zh' },
        { title: '台风登陆广东', lang: 'zh' },
      ],
      { key: FREE_KEY, fetch: d.fetch },
    );
    expect(d.sent[0].body.text).toEqual(['台风登陆广东']);
    expect(out[0].title).toBe('EN(台风登陆广东)');
    expect(out[1].title).toBe('EN(台风登陆广东)');
  });

  it('takes a translation from memory and does not send the title again', async () => {
    const d = fakeDeepl();
    const list = [
      { title: '中国经济增长放缓', lang: 'zh' },
      { title: '国务院召开常务会议', lang: 'zh' },
    ];
    await translateTitles(list, { key: FREE_KEY, fetch: d.fetch });
    const { titles: again } = await translateTitles([...list, { title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: d.fetch });
    expect(d.fn).toHaveBeenCalledTimes(2);
    expect(d.sent[1].body.text).toEqual(['台风登陆广东']);
    expect(again.map((o) => o.title)).toEqual(['EN(中国经济增长放缓)', 'EN(国务院召开常务会议)', 'EN(台风登陆广东)']);
    // All in memory: no request.
    await translateTitles(list, { key: FREE_KEY, fetch: d.fetch });
    expect(d.fn).toHaveBeenCalledTimes(2);
  });

  it('keys the memory by language and title', async () => {
    const d = fakeDeepl();
    await translateTitles([{ title: 'Gobierno', lang: 'es' }], { key: FREE_KEY, fetch: d.fetch });
    await translateTitles([{ title: 'Gobierno', lang: 'pt' }], { key: FREE_KEY, fetch: d.fetch });
    expect(d.fn).toHaveBeenCalledTimes(2);
  });

  it('keeps at most CACHE_MAX_ENTRIES translations', async () => {
    const d = fakeDeepl();
    const list = Array.from({ length: CACHE_MAX_ENTRIES + 50 }, (_, i) => ({ title: `标题 ${i}`, lang: 'zh' }));
    await translateTitles(list, { key: FREE_KEY, fetch: d.fetch });
    expect(translationCacheSize()).toBe(CACHE_MAX_ENTRIES);
  });

  it('keeps the original when DeepL finds English or gives the same text, and does not ask again', async () => {
    const d = fakeDeepl((t) => (t.startsWith('Apple') ? { text: t, detected_source_language: 'EN' } : { text: t, detected_source_language: 'DE' }));
    const list = [
      { title: 'Apple stellt neues iPhone vor', lang: 'de' },
      { title: 'BMW', lang: 'de' },
    ];
    const { titles: out } = await translateTitles(list, { key: FREE_KEY, fetch: d.fetch });
    expect(out.map((o) => o.translatedBy)).toEqual([null, null]);
    await translateTitles(list, { key: FREE_KEY, fetch: d.fetch });
    expect(d.fn).toHaveBeenCalledTimes(1);
  });

  it('keeps the titles after a timeout', async () => {
    const hang = vi.fn(
      (_: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')))),
    );
    const started = Date.now();
    const result = await translateTitles([{ title: '中国经济增长放缓', lang: 'zh' }], { key: FREE_KEY, fetch: hang as unknown as typeof fetch, timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toEqual({ titles: [{ title: '中国经济增长放缓', originalTitle: null, translatedBy: null }], retry: true });
    expect(warn).toHaveBeenCalledWith('[news] translate failed: timeout');
  });

  it('keeps the titles after HTTP 456, logs no key and no body, and sends nothing for 1 h', async () => {
    const quota = vi.fn(async () => new Response('{"message":"Quota exceeded"}', { status: 456 }));
    const doFetch = quota as unknown as typeof fetch;
    const result = await translateTitles([{ title: '国务院召开常务会议', lang: 'zh' }], { key: FREE_KEY, fetch: doFetch });
    expect(result.titles[0]).toEqual({ title: '国务院召开常务会议', originalTitle: null, translatedBy: null });
    // The quota does not come back in a minute: the list keeps its normal cache.
    expect(result.retry).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe('[news] translate failed: http 456 (quota), paused 1 h');
    expect(line).not.toContain(FREE_KEY);
    // A failure is not kept in memory: the next list asks again after the pause.
    expect(translationCacheSize()).toBe(0);

    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + PAUSE_MS - 1000);
    expect((await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: doFetch })).retry).toBe(false);
    expect(quota).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + PAUSE_MS + 1000);
    const d = fakeDeepl();
    const after = await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: d.fetch });
    expect(d.fn).toHaveBeenCalledTimes(1);
    expect(after.titles[0].translatedBy).toBe('DeepL');
  });

  it('pauses after HTTP 403 (bad key) too', async () => {
    const denied = vi.fn(async () => new Response('', { status: 403 }));
    const doFetch = denied as unknown as typeof fetch;
    expect((await translateTitles([{ title: '国务院召开常务会议', lang: 'zh' }], { key: FREE_KEY, fetch: doFetch })).retry).toBe(false);
    await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: doFetch });
    expect(denied).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['[news] translate failed: http 403 (key), paused 1 h']);
  });

  it('asks for a retry after HTTP 429 or 5xx, does not pause, and gives no retry for another 4xx', async () => {
    for (const status of [429, 500, 503]) {
      const err = vi.fn(async () => new Response('', { status }));
      expect((await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: err as unknown as typeof fetch })).retry).toBe(true);
    }
    const bad = vi.fn(async () => new Response('', { status: 400 }));
    expect((await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: bad as unknown as typeof fetch })).retry).toBe(false);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      '[news] translate failed: http 429',
      '[news] translate failed: http 500',
      '[news] translate failed: http 503',
      '[news] translate failed: http 400',
    ]);
  });

  it('removes the Markdown emphasis that DeepL adds', async () => {
    const source = 'Los casos disímbolos de The Judge y el R2 frente a los Estados Unidos';
    const d = fakeDeepl(() => ({ text: 'The landmark cases of *The Judge* and *R2* against the United States', detected_source_language: 'ES' }));
    const { titles } = await translateTitles([{ title: source, lang: 'es' }], { key: FREE_KEY, fetch: d.fetch });
    expect(titles[0]).toEqual({ title: 'The landmark cases of The Judge and R2 against the United States', originalTitle: source, translatedBy: 'DeepL' });
  });
  it('keeps the titles after a network error or a bad answer', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: down as unknown as typeof fetch })).toEqual({
      titles: [{ title: '台风登陆广东', originalTitle: null, translatedBy: null }],
      retry: true,
    });
    const short = vi.fn(async () => new Response(JSON.stringify({ translations: [] }), { status: 200 }));
    expect((await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: short as unknown as typeof fetch })).retry).toBe(true);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['[news] translate failed: network error', '[news] translate failed: invalid response']);
  });
});

describe('stripAddedEmphasis', () => {
  it('removes * and _ markers that the source does not have', () => {
    expect(stripAddedEmphasis('Cases of *The Judge* and **R2**', 'Casos de The Judge y R2')).toBe('Cases of The Judge and R2');
    expect(stripAddedEmphasis('The _Bild_ report', 'Der Bild-Bericht')).toBe('The Bild report');
    expect(stripAddedEmphasis('Rule on file_name keys', 'Regel')).toBe('Rule on file_name keys');
  });

  it('keeps the markers that the source has', () => {
    expect(stripAddedEmphasis('Star *rating* rises', 'Die *Bewertung* steigt')).toBe('Star *rating* rises');
    expect(stripAddedEmphasis('The _x_ case', 'Der _x_ Fall')).toBe('The _x_ case');
  });
});
