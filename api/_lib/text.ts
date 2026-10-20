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

const JUNK_TITLE = /^watch\b.*\bvs\.?\b|\bhow to watch\b|\blive\s*score|live\s*-?\s*stream|\bwatch\b.*\blive\b|\blive\s+free\b|free\s+online|\[#|[™®]|air quality index|\bweather (?:forecast|today)\b/i;
const JUNK_SOURCE = /britannica|\biflr\b|asialaw|legal500|wikipedia|iqair|tripadvisor|weather\.com|accuweather|universidad|university/i;

const JUNK_ADVERT = /\b(?:university|universidad|bachelor'?s program|master'?s program|admissions? open)\b/i;

/** True for spam streams, reference pages, course adverts and other items that are not news. */
export function isJunk(title: string, source: string): boolean {
  if (title.split(' ').length < 4) return true;
  if (JUNK_TITLE.test(title) || JUNK_SOURCE.test(source) || JUNK_ADVERT.test(title)) return true;
  // Directory pages repeat one tag: "Firm Mongolia (asialaw): Mongolia (asialaw)".
  const tags = title.match(/\([^)]{2,40}\)/g) ?? [];
  return new Set(tags.map((x) => x.toLowerCase())).size < tags.length;
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

// Wire services that carry company press releases, not news.
const PRESS_RELEASE = /\b(?:businesswire|business wire|prnewswire|pr newswire|globenewswire|globe newswire|accesswire|einpresswire|ein presswire|newswire\.ca|prweb|openpr|newsfile|issuewire|prlog|presswire|marketscreener)\b/i;

/** True for press-release wires, by host or publisher name. */
export function isPressRelease(url: string, source: string): boolean {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/[.-]/g, ' ');
  } catch {
    // Keep the empty host. The source name still applies.
  }
  return PRESS_RELEASE.test(host) || PRESS_RELEASE.test(source.replace(/[.-]/g, ' '));
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'into', 'is',
  'it', 'its', 'of', 'on', 'or', 'over', 'says', 'said', 'than', 'that', 'the', 'their', 'this', 'to',
  'was', 'were', 'will', 'with', 'after', 'amid', 'new', 'up', 'out', 'about',
]);

/** The distinct words of a title: lowercase, no accents, no punctuation, no stopwords. */
export function titleTokens(title: string): Set<string> {
  const words = fold(title).replace(/['’]s\b/g, '').split(/[^\p{L}\p{N}]+/u);
  return new Set(words.filter((w) => w.length > 1 && !STOPWORDS.has(w)));
}

/** A crude stem, so that "moons" and "moon", "launches" and "launch" match. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/**
 * True when two titles tell one story, where Jaccard is too strict: "Japan launches mission to Mars
 * to bring back samples from its moon" and "Japan launches a probe to collect rocks from Mars's moon Phobos".
 * The country's own words do not count. Same story: 3 or more shared words, or half of the shorter title.
 */
export function sameStory(a: Set<string>, b: Set<string>, ignore: Set<string> = new Set()): boolean {
  const sa = new Set([...a].filter((w) => !ignore.has(w)).map(stem));
  const sb = new Set([...b].filter((w) => !ignore.has(w)).map(stem));
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared += 1;
  const min = Math.min(sa.size, sb.size);
  return shared >= 3 || (min >= 3 && shared / min >= 0.5);
}

/** Jaccard similarity of two token sets: shared words / all words. 0 for two empty sets. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Key that treats "The Hindu", "thehindu.com" and "THE HINDU" as one publisher. A leading "the" is removed. */
export function publisherKey(source: string): string {
  return fold(source)
    .replace(/^www\./, '')
    .replace(/\.(?:com|net|org|co|news|in|uk|au)(?:\.[a-z]{2})?$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/^the(?=.{3})/, '');
}

// Other places whose names hold a country's name. A title that names only these is not about the country.
const LONGER_PLACES: Record<string, string[]> = {
  mongolia: ['inner mongolia'],
  guinea: ['papua new guinea', 'equatorial guinea', 'guinea-bissau', 'guinea bissau'],
  sudan: ['south sudan'],
  ireland: ['northern ireland'],
  samoa: ['american samoa'],
  dominica: ['dominican'],
  congo: ['dr congo', 'democratic republic of the congo', 'democratic republic of congo'],
  niger: ['nigeria'],
  georgia: ['south georgia'],
  macedonia: ['north macedonia'],
  jersey: ['new jersey'],
};

// Words that show a title is about another place or a person with the country's name.
const HOMONYMS: Record<string, RegExp> = {
  peru: /\b(?:plattsburgh|saranac|ny|new york|indiana|illinois|vermont)\b/,
  georgia: /\b(?:atlanta|savannah|bulldogs|ga|georgia tech|georgia state|kemp|uga|braves|falcons|hawks)\b/,
  jordan: /\b(?:michael jordan|jordan (?:love|poole|spieth|clarkson|chiles|peterson|pickford|henderson|mailata|addison|hicks|walsh))\b/,
  chad: /\bchad (?:smith|johnson|daniels)\b/,
  lebanon: /\b(?:lebanon,? (?:pa|ohio|oh|nh|tn|indiana)|lebanon (?:county|valley|high))\b/,
};

/**
 * True when the title names the country only as one item of a list of 3 or more places:
 * "SleekFlow eyes Mexico, Colombia, Peru and Argentina".
 */
export function listsCountry(title: string, name: string): boolean {
  const n = fold(name);
  const parts = title.split(/\s*,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+|\s*&\s*/);
  const i = parts.findIndex((p) => fold(p.trim()) === n);
  if (i < 0) return false;
  const short = (p: string | undefined) => !!p && /^\p{Lu}[\p{L}'.-]*(?:\s+\p{Lu}[\p{L}'.-]*){0,2}$/u.test(p.trim());
  const endsCap = (p: string | undefined) => !!p && /\p{Lu}[\p{L}'.-]*$/u.test(p.trim());
  const startsCap = (p: string | undefined) => !!p && /^\p{Lu}/u.test(p.trim());
  let items = 1;
  for (let k = i - 1; k >= 0; k--) {
    if (short(parts[k])) items += 1;
    else {
      if (endsCap(parts[k])) items += 1;
      break;
    }
  }
  for (let k = i + 1; k < parts.length; k++) {
    if (short(parts[k])) items += 1;
    else {
      if (startsCap(parts[k])) items += 1;
      break;
    }
  }
  return items >= 3;
}

/** True when the title names the country itself, not only a longer place name that holds it. */
export function namesCountry(title: string, name: string): boolean {
  const n = fold(name);
  let t = fold(title);
  for (const longer of LONGER_PLACES[n] ?? []) t = t.split(longer).join(' ');
  if (!t.includes(n)) return false;
  const other = HOMONYMS[n];
  return !(other && other.test(t));
}
