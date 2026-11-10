// The DeepL step of the news build (api/_lib/translate.ts), with a fake fetch. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CACHE_MAX_ENTRIES,
  clearTranslationCache,
  deeplEndpoint,
  deeplSource,
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
    expect(result).toEqual({ titles: [{ title: '中国经济增长放缓', originalTitle: null, translatedBy: null }], failed: false });
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
    expect(result).toEqual({ titles: [{ title: '中国经济增长放缓', originalTitle: null, translatedBy: null }], failed: true });
    expect(warn).toHaveBeenCalledWith('[news] translate failed: timeout');
  });

  it('keeps the titles after an HTTP error, and logs no key and no body', async () => {
    const quota = vi.fn(async () => new Response('{"message":"Quota exceeded"}', { status: 456 }));
    const { titles: out } = await translateTitles([{ title: '国务院召开常务会议', lang: 'zh' }], { key: FREE_KEY, fetch: quota as unknown as typeof fetch });
    expect(out[0]).toEqual({ title: '国务院召开常务会议', originalTitle: null, translatedBy: null });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe('[news] translate failed: http 456 (quota)');
    expect(line).not.toContain(FREE_KEY);
    // A failure is not kept in memory: the next list asks again.
    expect(translationCacheSize()).toBe(0);
  });

  it('keeps the titles after a network error or a bad answer', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: down as unknown as typeof fetch })).toEqual({
      titles: [{ title: '台风登陆广东', originalTitle: null, translatedBy: null }],
      failed: true,
    });
    const short = vi.fn(async () => new Response(JSON.stringify({ translations: [] }), { status: 200 }));
    expect((await translateTitles([{ title: '台风登陆广东', lang: 'zh' }], { key: FREE_KEY, fetch: short as unknown as typeof fetch })).failed).toBe(true);
    expect(warn.mock.calls.map((c) => c[0])).toEqual(['[news] translate failed: network error', '[news] translate failed: invalid response']);
  });
});
