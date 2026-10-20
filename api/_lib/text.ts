// Small helpers that clean upstream text and URLs before they reach the client.

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  eacute: 'é',
  egrave: 'è',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  ccedil: 'ç',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
};

/** Decodes named and numeric HTML entities. Unknown names stay as they are. */
export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** Decodes entities, removes HTML tags, collapses white space and caps the length. */
export function cleanText(input: unknown, maxLength: number): string {
  if (typeof input !== 'string') return '';
  // Decode twice: some feeds double-encode ("&amp;amp;").
  let text = decodeEntities(decodeEntities(input));
  text = text.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' ');
  text = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > maxLength) text = `${text.slice(0, maxLength - 1).trimEnd()}…`;
  return text;
}

/** Returns the URL when it is a plain http(s) link, else null. */
export function safeUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = decodeEntities(input.trim());
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Returns an ISO 8601 string for a parseable date, else null. */
export function toIso(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const time = Date.parse(input.trim());
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Key that treats near-identical titles as the same story. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .slice(0, 80);
}

const JUNK_TITLE = /live\s*-?\s*stream|\bwatch\b.*\blive\b|\blive\s+free\b|free\s+online|\[#|[™®]|air quality index|\bweather (?:forecast|today)\b/i;
const JUNK_SOURCE = /britannica|wikipedia|iqair|tripadvisor|weather\.com|accuweather|universidad|university/i;

const JUNK_ADVERT = /\b(?:university|universidad|bachelor'?s program|master'?s program|admissions? open)\b/i;

/** True for spam streams, reference pages, course adverts and other items that are not news. */
export function isJunk(title: string, source: string): boolean {
  if (title.split(' ').length < 4) return true;
  return JUNK_TITLE.test(title) || JUNK_SOURCE.test(source) || JUNK_ADVERT.test(title);
}

// First words that do not identify a place on their own.
const GENERIC_FIRST_WORD = new Set([
  'the', 'republic', 'saint', 'north', 'south', 'east', 'west', 'new', 'united', 'central',
  'democratic', 'federated', 'british', 'french', 'american', 'northern', 'heard',
]);

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

/** True when the text names the place: the full name, or a distinct first word ("Siachen"). */
export function mentions(text: string, name: string): boolean {
  const t = fold(text);
  const n = fold(name);
  if (t.includes(n)) return true;
  const first = n.split(/[\s,]+/)[0];
  if (first.length < 5 || GENERIC_FIRST_WORD.has(first)) return false;
  return new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t);
}
