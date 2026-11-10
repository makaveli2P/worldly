// Translates the non-English titles of a picked news list to English with DeepL.
// The news build calls it after the pick, so the clusters and the dedupe use the original text.
// All titles of one list go in ONE request. On any failure, or with no key, the titles stay as they are.

/** The target language. The UI uses British English. */
export const TARGET_LANG = 'EN-GB';
/** Translations that one function instance keeps in memory. */
export const CACHE_MAX_ENTRIES = 2000;
const DEFAULT_TIMEOUT_MS = 1500;

/**
 * The source languages of DeepL (GET /v2/languages?type=source, read on 2026-11-11), without EN.
 * A title in another language stays untranslated: DeepL cannot read it, so a request would waste characters.
 */
const DEEPL_SOURCES: ReadonlySet<string> = new Set(
  (
    'AF AN AR AS AY AZ BA BE BG BN BR BS CA CS CY DA DE EL EO ES ET EU FA FI FR GA GL GN GU HA HE HI HR HT HU HY ID IG IS IT ' +
    'JA JV KA KK KO KY LA LB LN LT LV MG MI MK ML MN MR MS MT MY NB NE NL OC OM PA PL PS PT QU RO RU SA SK SL SQ SR ST SU SV ' +
    'SW TA TE TG TH TK TL TN TR TS TT UK UR UZ VI WO XH YI ZH ZU'
  ).split(' '),
);

/** BCP-47 primary subtags that DeepL names with another code. */
const ALIASES: Readonly<Record<string, string>> = { no: 'NB', nn: 'NB', iw: 'HE', in: 'ID', ji: 'YI', fil: 'TL' };

/** The DeepL source code of a BCP-47 tag ("zh-Hans" -> "ZH", "no" -> "NB"). Null for English and for a language DeepL does not read. */
export function deeplSource(lang: string | null | undefined): string | null {
  if (!lang) return null;
  const primary = lang.trim().toLowerCase().split(/[-_]/)[0];
  if (!primary || primary === 'en') return null;
  const code = Object.hasOwn(ALIASES, primary) ? ALIASES[primary] : primary.toUpperCase();
  return DEEPL_SOURCES.has(code) ? code : null;
}

/** The API host of a key: a DeepL API Free key ends in ":fx". */
export function deeplEndpoint(key: string): string {
  return `${key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com'}/v2/translate`;
}

export interface TitleIn {
  title: string;
  /** BCP-47 code of the title, or null for English. */
  lang?: string | null;
}

export interface TitleOut {
  /** The English title, or the original title when no translation exists. */
  title: string;
  /** The source text when `title` is a translation, else null. */
  originalTitle: string | null;
  translatedBy: 'DeepL' | null;
}

export interface TranslateResult {
  /** One result for each input, in order. */
  titles: TitleOut[];
  /** True when the DeepL request failed (timeout, HTTP error, bad answer). Then the titles stay as they are. */
  failed: boolean;
}

export interface TranslateOptions {
  /** The DeepL key. Default: process.env.DEEPL_API_KEY. */
  key?: string;
  /** The fetch function. Tests give a fake one. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

// (DeepL code, original title) -> the English title, or null when DeepL found English or gave the same text.
const cache = new Map<string, string | null>();
const cacheKey = (code: string, title: string) => `${code}\u0000${title}`;

function remember(key: string, value: string | null): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

/** Empties the translation cache (tests). */
export function clearTranslationCache(): void {
  cache.clear();
}

/** The number of translations in memory (tests). */
export function translationCacheSize(): number {
  return cache.size;
}

const unchanged = (item: TitleIn): TitleOut => ({ title: item.title, originalTitle: null, translatedBy: null });

/** Reads the `translations` array of a DeepL answer. Null when the shape is wrong. */
function parse(body: unknown, count: number): { text: string; detected: string }[] | null {
  const list = (body as { translations?: unknown } | null)?.translations;
  if (!Array.isArray(list) || list.length !== count) return null;
  const out: { text: string; detected: string }[] = [];
  for (const t of list) {
    const text = (t as { text?: unknown }).text;
    const detected = (t as { detected_source_language?: unknown }).detected_source_language;
    if (typeof text !== 'string') return null;
    out.push({ text: text.trim(), detected: typeof detected === 'string' ? detected.toUpperCase() : '' });
  }
  return out;
}

/**
 * Translates the titles that are not in English, in one DeepL request. Gives one result for each input, in order.
 * - English titles (lang null or "en") and languages that DeepL does not read are not sent.
 * - A title in memory is not sent again.
 * - When all sent titles have one language, the request names it (source_lang). Else DeepL finds the language of each text.
 * - No key, a timeout, an HTTP error or a bad answer: the titles stay as they are. The log gets one short line, never the key or a body.
 */
export async function translateTitles(items: readonly TitleIn[], opts: TranslateOptions = {}): Promise<TranslateResult> {
  const out = items.map(unchanged);
  const key = (opts.key ?? process.env.DEEPL_API_KEY ?? '').trim();

  // The titles to send, once each. A title in memory takes its translation at once.
  const pending = new Map<string, { code: string; title: string; at: number[] }>();
  items.forEach((item, i) => {
    const code = deeplSource(item.lang);
    const title = item.title.trim();
    if (!code || !title) return;
    const k = cacheKey(code, title);
    if (cache.has(k)) {
      const english = cache.get(k)!;
      remember(k, english);
      if (english) out[i] = { title: english, originalTitle: item.title, translatedBy: 'DeepL' };
      return;
    }
    const entry = pending.get(k) ?? { code, title, at: [] };
    entry.at.push(i);
    pending.set(k, entry);
  });
  if (pending.size === 0 || !key) return { titles: out, failed: false };
  const failed = { titles: out, failed: true };

  const batch = [...pending.entries()];
  const codes = new Set(batch.map(([, e]) => e.code));
  const body: Record<string, unknown> = { text: batch.map(([, e]) => e.title), target_lang: TARGET_LANG };
  if (codes.size === 1) body.source_lang = [...codes][0];

  const doFetch = opts.fetch ?? fetch;
  let result: { text: string; detected: string }[] | null;
  try {
    const res = await doFetch(deeplEndpoint(key), {
      method: 'POST',
      headers: { authorization: `DeepL-Auth-Key ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      // 456: the monthly character limit is used up.
      console.warn(`[news] translate failed: http ${res.status}${res.status === 456 ? ' (quota)' : ''}`);
      return failed;
    }
    result = parse(await res.json(), batch.length);
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    console.warn(`[news] translate failed: ${name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : name === 'SyntaxError' ? 'invalid json' : 'network error'}`);
    return failed;
  }
  if (!result) {
    console.warn('[news] translate failed: invalid response');
    return failed;
  }

  const translations = result;
  batch.forEach(([k, entry], j) => {
    const { text, detected } = translations[j];
    // DeepL found English, or gave the text back: keep the original, and do not ask again.
    const english = text && detected !== 'EN' && text !== entry.title ? text : null;
    remember(k, english);
    if (!english) return;
    for (const i of entry.at) out[i] = { title: english, originalTitle: items[i].title, translatedBy: 'DeepL' };
  });
  return { titles: out, failed: false };
}
