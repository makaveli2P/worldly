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
// Company filings ("Form 6-K TAIWAN SEMICONDUCTOR"), earthquake bots ("Light mag. 3.3 earthquake - ..."),
// puzzle answers and expert-for-hire notices.
const JUNK_ROBOT =
  /^form (?:3|4|5|144)\b|\bform (?:6-k|8-k|10-k|10-q|20-f|40-f|s-1|f-1|13d|13g|424b\d?)\b|\bsc 13[dg]\b|\b(?:light|minor|moderate|weak|strong|very strong|major) mag\. ?\d|\bmag\. ?\d(?:\.\d)? (?:earth)?quake\b|\bavailable for (?:interviews?|comment)\b|\b(?:wordle|quordle|flagle|worldle|connections|strands|crossword)\b.*\b(?:answers?|hints?|today|solution)\b|\b(?:answers?|hints?) (?:today|for (?:today|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
const JUNK_SOURCE = /britannica|\biflr\b|asialaw|legal500|wikipedia|iqair|tripadvisor|weather\.com|accuweather|universidad|university|volcano ?discovery|earthquake ?track|streetinsider|sec\.gov|quakes? today|reliefweb/i;

const JUNK_ADVERT = /\b(?:university|universidad|bachelor'?s program|master'?s program|admissions? open|scholarships?|open call|call for (?:applications|papers|proposals|entries)|webinar|job (?:openings|vacancies)|vacancies)\b/i;

/** True for spam streams, reference pages, course adverts and other items that are not news. */
export function isJunk(title: string, source: string): boolean {
  // Chinese, Japanese and Korean titles have few or no spaces: count characters instead.
  if (/[぀-ヿ㐀-鿿가-힯]/.test(title) ? title.length < 8 : title.split(' ').length < 4) return true;
  if (JUNK_TITLE.test(title) || JUNK_ROBOT.test(title) || JUNK_SOURCE.test(source) || JUNK_ADVERT.test(title)) return true;
  // Directory pages repeat one tag: "Firm Mongolia (asialaw): Mongolia (asialaw)".
  const tags = title.match(/\([^)]{2,40}\)/g) ?? [];
  return new Set(tags.map((x) => x.toLowerCase())).size < tags.length;
}

// First words that do not identify a place on their own.
const GENERIC_FIRST_WORD = new Set([
  'the', 'republic', 'saint', 'north', 'south', 'east', 'west', 'new', 'united', 'central',
  'democratic', 'federated', 'british', 'french', 'american', 'northern', 'heard',
]);

/** Lowercase, with no accents. */
export const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when `word` occurs in `text` as a whole word: no letter or digit touches it on either side.
 * So "Oman" does not match "Woman", "India" does not match "Indiana" and "Iran" does not match "Tirana".
 */
export function hasWord(text: string, word: string): boolean {
  if (!word) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(word)}(?![\\p{L}\\p{N}])`, 'u').test(text);
}

/** True when the text names the place: the full name, or a distinct first word ("Siachen"). Whole words only. */
export function mentions(text: string, name: string): boolean {
  const t = fold(text);
  const n = fold(name);
  if (hasWord(t, n)) return true;
  const first = n.split(/[\s,]+/)[0];
  if (first.length < 5 || GENERIC_FIRST_WORD.has(first)) return false;
  return hasWord(t, first);
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
  niger: ['nigeria', 'niger state', 'niger delta', 'niger river'],
  georgia: ['south georgia'],
  macedonia: ['north macedonia'],
  jersey: ['new jersey'],
  mexico: ['new mexico', 'gulf of mexico', 'village of mexico', 'town of mexico', 'mexico academy'],
  panama: ['panama city beach', 'panama city news herald'],
  palestine: ['palestine action', 'palestine, texas', 'palestine, tx'],
};

// Words that show a title is about another place or a person with the country's name.
const HOMONYMS: Record<string, RegExp> = {
  peru: /\b(?:plattsburgh|saranac|ny|new york|indiana|illinois|vermont)\b/,
  // Mexico, New York (Oswego County): "Watertown woman killed in Village of Mexico crash".
  mexico: /\b(?:watertown|oswego|syracuse|central new york|village of mexico|town of mexico)\b/,
  georgia: new RegExp(
    '\\b(?:atlanta|savannah|augusta|athens|macon|bulldogs|ga|georgia tech|georgia state|georgia southern|kemp|uga|braves|falcons|hawks|' +
      'ole miss|sec|ossoff|warnock|raffensperger|jimmy carter|carter|peach state|georgia (?:house|senate|general assembly|legislature|' +
      'supreme court|gop|democrats?|republicans?|voters?|power|governor|county|sheriff|deputies|game|football|basketball|baseball|' +
      'softball|volleyball|soccer|coach|quarterback|offense|defense)|' +
      "(?:men|women)'?s (?:basketball|soccer|golf|tennis)|basketball|football|touchdown|game|playoffs?)\\b",
  ),
  jordan: /\b(?:michael jordan|jim jordan|rep\. jordan|scalise|gop|house republicans?|judiciary committee|air jordans?|jordan (?:brand|sneakers?|shoes?|love|poole|spieth|clarkson|chiles|peterson|pickford|henderson|mailata|addison|hicks|walsh|fisher|donica|elliott|travis|lawlar|davis|morgan|hall|neely|stolz|whitehead|larsson|eberle|kyrou|staal|binnington|montgomery|battle|mclaughlin|knight|matthews|belfort|peele))\b/,
  niger: /\b(?:niger state|niger govt|minna|bago|naira|n\d[\d,]*)\b/,
  chad: /\bchad (?:smith|johnson|daniels|kroeger|michael murray|le clos|pennington|reed|kelly|wolf|morris|ochocinco)\b/,
  lebanon: /\b(?:mt\.? lebanon|lebanon,? (?:pa|ohio|oh|nh|tn|indiana|mo|or|ky|va|nj|ct|me)|lebanon (?:county|valley|high|township|city|police|school|schools|daily))\b/,
  panama: /\b(?:panama city beach|panama city,? (?:fl|fla|florida)|bay county|florida|news herald|pcb)\b/,
  samoa: /\b(?:humboldt|eureka|arcata|california|calif|samoa (?:bridge|peninsula|boulevard|blvd|dunes|cookhouse))\b/,
  palestine: /\b(?:palestine action|palestine,? (?:tx|texas)|palestine (?:native|high|isd|herald|police|city|wildcats|mules)|east texas|anderson county)\b/,
  turkiye: /\b(?:thanksgiving|turkey (?:day|dinner|dinners|recipe|recipes|breast|sandwich|sandwiches|trot|pardon|pardoning|prices?|farm|farmers|hunting|season|leg|legs|gravy|fryer)|roast|roasted|stuffing|gobble|butterball|wild turkey|cold turkey|turkeys)\b/,
};

// "Jordan Fisher cast as ...": the country's name as a first name, before a capitalised surname.
// Checked only in a sentence-case title, because in Title Case every word has a capital.
const PERSON_AFTER: Record<string, RegExp> = {
  jordan: /\bJordan (?!Valley|River|Times|Rift|King|Crown|Queen|Prime|Foreign|Government|Army|Armed|News|Hashemite)[A-Z][a-z]{2,}/,
  chad: /\bChad (?!Basin|Lake|Government|Army|Junta|President|Foreign)[A-Z][a-z]{2,}/,
};

/** True when some words of 4 or more letters start in lower case. */
const isSentenceCase = (title: string) => title.split(/\s+/).some((w) => w.length >= 4 && /^\p{Ll}/u.test(w));

// Country names that are also common names of other places or people. A title that names such a
// country only by its bare name counts as "weak" unless it also holds one of these words.
const CONTEXT: Record<string, RegExp> = {
  georgia: /\b(?:tbilisi|georgian|kobakhidze|kavelashvili|ivanishvili|georgian dream|abkhazia|south ossetia|batumi|kutaisi|caucasus|caucasian|black sea|kremlin|moscow|russia|russian|armenia|azerbaijan|eu|european union|brussels|nato|zourabichvili|saakashvili|ex-soviet|former soviet|ruling party|opposition|parliament|protesters|pro-western|pro-russian|foreign agents?)\b/,
  jordan: /\b(?:amman|jordanian|king abdullah|abdullah ii|queen rania|crown prince hussein|hashemite|aqaba|petra|zarqa|irbid|jafar hassan|west bank|gaza|israel|israeli|syria|syrian|iraq|iraqi|palestinians?|refugees?|middle east|arab|egypt|saudi|iran|hamas|muslim brotherhood|mosque|kingdom|iaea|unhcr|unrwa|wfp)\b/,
  niger: /\b(?:niamey|nigerien|tiani|zeine|junta|sahel|mali|burkina faso|uranium|orano|ecowas|aes|bazoum|agadez|tillaberi|diffa|zinder|maradi|jihadists?|islamic state|coup|french troops|france|benin|chad|algeria)\b/,
  chad: /\b(?:n'?djamena|chadian|deby|sahel|sudan|sudanese|darfur|refugees?|boko haram|lake chad|junta|libya|niger|cameroon|central african|french troops|france|rsf)\b/,
  palestine: /\b(?:gaza|west bank|palestinians?|israel|israeli|hamas|fatah|abbas|ramallah|unrwa|recogni[sz]\w*|statehood|state of palestine|jerusalem|occupied|ceasefire|un|united nations|two-state|plo|palestinian authority|refugees?)\b/,
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

// US state abbreviations as titles write them after a town: "Mexico, NY", "Peru, Ind.", "Cuba, N.Y.".
// Full state names are not here: "Mexico, Texas agree ..." names two parties, not a town.
const US_STATE =
  '(?:A[LKZR]|C[AOT]|DE|DC|FL|GA|HI|I[DLNA]|K[SY]|LA|M[EDAINSOT]|N[EVHJMYCD]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[TA]|W[AVIY]' +
  '|(?:Ala|Ariz|Ark|Calif|Colo|Conn|Del|Fla|Ga|Ill|Ind|Kan|Ky|La|Md|Mass|Mich|Minn|Miss|Mo|Mont|Neb|Nev|Okla|Ore|Pa|Tenn|Va|Vt|Wash|Wis|Wyo)\\.' +
  '|N\\.[YJHMCD]\\.|S\\.[CD]\\.|W\\.Va\\.|R\\.I\\.)';

/**
 * Removes "<country>, <US state>" from a title, because that names a US town ("Mexico, NY", "Peru, Indiana").
 * The input has no accents. The match is case-sensitive, so "Mexico, in turn" stays.
 */
function withoutUsTown(text: string, name: string): string {
  const n = name.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return text.replace(new RegExp(`(?<![\\p{L}])${escapeRe(n)},\\s*${US_STATE}(?![\\p{L}])`, 'gu'), ' ');
}

/** True when the title names the country itself, not only a longer place name that holds it. Whole words only. */
export function namesCountry(title: string, name: string): boolean {
  const n = fold(name);
  let t = fold(withoutUsTown(title.normalize('NFKD').replace(/[̀-ͯ]/g, ''), name));
  const longer = LONGER_RE.get(n);
  if (longer) t = t.replace(longer, ' ');
  if (!hasWord(t, n)) return false;
  const other = HOMONYMS[n];
  return !(other && other.test(t));
}

// Phrases that hold an alias of another country, or of no country. They are removed before an alias match.
const BLOCK_PHRASES = [
  'latin america', 'south america', 'north america', 'central america', 'bank of america', 'american airlines',
  'native american', 'african american', 'asian american', 'latin american', 'south american', 'central american',
  'american express', 'captain america', 'washington post', 'times of india', 'indian ocean', 'indian wells',
  'west indies', 'new south wales', 'prince of wales', 'south china sea', 'east china sea', 'south china morning post',
  'gulf of guinea', 'chinese taipei', 'georgia tech', 'georgia state', 'paris saint-germain', 'paris saint germain',
  'paris hilton', 'turkey day', 'jersey city', 'new england', 'english premier league',
  'air france', 'air india', 'air china', 'air canada', 'air new zealand', 'japan airlines', 'turkish airlines',
  'qatar airways', 'singapore airlines', 'british airways', 'american eagle', 'china eastern', 'china southern',
];

/** One regex that finds any of the phrases as whole words, in any case. */
const phraseRe = (phrases: readonly string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${phrases.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
const BLOCK_RE = phraseRe(BLOCK_PHRASES);
const LONGER_RE = new Map(Object.entries(LONGER_PLACES).map(([k, v]) => [k, phraseRe(v)]));

export type Relevance = 'yes' | 'weak' | 'trap' | 'no';

/**
 * How a title relates to a country, from its aliases (name, demonym, capital, leader):
 * - 'yes': the title names the country or an alias, as a whole word.
 * - 'weak': the only match is the bare name of a country that shares its name with other places or
 *   people (Georgia, Jordan, Niger, Chad, Palestine), and no word of the country's context is there.
 * - 'trap': the only match is a longer place ("New Mexico") or a homonym ("Michael Jordan").
 * - 'no': no alias in the title.
 * Blocked phrases ("Air India") are removed as whole words first, so "Repair India-made trains" still names India.
 * An alias of 3 letters or fewer, or in capitals ("US", "UK", "DRC"), must match with its case.
 */
export function relevance(title: string, name: string, aliases: readonly string[]): Relevance {
  const n = fold(name);
  const raw = withoutUsTown(title.normalize('NFKD').replace(/[̀-ͯ]/g, ''), name);
  let plain = fold(raw).replace(BLOCK_RE, ' ');
  let cased = raw.replace(BLOCK_RE, ' ');
  const longer = LONGER_RE.get(n);
  if (longer) {
    plain = plain.replace(longer, ' ');
    cased = cased.replace(longer, ' ');
  }
  const shouty = raw === raw.toUpperCase();
  let found: string | null = null;
  for (const alias of aliases) {
    const a = alias.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const strict = a.length <= 3 || (a === a.toUpperCase() && /\p{Lu}/u.test(a));
    if (strict ? !shouty && hasWord(cased, a) : hasWord(plain, fold(a))) {
      found = fold(a);
      // The bare name is the weakest match. Look on for a stronger alias.
      if (found !== n) break;
    }
  }
  if (found !== null) {
    const t = fold(title);
    const other = HOMONYMS[n];
    if (other && other.test(t)) return 'trap';
    const context = CONTEXT[n];
    const person = PERSON_AFTER[n];
    if (found === n && person && isSentenceCase(title) && person.test(title) && !(context && context.test(t))) return 'trap';
    if (found === n && context && !context.test(t)) return 'weak';
    return 'yes';
  }
  // The raw name is in the title, but only inside a blocked or longer place.
  return hasWord(fold(title), n) ? 'trap' : 'no';
}

/**
 * Proper names in a title: capitalised words of 4 or more letters that are not the first word.
 * A title in Title Case gives none, because there every word has a capital.
 * Names in `ignore` (folded) do not count.
 */
export function properNames(title: string, ignore: ReadonlySet<string> = new Set()): Set<string> {
  const words = title.split(/\s+/).filter(Boolean);
  // Title Case capitalises every word of 4 or more letters. Sentence case leaves some in lower case.
  const lettered = words.filter((w) => /^\p{L}/u.test(w) && w.length >= 4);
  if (lettered.length >= 3 && lettered.every((w) => /^\p{Lu}/u.test(w))) return new Set();
  const out = new Set<string>();
  for (let i = 1; i < words.length; i++) {
    // A word after a colon or a dash starts a new sentence, so its capital says nothing.
    if (/[:|–—]$/.test(words[i - 1]) || words[i - 1] === '-') continue;
    const word = words[i]
      .replace(/^["“‘'(«]+/, '')
      .replace(/[.,:;!?"”’')»]+$/, '')
      .replace(/['’]s$/, '');
    if (!/^\p{Lu}[\p{L}'’-]{3,}$/u.test(word)) continue;
    const w = fold(word.replace(/[-'’]+$/, ''));
    if (w.length < 4 || GENERIC_NAMES.has(w) || ignore.has(w)) continue;
    out.add(w);
  }
  return out;
}

// Capitalised words that do not identify a story: titles, institutions, months and days, in several languages.
const GENERIC_NAMES = new Set([
  'president', 'minister', 'prime', 'government', 'police', 'court', 'supreme', 'congress', 'senate', 'parliament',
  'state', 'states', 'national', 'federal', 'republic', 'union', 'european', 'europe', 'world', 'news', 'live', 'update',
  'updates', 'breaking', 'watch', 'video', 'photos', 'report', 'says', 'after', 'with', 'from', 'this', 'that', 'what',
  'will', 'when', 'where', 'here', 'there', 'they', 'their', 'over', 'into', 'about', 'more', 'than', 'year', 'week',
  'today', 'first', 'last', 'north', 'south', 'east', 'west', 'city', 'county', 'party', 'army', 'military', 'bank',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'januar', 'februar', 'marz', 'juni', 'juli', 'oktober', 'dezember', 'janvier', 'fevrier', 'mars', 'avril', 'juin',
  'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre', 'enero', 'febrero', 'marzo', 'abril', 'mayo',
  'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre', 'janeiro', 'fevereiro', 'marco',
  'maio', 'junho', 'julho', 'setembro', 'outubro', 'novembro', 'dezembro',
  'presidente', 'prasident', 'ministro', 'ministerin', 'regierung', 'governo', 'gobierno',
  'gouvernement', 'polizei', 'policia', 'bundesregierung', 'kanzler', 'premier', 'premiere', 'deutschland',
  'brasil', 'mexico', 'indonesia', 'france', 'germany', 'brazil', 'japan', 'china', 'russia', 'ukraine', 'trump',
  'putin', 'opinion', 'analysis', 'exclusive', 'explainer', 'editorial',
]);

// Words that name an outlet in a publisher credit at the end of a title ("— ABC News Australia").
const OUTLET_WORD =
  /\b(?:news|times|post|herald|tribune|journal|daily|tv|radio|channel|press|gazette|telegraph|guardian|express|chronicle|observer|mail|star|sun|mirror|standard|review|today|online|media|network|broadcasting|corporation|agency|wire|insider|weekly|magazine|bulletin|reporter|courier|independent|week|monitor|nation|world|live)\b/i;

function looksLikeOutlet(tail: string, source: string): boolean {
  const t = fold(tail).trim();
  const s = fold(source).trim();
  if (s && (t === s || t.includes(s) || s.includes(t))) return true;
  if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(t)) return true;
  const words = tail.trim().split(/\s+/);
  if (words.length > 6 || tail.length > 50) return false;
  const capped = words.every((w) => /^[\p{Lu}\d&(]/u.test(w) || /^(?:of|the|and|de|du|la|le|del|da|for|on)$/.test(w));
  if (!capped) return false;
  // "TygerBurger": one word with an inner capital is a brand.
  if (words.length === 1 && /\p{Ll}\p{Lu}/u.test(words[0])) return true;
  return OUTLET_WORD.test(tail);
}

/**
 * Removes debris from the end of a title: a dangling dash ("... Paris -") and a publisher credit
 * (" | TygerBurger", " — ABC News Australia"). A subtitle that is not an outlet stays.
 */
export function tidyTitle(title: string, source = ''): string {
  let t = title.replace(/(?:\s+[-–—|:·•]+)+\s*$/u, '').trim();
  // A format tag at the end: "... the politics | Explained".
  t = t.replace(/\s+[|–—-]\s+(?:explained|explainer|analysis|opinion|live updates?|live|watch|video|photos|in pictures|podcast|editorial)$/i, '').trim();
  // A site suffix and a section path from the publisher's site: "... ends: Paris - Region - World".
  t = t.replace(/\s+-\s+news and statistics$/i, '').trim();
  t = t.replace(/\s+-\s+\p{Lu}[\p{L}&]*(?: [&\p{Lu}][\p{L}&]*)?\s+-\s+\p{Lu}[\p{L}&]*(?: \p{Lu}[\p{L}&]*)?$/u, '').trim();
  const m = t.match(/^(.{20,}?)\s+[|—–]\s+([^|—–]{2,60})$/u);
  if (m && looksLikeOutlet(m[2], source)) t = m[1].replace(/(?:\s+[-–—|:·•]+)+\s*$/u, '').trim();
  return t;
}

/**
 * Cleans a publisher name: a URL becomes its host ("https://novanews.co.za/" -> "novanews.co.za"),
 * a long name stops at a dash or a bar ("ABC News & Headlines – Australian Broadcasting Corporation"
 * -> "ABC News & Headlines"), and a dangling dash goes ("Radio Rebelde - ").
 */
export function tidySource(source: string): string {
  let s = source.trim();
  if (/^https?:\/\//i.test(s) || /^www\./i.test(s)) {
    try {
      s = new URL(/^https?:/i.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, '');
    } catch {
      // Keep the name as it is.
    }
  }
  s = s.split(/\s+[–—|]\s+/u)[0];
  return s.replace(/(?:\s+[-–—|:·•]+)+\s*$/u, '').trim();
}

// Function words of the languages that reach the English pool most often. A title with no English
// function word and some of these is not English. Words that English also uses ("a", "in", "die",
// "as", "no", "an") are not here.
const FUNCTION_WORDS: Record<string, readonly string[]> = {
  es: ['de', 'el', 'los', 'las', 'del', 'y', 'por', 'con', 'para', 'una', 'que', 'se', 'es', 'al', 'tras', 'sobre', 'según', 'más', 'su', 'sus', 'entre', 'como', 'desde'],
  pt: ['de', 'os', 'do', 'da', 'dos', 'das', 'em', 'na', 'nas', 'nos', 'com', 'uma', 'ao', 'após', 'mais', 'não', 'pela', 'pelo', 'sobre', 'para', 'que', 'é'],
  fr: ['de', 'le', 'la', 'les', 'des', 'du', 'une', 'et', 'pour', 'sur', 'au', 'aux', 'dans', 'est', 'avec', 'pas', 'qui', 'par', 'selon', 'après', 'contre'],
  de: ['der', 'das', 'und', 'mit', 'für', 'nach', 'bei', 'auf', 'ist', 'nicht', 'ein', 'eine', 'im', 'zum', 'zur', 'vom', 'über', 'wird', 'sich', 'gegen'],
  it: ['il', 'gli', 'della', 'delle', 'del', 'di', 'che', 'per', 'con', 'una', 'è', 'sono', 'dopo', 'nel', 'nella', 'alla', 'dei', 'tra'],
  nl: ['het', 'een', 'van', 'en', 'op', 'met', 'voor', 'niet', 'naar', 'bij', 'zijn', 'wordt', 'ook'],
  id: ['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'pada', 'akan', 'tidak', 'oleh', 'dalam', 'jadi', 'bisa', 'soal'],
  so: ['oo', 'iyo', 'ku', 'ka', 'ee', 'uu', 'ay', 'waxa', 'kala', 'kaga', 'gudaha', 'dowladda', 'kana', 'lagu', 'ugu', 'uga', 'ayaa', 'kaddib', 'markii'],
  sw: ['kwa', 'katika', 'kwamba', 'hiyo', 'huo', 'wa', 'ya', 'za', 'na', 'cha', 'vya', 'baada'],
  rw: ['muri', 'kandi', 'cyangwa', 'ubwo', 'hamwe', 'yerekeje', 'mu', 'ku', 'bya', 'cya'],
  tr: ['ve', 'bir', 'için', 'ile', 'bu', 'olarak', 'sonra', 'daha', 'değil', 'gibi'],
};
const ENGLISH_WORDS = new Set(
  'the of to for on and with from by at is are was were be been has have had after over says said amid into its his her their will not but before against under than this that who what why how new as an in a'.split(' '),
);

/**
 * A guess at the language of a title, as a BCP-47 code. Null for English, and for a title too short to tell.
 * Scripts decide first (Arabic, Cyrillic, CJK, ...); Latin titles go by their function words.
 */
export function guessLang(title: string): string | null {
  if (/[぀-ヿ]/.test(title)) return 'ja';
  if (/[가-힯]/.test(title)) return 'ko';
  if (/[㐀-鿿]/.test(title)) return 'zh';
  if (/[؀-ۿ]/.test(title)) return /[پچژگ]/.test(title) ? 'fa' : 'ar';
  if (/[֐-׿]/.test(title)) return 'he';
  if (/[Ѐ-ӿ]/.test(title)) return /[іїєґІЇЄҐ]/.test(title) ? 'uk' : 'ru';
  if (/[Ͱ-Ͽ]/.test(title)) return 'el';
  if (/[ऀ-ॿ]/.test(title)) return 'hi';
  if (/[ঀ-৿]/.test(title)) return 'bn';
  if (/[฀-๿]/.test(title)) return 'th';
  // "y/y", "q/q" and "m/m" are rate notes, not Spanish or Somali words.
  const words = title.toLowerCase().replace(/\b\p{L}\/\p{L}\b/gu, ' ').split(/[^\p{L}']+/u).filter(Boolean);
  const english = words.filter((w) => ENGLISH_WORDS.has(w)).length;
  let best: string | null = null;
  let bestHits = 0;
  for (const [lang, list] of Object.entries(FUNCTION_WORDS)) {
    const hits = words.filter((w) => list.includes(w)).length;
    if (hits > bestHits) {
      best = lang;
      bestHits = hits;
    }
  }
  // One function word can be a name ("Las Tablas"): it takes 2.
  return bestHits >= 2 && bestHits > english ? best : null;
}
