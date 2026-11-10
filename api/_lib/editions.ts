// Google News editions, keyed by ISO 3166-1 alpha-2 code. This is the only edition table.
// Tested 2026-11-10: each edition below gave items in its NATION topic.
// A code that is not here has no edition: Google silently falls back to US:en or IN:en.

export interface Edition {
  hl: string;
  gl: string;
  ceid: string;
  /** BCP-47 language of the titles. */
  lang: string;
}

const en = (cc: string): Edition => ({ hl: `en-${cc}`, gl: cc, ceid: `${cc}:en`, lang: 'en' });

/** English editions. ID:en is new (49-52 national items). */
export const ENGLISH_EDITIONS: Readonly<Record<string, Edition>> = Object.fromEntries(
  ['AU', 'BW', 'CA', 'ET', 'GB', 'GH', 'ID', 'IE', 'IL', 'IN', 'KE', 'MY', 'NA', 'NG', 'NZ', 'PH', 'PK', 'SG', 'TZ', 'UG', 'US', 'ZA', 'ZW'].map(
    (cc) => [cc, en(cc)],
  ),
);

const native = (cc: string, hl: string, ceidLang: string, lang: string): Edition => ({ hl, gl: cc, ceid: `${cc}:${ceidLang}`, lang });

/** Native-language editions, for countries with no English edition. */
export const NATIVE_EDITIONS: Readonly<Record<string, Edition>> = {
  AE: native('AE', 'ar', 'ar', 'ar'),
  AR: native('AR', 'es-419', 'es-419', 'es'),
  AT: native('AT', 'de', 'de', 'de'),
  BD: native('BD', 'bn', 'bn', 'bn'),
  BE: native('BE', 'fr', 'fr', 'fr'),
  BG: native('BG', 'bg', 'bg', 'bg'),
  BR: native('BR', 'pt-BR', 'pt-419', 'pt'),
  CH: native('CH', 'de', 'de', 'de'),
  CL: native('CL', 'es-419', 'es-419', 'es'),
  CN: native('CN', 'zh-CN', 'zh-Hans', 'zh'),
  CO: native('CO', 'es-419', 'es-419', 'es'),
  CU: native('CU', 'es-419', 'es-419', 'es'),
  CZ: native('CZ', 'cs', 'cs', 'cs'),
  DE: native('DE', 'de', 'de', 'de'),
  EE: native('EE', 'et', 'et', 'et'),
  EG: native('EG', 'ar', 'ar', 'ar'),
  ES: native('ES', 'es', 'es', 'es'),
  FI: native('FI', 'fi', 'fi', 'fi'),
  FR: native('FR', 'fr', 'fr', 'fr'),
  GR: native('GR', 'el', 'el', 'el'),
  HK: native('HK', 'zh-HK', 'zh-Hant', 'zh'),
  HU: native('HU', 'hu', 'hu', 'hu'),
  IT: native('IT', 'it', 'it', 'it'),
  JP: native('JP', 'ja', 'ja', 'ja'),
  KR: native('KR', 'ko', 'ko', 'ko'),
  LB: native('LB', 'ar', 'ar', 'ar'),
  LT: native('LT', 'lt', 'lt', 'lt'),
  LV: native('LV', 'lv', 'lv', 'lv'),
  MA: native('MA', 'fr', 'fr', 'fr'),
  MX: native('MX', 'es-419', 'es-419', 'es'),
  NL: native('NL', 'nl', 'nl', 'nl'),
  NO: native('NO', 'no', 'no', 'no'),
  PE: native('PE', 'es-419', 'es-419', 'es'),
  PL: native('PL', 'pl', 'pl', 'pl'),
  PT: native('PT', 'pt-PT', 'pt-150', 'pt'),
  RO: native('RO', 'ro', 'ro', 'ro'),
  RS: native('RS', 'sr', 'sr', 'sr'),
  RU: native('RU', 'ru', 'ru', 'ru'),
  SA: native('SA', 'ar', 'ar', 'ar'),
  SE: native('SE', 'sv', 'sv', 'sv'),
  SI: native('SI', 'sl', 'sl', 'sl'),
  SK: native('SK', 'sk', 'sk', 'sk'),
  SN: native('SN', 'fr', 'fr', 'fr'),
  TH: native('TH', 'th', 'th', 'th'),
  TR: native('TR', 'tr', 'tr', 'tr'),
  TW: native('TW', 'zh-TW', 'zh-Hant', 'zh'),
  UA: native('UA', 'uk', 'uk', 'uk'),
  VE: native('VE', 'es-419', 'es-419', 'es'),
  VN: native('VN', 'vi', 'vi', 'vi'),
};

export interface EditionChoice {
  /** The English edition, when one exists. */
  english: Edition | null;
  /** The native edition, only for a country with no English edition. */
  native: Edition | null;
}

/** The editions to use for a country. Both are null for a country with no edition (Fiji, Iran, ...). */
export function editionsFor(iso2: string | null): EditionChoice {
  const cc = iso2?.toUpperCase() ?? '';
  const english = Object.hasOwn(ENGLISH_EDITIONS, cc) ? ENGLISH_EDITIONS[cc] : null;
  const nat = !english && Object.hasOwn(NATIVE_EDITIONS, cc) ? NATIVE_EDITIONS[cc] : null;
  return { english, native: nat };
}
