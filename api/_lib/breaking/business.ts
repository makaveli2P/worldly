// The business family of the breaking-news classifier: a leader event at a top company, an index crash,
// a giant merger, the collapse of a company or bank, and a halt of a whole exchange.
//
// The company list comes from Wikidata (companies.json, built by scripts/build-companies.mjs). The country
// of a business story is the headquarters country of the company, or the country of the index or the
// exchange. It is never the country that the headline names: "Nvidia CEO quits over affair with Chinese
// spy" is a US story.
//
// The rules prefer a miss to a false alarm. A plan, a rumour, a profile, a reaction or an interim leader
// supports a story (tier 1), but it never starts an alert. The module is pure.
import companyData from './companies.json' with { type: 'json' };
import { primaryCountries } from './match.js';
import type { BusinessEventType } from './types.js';

export type PersonRole = 'ceo' | 'chair' | 'founder';

export interface Company {
  q: string; // Wikidata QID
  name: string;
  names: string[];
  ambiguous?: string[]; // names that are also common words
  country: string; // CountryId of the headquarters
  people: { name: string; role: PersonRole; links: number }[];
  gsib?: boolean; // a global systemically important bank
  sizeUsdBn: number;
  links: number;
}

interface CompanyData {
  block: string[];
  companies: Company[];
}

/** The result of `businessEvent()`. `tier` 3 is critical-class, 2 major-class, 1 supports a story only. */
export interface BusinessHit {
  tier: 1 | 2 | 3;
  event: BusinessEventType;
  subject: string; // a QID, "mkt-<country>" for a market, "x-<name>" for a failed firm that is not in the list
  country: string;
  violent?: boolean; // a leader is killed: the attack family, not business
  person?: string; // a leader event: the listed person that the title names ("Elon Musk")
}

export const BUSINESS_CONFIG = {
  personLinks: 25, // a person name with no company counts only for a person with this many Wikipedia sitelinks
  founderSizeBn: 100, // ... and a founder only for a company of this size (USD bn)
  mergerMajor: 50e9, // a merger of this value (USD) is major-class
  mergerSupport: 20e9, // ... and of this value supports a story
  wipeout: 250e9, // a one-day loss of one company of this value, in a record headline, is major-class
  crashCritical: 10, // an index fall of this many percent is critical-class
  crashSupport: 3, // ... and of this many percent supports a story
};

const DATA = companyData as unknown as CompanyData;
export const COMPANIES: readonly Company[] = DATA.companies;

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').normalize('NFC');

/**
 * A lookup of many names in a title, with word boundaries. One regex of 3,000 names is slow to compile and
 * to run, so the index keys each name by its first two characters, longest name first. At each word start
 * of the title, the lookup tries only the names with those two characters.
 */
class NameIndex<T> {
  private readonly byPrefix = new Map<string, { name: string; value: T }[]>();

  constructor(entries: Iterable<[string, T]>) {
    for (const [name, value] of entries) {
      if (name.length < 2) continue;
      const key = name.slice(0, 2);
      const list = this.byPrefix.get(key);
      if (list) list.push({ name, value });
      else this.byPrefix.set(key, [{ name, value }]);
    }
    for (const list of this.byPrefix.values()) list.sort((a, b) => b.name.length - a.name.length);
  }

  /** The names in a title, left to right. A longer name wins over a name inside it ("Nikola Tesla"). */
  find(title: string): { text: string; index: number; end: number; value: T }[] {
    const out: { text: string; index: number; end: number; value: T }[] = [];
    let from = 0;
    for (const m of title.matchAll(WORD_START)) {
      const i = m.index ?? 0;
      if (i < from) continue;
      for (const e of this.byPrefix.get(title.slice(i, i + 2)) ?? []) {
        if (!title.startsWith(e.name, i) || /^[\p{L}\p{N}]/u.test(title.slice(i + e.name.length, i + e.name.length + 1))) continue;
        out.push({ text: e.name, index: i, end: i + e.name.length, value: e.value });
        from = i + e.name.length;
        break;
      }
    }
    return out;
  }
}
const WORD_START = /(?<![\p{L}\p{N}])[\p{L}\p{N}]/gu;

// Name -> company. A block phrase ("Nikola Tesla") maps to null; it is longer than the name inside it, so
// the lookup takes it first.
const OWNER = new Map<string, Company | null>();
const AMBIGUOUS = new Set<string>();
for (const c of COMPANIES) {
  for (const n of c.names) if (!OWNER.has(n)) OWNER.set(n, c);
  for (const n of c.ambiguous ?? []) AMBIGUOUS.add(n);
}
for (const p of DATA.block) OWNER.set(p, null);
const COMPANY_INDEX = new NameIndex(OWNER);

// Person name (and its form with no accents) -> the company and the role.
const PERSON = new Map<string, { company: Company; role: PersonRole; links: number; name: string }>();
for (const c of COMPANIES) {
  for (const p of c.people) {
    for (const n of new Set([p.name, fold(p.name)])) if (!PERSON.has(n)) PERSON.set(n, { company: c, role: p.role, links: p.links, name: p.name });
  }
}
const PERSON_INDEX = new NameIndex(PERSON);

/** The company of a name, or undefined. For tests and tools. */
export function companyOf(name: string): Company | undefined {
  return OWNER.get(name) ?? undefined;
}

/** The company of a QID, or undefined. */
export function companyById(q: string): Company | undefined {
  return COMPANIES.find((c) => c.q === q);
}

// ---------------------------------------------------------------- shared text rules

/**
 * The main clause of a title: no short label before a colon, no text after ";", "|" or a dash, and no
 * reason clause ("over alleged fraud", "as fears grip markets"). A demotion word in the reason clause does
 * not decide whether the main event happened.
 */
export function mainClause(title: string): string {
  let t = title.trim();
  const colon = t.indexOf(':');
  if (colon > 0 && colon < 30 && t.slice(0, colon).trim().split(/\s+/).length <= 3) t = t.slice(colon + 1).trim();
  t = t.replace(/\s*(?:[;|—–]|\s-\s).*$/, '');
  return t.replace(/\s+(?:over|after|amid|following|as|for|due to|because|with|in)\s.*$/i, '');
}

// A press review or a daily briefing quotes other headlines. It is not a voice of any story.
export const PRESS_REVIEW = /^(?:the papers|newspaper headlines|front pages?|press review|[a-z]+day briefing|morning briefing|evening briefing)\b/i;
// Follow-up and reaction headlines about a business event. They support a story only.
export const BIZ_AFTERMATH = /\b(?:summon\w*|testif\w*|hearing|successor|succeed\w*|replac\w*|named (?:as )?(?:new|interim|acting)|appoint\w*|(?:resignation|exit|ouster|departure|firing|arrest|death) (?:of|after|rattles|shakes|sparks|hits|leaves)|['’]s (?:resignation|exit|ouster|departure|firing|arrest|death)|what['’]s next|what we know|rise and fall|legacy|tributes?|obituary|(?:shares|stocks?) (?:falls?|fell|drops?|dropped|slides?|slid|jumps?|jumped|rises?|rose|surges?|surged|tumbles?|tumbled|plunges?|plunged|sink|sinks|sank)|markets? react|investors? react)\b/i;
// Features and questions. They are checked on the full title.
// A market digest ("Morning Wrap: ... after Nvidia CEO resigns") reports the event of another story.
const BIZ_FEATURE = /\b(?:what['’]s next|what we know|what to know|rise and fall|explained|explainer|analysis|opinion|as it happened|(?:morning|evening|market|markets|daily|weekly) wrap|wrap-?up|round-?up|stock market today)\b|\?/i;
// A market that comes back is no crash.
const BIZ_DEESCALATE = /\b(?:rebound\w*|recover\w*|bounces? back|rall(?:y|ies|ied)|pares losses)\b/i;

// ---------------------------------------------------------------- leaders

// "steps down" -> "[Ss]teps [Dd]own": the words match in sentence case and in Title Case. The leader
// regexes do not use the "i" flag, because with it \p{Lu} also matches a lower-case letter.
const ci = (src: string) => src.replace(/(?<!\\)\b([a-z])/g, (_, ch: string) => `[${ch.toUpperCase()}${ch}]`);

// A role right after a company name ("co-CEO" too). "chief" and "head" count only there. "president" counts
// only for companies in countries where the president is the chief executive (Japan, Korea, Taiwan, China).
const ROLE = ci(String.raw`(?:co-?CEO|CEO|C\.E\.O\.|chief executive(?: officer)?|boss|chief|head|executive chair(?:man|woman)?|chair(?:man|woman|person)?|president|co-?founder|founder)`);
const PRESIDENT_COUNTRIES = new Set(['JPN', 'KOR', 'TWN', 'CHN', 'HKG']);
const NAME_WORDS = String.raw`(?:\s+\p{Lu}[\p{L}'’.-]*){0,3}`;
const AUX = ci(String.raw`(?:has\s+|is\s+|was\s+|has been\s+|had been\s+)?`);
const DEPART = ci(String.raw`(?:resigns|resigned|quits|quit|steps down|stepped down|fired|ousted|sacked|dismissed|removed|dies|died|is dead|dead|killed|arrested|detained|shot dead|shot|stabbed|murdered|assassinated|gunned down)`);
// A leader that is no longer, or not yet, the leader: "Ex-Nvidia CEO", "Interim Nvidia CEO".
const QUAL_BAD = /(?:\b(?:former|then|deputy|vice|interim|acting|outgoing|ousted|incoming|new|future|retired|late)\s+|\bex\s*-\s*|\bex\s+)$/i;
// Verbs that can also be active with an object: "quits Trump administration", "removed posts".
const TRANSITIVE = /^(?:quits|quit|resigned|fired|ousted|removed|dismissed|sacked|arrested|detained|killed|shot|dead)$/i;
const EVENT_TAIL = /^(?:\s*$|\s*[,.;:!?|()"'‘’“”—–-]|\s+(?:after|amid|as|at|in|by|following|over|from (?:office|power|post|his post|her post|the company|the firm|the role)|under|while|during|on|near|with|and|aged|hours|days|today|tonight|yesterday|reports?|says?|said|for|due|because|immediately|effective)\b)/i;
const VIOLENT = /^(?:shot dead|shot|stabbed|murdered|assassinated|gunned down)$/i;
const FOUNDER_EVENT = /^(?:dies|died|is dead|dead|killed|arrested|detained|shot dead|shot|stabbed|murdered|assassinated|gunned down)$/i;
// A plan to leave, not a departure. "with immediate effect" keeps the event.
const FUTURE = /\b(?:to (?:step down|resign|quit|retire|leave|depart)|will (?:step down|resign|quit|retire|leave)|retire[sd]?|retirement|succession|successor|next year|at the end of|by the end of|in 20\d\d)\b/i;
const IMMEDIATE = /\b(?:immediately|with immediate effect|effective immediately)\b/i;
// A board seat is not the top job: "steps down from Nvidia board".
const BOARD = /\b(?:from|of|on) (?:the |its |\p{Lu}[\p{L}]+(?:['’]s)? )?board\b|\bboard seat\b|\bdirectorship\b/iu;

// A leader of a sports team that has the name of a company is not a business leader: "Red Bull boss
// Christian Horner sacked" is the Formula 1 team principal. These words in the title stop each leader event.
const SPORT = /\b(?:team principal|F1|Formula (?:1|One|E)|Grand Prix|motorsports?|IndyCar|NASCAR|MotoGP|paddock|constructors['’]? (?:title|championship))\b|\bRacing\b|\bracing team\b/i;
// The loose roles. They also name the head of a team or a unit, so a named person must be a person of the company.
const LOOSE_ROLE = /^(?:boss|chief|head)$/i;
// A departure from a role outside the company: "Elon Musk steps down from DOGE", "resigns from Trump
// administration". After "from", only the company, the end of the title or a word for the post is a departure.
const FROM_TAIL = /^\s*,?\s*from\s+(?:the\s+|his\s+|her\s+|their\s+|its\s+)?(.*)$/i;
const FROM_OK = /^(?:office|power|post|role|position|job|top job|top post|helm|company|firm|group|board|leadership|chief executive|CEO|the company|the firm)\b/i;
// "steps down as chair of White House AI council": the role "of" something that is not a company.
const AS_OF_TAIL = new RegExp(String.raw`^\s*,?\s*${ci('as')}\s+(?:${ci('the')}\s+)?(?:\S+\s+)?${ROLE}\s+(?:of|at)\s+(?:${ci('the')}\s+)?(.*)$`, 'u');

// The leader forms. (a) "<Co> CEO Jensen Huang resigns", "Nvidia's chief quits"
const LEAD_A = new RegExp(String.raw`^(?:['’]s)?\s+(${ROLE})(${NAME_WORDS})\s*,?\s+(${AUX})(${DEPART})\b`, 'u');
// (b) "OpenAI fires CEO Sam Altman"
const LEAD_B = new RegExp(String.raw`^\s+${ci('(?:fires|ousts|sacks|removes|dismisses|axes)')}\s+(?:${ci('its')}\s+)?(${ROLE})\b`, 'u');
// (c) "Jensen Huang resigns as Nvidia CEO": the verb before the company, the role after it.
const LEAD_C_VERB = new RegExp(String.raw`\b(${DEPART})\s+${ci('(?:as|from)')}\s+(?:${ci('the')}\s+)?$`, 'u');
const LEAD_C_ROLE = new RegExp(String.raw`^(?:['’]s)?\s+(${ROLE})\b`, 'u');
// (c) in the ITN form: "Jensen Huang resigns as CEO of Nvidia"
const LEAD_C_OF = new RegExp(String.raw`\b(${DEPART})\s+${ci('as')}\s+(?:${ci('the')}\s+)?(${ROLE})\s+of\s+(?:${ci('the')}\s+)?$`, 'u');
// (e) "Nvidia's Huang quits": the verb after the surname
const LEAD_VERB = new RegExp(String.raw`^(${AUX})(${DEPART})\b`, 'u');
// (d) "Warren Buffett dies at 95", "Lee Jae-yong, Samsung chairman, arrested"
const LEAD_D = new RegExp(String.raw`^(?:,[^,]{1,40},)?\s+(${AUX})(${DEPART})\b`, 'u');
const ROLE_END = new RegExp(String.raw`${ROLE}\s+$`, 'u');
// The role that the title states after the verb: "ousted by Nvidia board as CEO".
const AS_ROLE = new RegExp(String.raw`^[^,;:]{0,40}?\b${ci('as')}\s+(?:${ci('the')}\s+)?(?:\S+\s+)?(${ROLE})\b`, 'u');

/** True when the verb, followed by `tail`, reads as an event and not as an active verb with an object. */
function eventReading(verb: string, aux: string, tail: string): boolean {
  if (/^(?:is|was|has been|had been)\s/i.test(aux)) return true; // a passive: "is fired"
  return !TRANSITIVE.test(verb) || EVENT_TAIL.test(tail);
}

interface Match {
  text: string;
  index: number;
  end: number;
}

interface CoMatch extends Match {
  company: Company;
}

const leaderTier = (role: string, verb: string): 1 | 2 => (/founder/i.test(role) && !FOUNDER_EVENT.test(verb.toLowerCase()) ? 1 : 2);

function leaderHit(company: Company, tier: 1 | 2, verb: string): BusinessHit {
  const violent = VIOLENT.test(verb);
  return { tier: violent ? 2 : tier, event: 'leader', subject: company.q, country: company.country, ...(violent ? { violent } : {}) };
}

function roleOk(role: string, company: Company): boolean {
  return !/^president$/i.test(role) || PRESIDENT_COUNTRIES.has(company.country);
}

/** True when a name starts the text: a company name, or the start of a listed company name. */
function startsWithCompany(text: string, company: Company | null): boolean {
  const m = COMPANY_INDEX.find(text)[0];
  return !!m && m.index === 0 && !!m.value && (!company || m.value === company);
}

/**
 * True when the text after the verb puts the departure outside the company: "from DOGE", "from Trump
 * administration role", "as chair of White House AI council". "from Nvidia", "from his post" and the
 * end of the title are departures from the company.
 */
function outsideRole(tail: string, company: Company): boolean {
  const from = FROM_TAIL.exec(tail);
  if (from && from[1].trim() && !FROM_OK.test(from[1]) && !startsWithCompany(from[1], company)) return true;
  const asOf = AS_OF_TAIL.exec(tail);
  return !!asOf && !startsWithCompany(asOf[1], null);
}

/** True when a loose role ("boss") names a person who is not a listed person of the company: a team head. */
function otherHead(role: string, name: string, company: Company): boolean {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!LOOSE_ROLE.test(role) || words.length < 2 || !company.people.length) return false;
  const surname = fold(words.at(-1)!);
  return !company.people.some((p) => fold(p.name.split(/\s+/).at(-1)!) === surname);
}

/**
 * Leader events: "<Co> CEO <Name> resigns", "<Co> fires CEO", "<Name> resigns as <Co> CEO" (or "as CEO of <Co>"),
 * "<Name> dies", "<Co>'s <Surname> quits".
 */
function leaderEvents(title: string, cos: CoMatch[], people: { m: Match; company: Company; role: PersonRole; links: number }[]): BusinessHit[] {
  const out: BusinessHit[] = [];
  for (const c of cos) {
    const before = title.slice(0, c.index);
    const after = title.slice(c.end);
    // (a) "<Co> CEO Jensen Huang resigns", "Nvidia's chief quits"
    const a = LEAD_A.exec(after);
    const aTail = a ? after.slice(a[0].length) : '';
    if (
      a && !QUAL_BAD.test(before) && roleOk(a[1], c.company) && eventReading(a[4], a[3], aTail) &&
      !outsideRole(aTail, c.company) && !otherHead(a[1], a[2], c.company)
    ) {
      out.push(leaderHit(c.company, leaderTier(a[1], a[4]), a[4]));
    }
    // (b) "OpenAI fires CEO Sam Altman"
    const b = LEAD_B.exec(after);
    if (b && roleOk(b[1], c.company)) out.push(leaderHit(c.company, leaderTier(b[1], 'fired'), 'fired'));
    // (c) "Jensen Huang resigns as Nvidia CEO", "Sam Altman ousted as OpenAI CEO"
    const cv = LEAD_C_VERB.exec(before);
    const cr = LEAD_C_ROLE.exec(after);
    if (cv && cr && roleOk(cr[1], c.company)) out.push(leaderHit(c.company, leaderTier(cr[1], cv[1]), cv[1]));
    // (c) also in the ITN form: "Jensen Huang resigns as CEO of Nvidia"
    const of = LEAD_C_OF.exec(before);
    if (of && roleOk(of[2], c.company)) out.push(leaderHit(c.company, leaderTier(of[2], of[1]), of[1]));
    // (e) "Nvidia's Huang quits"
    const e = /^['’]s\s+(\p{Lu}[\p{L}'’-]+)\s+/u.exec(after);
    if (e && c.company.people.some((p) => p.name.split(/\s+/).at(-1) === e[1])) {
      const v = LEAD_VERB.exec(after.slice(e[0].length));
      const vTail = v ? after.slice(e[0].length + v[0].length) : '';
      if (v && eventReading(v[2], v[1], vTail) && !outsideRole(vTail, c.company)) out.push(leaderHit(c.company, 2, v[2]));
    }
  }
  // (d) "Warren Buffett dies at 95", "Samsung chairman Lee Jae-yong arrested"
  for (const p of people) {
    const before = title.slice(0, p.m.index);
    const after = title.slice(p.m.end);
    // The qualifier can come before the role or the company: "Acting CEO X", "Interim Nvidia CEO Colette Kress".
    if (QUAL_BAD.test(before) || QUAL_BAD.test(before.replace(ROLE_END, ''))) continue;
    if (cos.some((c) => c.index < p.m.index && p.m.index - c.end < 30 && QUAL_BAD.test(title.slice(0, c.index)))) continue;
    const d = LEAD_D.exec(after);
    if (!d || !eventReading(d[2], d[1], after.slice(d[0].length)) || outsideRole(after.slice(d[0].length), p.company)) continue;
    // A name alone counts only for a famous person; a founder only of a large company.
    const named = cos.some((c) => c.company === p.company);
    const famous = p.links >= BUSINESS_CONFIG.personLinks && (p.role !== 'founder' || p.company.sizeUsdBn >= BUSINESS_CONFIG.founderSizeBn);
    if (!named && !famous) continue;
    // The title can state the role: a founder who "resigns as CEO" leaves the top job.
    const stated = AS_ROLE.exec(after.slice(d[0].length));
    out.push(leaderHit(p.company, leaderTier(stated && !/founder/i.test(stated[1]) ? stated[1] : p.role, d[2]), d[2]));
  }
  if (SPORT.test(title)) return [];
  if (BOARD.test(title)) return out.map((h) => ({ ...h, tier: 1 }));
  return out;
}

// ---------------------------------------------------------------- markets

interface Index {
  re: string;
  country: string;
  level: number; // approximate level (late 2025): converts a fall in points to percent; 0: percent only
  t2: number; // the fall in percent that is major-class
}

// Approximate levels, late 2025. Refresh them each year. A point threshold tolerates an error of 25%.
export const INDICES: readonly Index[] = [
  { re: String.raw`Dow(?: Jones)?(?: Industrial Average)?|DJIA`, country: 'USA', level: 47000, t2: 5 },
  { re: String.raw`S&P 500|S&P|SPX`, country: 'USA', level: 6700, t2: 5 },
  { re: String.raw`Nasdaq(?: Composite)?(?![- ](?:listed|traded))`, country: 'USA', level: 23000, t2: 5 },
  { re: String.raw`Wall Street|US stocks|U\.S\. stocks|American stocks`, country: 'USA', level: 0, t2: 5 },
  { re: String.raw`FTSE(?: 100)?(?! MIB)`, country: 'GBR', level: 9700, t2: 5 },
  { re: String.raw`Nikkei(?: 225)?(?! Asia)|Tokyo stocks|Japanese stocks`, country: 'JPN', level: 50000, t2: 5 },
  { re: String.raw`Topix`, country: 'JPN', level: 3300, t2: 5 },
  { re: String.raw`Sensex`, country: 'IND', level: 84000, t2: 5 },
  { re: String.raw`(?<!GIFT |Bank )Nifty(?: 50)?`, country: 'IND', level: 26000, t2: 5 },
  { re: String.raw`Dalal Street|Indian stocks|Indian markets?`, country: 'IND', level: 0, t2: 5 },
  { re: String.raw`Hang Seng|Hong Kong stocks`, country: 'HKG', level: 26000, t2: 6 },
  { re: String.raw`Shanghai Composite|Chinese stocks|China stocks`, country: 'CHN', level: 3900, t2: 6 },
  { re: String.raw`CSI 300`, country: 'CHN', level: 4600, t2: 6 },
  { re: String.raw`DAX`, country: 'DEU', level: 24000, t2: 5 },
  { re: String.raw`CAC 40`, country: 'FRA', level: 8100, t2: 5 },
  { re: String.raw`FTSE MIB`, country: 'ITA', level: 0, t2: 5 },
  { re: String.raw`IBEX 35|Ibex`, country: 'ESP', level: 0, t2: 5 },
  { re: String.raw`SMI`, country: 'CHE', level: 0, t2: 5 },
  { re: String.raw`KOSPI|Kospi`, country: 'KOR', level: 4000, t2: 6 },
  { re: String.raw`TAIEX|Taiex`, country: 'TWN', level: 27000, t2: 6 },
  { re: String.raw`ASX(?: 200)?|Australian shares`, country: 'AUS', level: 8700, t2: 5 },
  { re: String.raw`TSX`, country: 'CAN', level: 30000, t2: 5 },
  { re: String.raw`Ibovespa|Bovespa`, country: 'BRA', level: 150000, t2: 7 },
  { re: String.raw`JSE`, country: 'ZAF', level: 0, t2: 6 },
  { re: String.raw`TASI|Tadawul`, country: 'SAU', level: 0, t2: 6 },
  { re: String.raw`BIST 100|Borsa Istanbul`, country: 'TUR', level: 0, t2: 7 },
  { re: String.raw`KSE-100`, country: 'PAK', level: 0, t2: 7 },
  { re: String.raw`Straits Times Index|STI`, country: 'SGP', level: 0, t2: 5 },
  { re: String.raw`Jakarta Composite`, country: 'IDN', level: 0, t2: 7 },
  { re: String.raw`MOEX`, country: 'RUS', level: 0, t2: 7 },
  { re: String.raw`TA-35`, country: 'ISR', level: 0, t2: 6 },
];

// Exchanges, for a halt of all trading. "LSE" alone is also a university, so it is not here.
export const EXCHANGES: readonly { re: string; country: string }[] = [
  { re: String.raw`NYSE|New York Stock Exchange|Nasdaq|Wall Street`, country: 'USA' },
  { re: String.raw`London Stock Exchange`, country: 'GBR' },
  { re: String.raw`Tokyo Stock Exchange|TSE|Japan Exchange`, country: 'JPN' },
  { re: String.raw`Bombay Stock Exchange|BSE|National Stock Exchange|NSE`, country: 'IND' },
  { re: String.raw`Shanghai Stock Exchange|Shenzhen Stock Exchange`, country: 'CHN' },
  { re: String.raw`HKEX|Hong Kong Stock Exchange`, country: 'HKG' },
  { re: String.raw`Deutsche Börse|Frankfurt Stock Exchange`, country: 'DEU' },
  { re: String.raw`Korea Exchange`, country: 'KOR' },
  { re: String.raw`ASX`, country: 'AUS' },
  { re: String.raw`TSX`, country: 'CAN' },
  { re: String.raw`B3`, country: 'BRA' },
  { re: String.raw`JSE`, country: 'ZAF' },
  { re: String.raw`Tadawul`, country: 'SAU' },
  { re: String.raw`Borsa Istanbul`, country: 'TUR' },
  { re: String.raw`Moscow Exchange`, country: 'RUS' },
  { re: String.raw`Taiwan Stock Exchange`, country: 'TWN' },
  { re: String.raw`SGX`, country: 'SGP' },
  { re: String.raw`PSX`, country: 'PAK' },
  { re: String.raw`IDX`, country: 'IDN' },
];

// ASCII word boundaries: the names are ASCII, and \p{L} with the "iu" flags is slow to compile.
const B = (re: string) => String.raw`(?<![A-Za-z0-9])(?:${re})(?![A-Za-z0-9])`;
const FALL = String.raw`(?:falls?|fell|falling|drops?|dropped|dropping|plunges?|plunged|plunging|plummets?|plummeted|tumbles?|tumbled|tumbling|sinks?|sank|sinking|slumps?|slumped|crash(?:es|ed|ing)?|tanks?|tanked|nosedives?|nosedived|sheds?|loses?|lost|dives?|dived|slides?|slid|craters?|cratered)`;
const AMOUNT = String.raw`(?:by\s+)?(?:(?:more than|over|nearly|almost|about|around|as much as|up to|a record)\s+)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(%|per ?cent|percent|pc|points|pts|pt)`;
const RECORD = String.raw`(?:worst (?:day|week|session|fall|drop|sell-?off|crash)|biggest (?:one-day |single-day |daily )?(?:fall|drop|percentage drop|sell-?off)) (?:since (?:19\d\d|200\d)|ever|on record|in (?:its )?history)`;
// A fall over many sessions is no crash: "falls 10% from record high", "lost 10% since the tariffs",
// "sheds 6% in a week", "slumps 12% in October". SPAN_AFTER reads the words right after the amount.
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const SPAN_AFTER = new RegExp(
  String.raw`^\s*,?\s*(?:from\s+(?:its\s+|a\s+|the\s+|their\s+)?(?:[\w-]+\s+)?(?:record|peak|high|top)\b|since\b|so far\b|this\s+(?:year|month|week|quarter)\b|year-to-date\b|YTD\b|` +
    String.raw`(?:in|over|within)\s+(?:the\s+)?(?:past\s+|last\s+)?(?:a|one|the)\s+(?:week|month|year|quarter)\b|` +
    String.raw`(?:in|over|within)\s+(?:the\s+)?(?:past\s+|last\s+)?(?:two|three|four|five|six|seven|eight|nine|ten|several|few|\d+)\s+(?:trading\s+)?(?:days|sessions|weeks|months|years|quarters)\b|` +
    String.raw`over\s+(?:the\s+)?(?:past|last)\b|in\s+(?:${MONTHS}|20\d\d)\b)`,
  'i',
);
// The same kind of span anywhere in the title: a correction, a bear market, a fall from a peak.
const SPAN_ANY = /\b(?:correction|bear market|year-to-date|from (?:its |a |the |their )?(?:[\w-]+ )?(?:record|peak|all-time high)|since (?:its |the |a )?(?:[\w-]+ )?(?:record|peak|high))\b/i;
// One session: "in a day", "one-day", "intraday". Then a correction word does not make a span.
const ONE_SESSION = /\b(?:in (?:a|one) (?:day|session)|in a single (?:day|session)|one-day|single-day|intraday)\b/i;
// A forecast or a futures market is no crash.
const MARKET_HEDGE = /\b(?:futures|GIFT Nifty|pre-?market|premarket|could|risks?|fears?|warns?|predict\w*|forecast\w*|if|may|might|would)\b|\?/i;

// One regex of all index and exchange names: most titles name none, and then the market rules stop here.
const ANY_MARKET = new RegExp([...INDICES, ...EXCHANGES].map((x) => B(x.re)).join('|') + String.raw`|\bcircuit[- ]breakers?\b`, 'i');
// Each index first tests its name alone, so that V8 compiles its larger regexes only when a title names it.
const INDEX_RES = INDICES.map((ix) => ({
  ix,
  name: new RegExp(B(ix.re), 'i'),
  fall: new RegExp(String.raw`${B(ix.re)}[^.;:]{0,30}?\b${FALL}\b\s+${AMOUNT}`, 'i'),
  record: new RegExp(String.raw`${B(ix.re)}[^.;:]{0,60}\b${RECORD}\b`, 'i'),
  breaker: new RegExp(String.raw`${B(ix.re)}[^.;:]{0,60}\bcircuit[- ]breakers?\b|\bcircuit[- ]breakers?\b[^.;:]{0,60}${B(ix.re)}`, 'i'),
}));
const EXCHANGE_RES = EXCHANGES.map((ex) => ({
  ex,
  name: new RegExp(B(ex.re), 'i'),
  halts: new RegExp(String.raw`${B(ex.re)}[^.;:]{0,30}?\b(?:halts|halted|suspends|suspended|stops|stopped|shuts|shut)\s+(?:all\s+)?trading\b(?!\s+(?:in|of|on)\s)`),
  halted: new RegExp(String.raw`\btrading\s+(?:is\s+|was\s+|has been\s+)?(?:halted|suspended|stopped)\s+(?:on|at|across)\s+(?:the\s+)?${B(ex.re)}`, 'i'),
}));

/** Index crashes, exchange halts and market-wide circuit breakers. */
function marketEvents(title: string): BusinessHit[] {
  const out: BusinessHit[] = [];
  if (!ANY_MARKET.test(title)) return out;
  const main = mainClause(title);
  const hedge = MARKET_HEDGE.test(main) || BIZ_DEESCALATE.test(main);
  const hit = (tier: number, event: BusinessEventType, country: string) => {
    if (tier < 1) return;
    out.push({ tier: (hedge ? 1 : Math.min(tier, 3)) as 1 | 2 | 3, event, subject: `mkt-${country}`, country });
  };
  for (const { ix, name, fall, record, breaker } of INDEX_RES) {
    if (!name.test(title)) continue;
    const m = fall.exec(title);
    let pct = 0;
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      pct = /%|cent|pc/i.test(m[2]) ? n : ix.level ? (100 * n) / ix.level : 0;
    }
    const rec = record.test(title);
    const brk = breaker.test(title);
    if (!m && !rec && !brk) continue;
    let pctTier = pct >= BUSINESS_CONFIG.crashCritical ? 3 : pct >= ix.t2 ? 2 : pct >= BUSINESS_CONFIG.crashSupport ? 1 : 0;
    // A fall over many sessions supports a story only. A record ("worst week since 2008") stays major-class.
    const span = m && (SPAN_AFTER.test(title.slice((m.index ?? 0) + m[0].length)) || (SPAN_ANY.test(title) && !ONE_SESSION.test(title)));
    if (span) pctTier = Math.min(pctTier, 1);
    const tier = Math.max(pctTier, rec || brk ? 2 : 0);
    hit(tier, brk && pct < ix.t2 ? 'halt' : 'crash', ix.country);
  }
  for (const { ex, name, halts, halted } of EXCHANGE_RES) {
    if (name.test(title) && (halts.test(title) || halted.test(title))) hit(2, 'halt', ex.country);
  }
  if (!out.length && /\bmarket-wide circuit[- ]breakers?\b/i.test(title)) {
    const ids = primaryCountries(title);
    if (ids.length === 1) hit(2, 'halt', ids[0]);
  }
  return out;
}

// ---------------------------------------------------------------- money, mergers, collapses

const FX: Record<string, number> = { $: 1, US$: 1, USD: 1, '£': 1.3, '€': 1.15, '¥': 0.0066, Rs: 0.0113, '₹': 0.0113, INR: 0.0113 };
const UNIT: Record<string, number> = {
  trillion: 1e12, tn: 1e12, t: 1e12, billion: 1e9, bn: 1e9, b: 1e9, 'lakh crore': 1e12, crore: 1e7, million: 1e6, mn: 1e6, m: 1e6,
};
const MONEY = /(US\$|\$|USD\s?|£|€|¥|Rs\.?\s?|₹\s?|INR\s?)(\d+(?:[.,]\d+)?)\s?(trillion|Trillion|tn|T|billion|Billion|bn|Bn|B|lakh crore|crore|million|Million|mn|M|m)(?![\p{L}\p{N}])/gu;
const MONEY_WORDS = /(\d+(?:\.\d+)?)\s(trillion|billion)\s(dollars|euros|pounds)\b/gi;

/** The largest amount of money in a title, in US dollars, or 0. "$120 billion", "£40bn", "Rs 5 lakh crore". */
export function moneyUsd(title: string): number {
  let best = 0;
  for (const m of title.matchAll(MONEY)) {
    const sym = m[1].replace(/[.\s]/g, '');
    const n = parseFloat(m[2].replace(',', '.'));
    best = Math.max(best, n * (UNIT[m[3].toLowerCase()] ?? 0) * (FX[sym] ?? 1));
  }
  for (const m of title.matchAll(MONEY_WORDS)) {
    const fx = { dollars: 1, euros: FX['€'], pounds: FX['£'] }[m[3].toLowerCase()] ?? 1;
    best = Math.max(best, parseFloat(m[1]) * UNIT[m[2].toLowerCase()] * fx);
  }
  return best;
}

const MERGER_VERB = /\b(?:agree[sd]? to (?:buy|acquire|merge with|take over)|to (?:buy|acquire|merge with|take over)|buys|bought|acquires|acquired|merges? with|merger|takeover|deal to (?:buy|acquire))\b/i;
// A deal that is not done: talks, a bid, a plan, an approval of an older deal, or a deal that fails.
const BIZ_RUMOUR = /\b(?:in talks|talks|weigh(?:s|ing)?|consider(?:s|ing)?|explor(?:es|ing)|mulls?|eyes|eyeing|nears?|nearing|approach(?:es|ed)?|bids?|offer(?:s|ed)?|proposal|propos(?:es|ed)|reportedly|sources|people familiar|said to|rejects?|rejected|turns? down|block(?:s|ed)?|abandon\w*|walks? away|scraps?|calls? off|seeks?|hostile|completes?|completed|closes|approv\w+|clears?|cleared|valuation|IPO)\b/i;
const COLLAPSE = String.raw`(?:files? for (?:bankruptcy|Chapter 11|insolvency)|filed for (?:bankruptcy|Chapter 11|insolvency)|declares? (?:bankruptcy|insolvency)|goes (?:bankrupt|bust|under)|went (?:bankrupt|bust|under)|collapses|collapsed|enters? (?:administration|liquidation|insolvency|receivership)|declared (?:bankrupt|insolvent)|ordered (?:to be )?liquidated|seized by regulators|shut down by regulators|taken over by (?:the FDIC|regulators))`;
const COLLAPSE_AFTER = new RegExp(String.raw`^(?:\s+(?:Group|Bank|Inc\.?|plc|AG|SA|Corp\.?|Holdings?))?\s+(?:has\s+|is\s+|was\s+|has been\s+)?${COLLAPSE}\b`, 'i');
const RESCUE_AFTER = /^(?:\s+(?:Group|Bank|Inc\.?|plc|AG|SA|Corp\.?|Holdings?))?\s+(?:is\s+|was\s+|has been\s+)?(?:rescued|bailed out)\b/i;
const RESCUE_BEFORE = /\b(?:emergency (?:takeover|rescue|bailout) of|bail-?out of|rescue of)\s+(?:the\s+)?$/i;
// A failed firm that is not in the list, with a record: "Silicon Valley Bank collapses in biggest US bank failure since 2008".
const FAILURE_RECORD = /\b(?:biggest|largest) (?:[\p{L}.]+ )?(?:bank failure|bank collapse|bankruptcy|corporate collapse|corporate bankruptcy) (?:since \d{4}|in (?:\w+ )?history|ever)\b/iu;
const FAILED_FIRM = new RegExp(String.raw`((?:\p{Lu}[\p{L}&.'’-]*\s+){0,4}\p{Lu}[\p{L}&.'’-]*)\s+(?:has\s+|is\s+)?${COLLAPSE}`, 'u');
// A word near an ambiguous name that makes it the company: "Shell shares", "Delta airline".
const CONTEXT_WORDS = /\b(?:shares|stocks?|firm|company|giant|maker|bank|lender|airline|carrier|group|Inc|plc|Corp|retailer|chipmaker|automaker|carmaker|insurer|conglomerate|CEO|boss|chief|chair(?:man|woman)?|founder|investors?)\b/i;
const SUPPORT_WORDS = /\b(?:CEO|C\.E\.O\.|chief executive|boss|chair(?:man|woman)?|founder|resign\w*|quits?|exit|ouster|departure|shares|stocks?|merger|takeover|acquisition|bankrupt\w*|collapse\w*|insolven\w*|liquidation)\b/i;

/** True when an ambiguous name ("Shell", "Apple") is the company here: a legal suffix or a business word near it. */
function companyContext(title: string, m: CoMatch): boolean {
  if (!AMBIGUOUS.has(m.text)) return true;
  if (/^(?:['’]s)?\s+(?:Inc\.?|plc|Corp\.?|Group|Holdings|AG|SA|Ltd\.?)\b/.test(title.slice(m.end))) return true;
  const before = title.slice(0, m.index).split(/\s+/).filter(Boolean).slice(-4).join(' ');
  const after = title.slice(m.end).split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
  return CONTEXT_WORDS.test(before) || CONTEXT_WORDS.test(after);
}

function mergerEvents(title: string, cos: CoMatch[]): BusinessHit[] {
  const v = MERGER_VERB.exec(title);
  if (!v || !cos.length) return [];
  // Two named companies give the context; an ambiguous name alone needs a business word.
  const real = cos.filter((c) => companyContext(title, c));
  const usable = real.length ? (new Set(cos.map((c) => c.company)).size >= 2 ? cos : real) : [];
  if (!usable.length) return [];
  const buyer = usable.filter((c) => c.index < (v.index ?? 0)).at(0) ?? usable[0];
  const usd = moneyUsd(title);
  let tier = usd >= BUSINESS_CONFIG.mergerMajor ? 2 : usd >= BUSINESS_CONFIG.mergerSupport ? 1 : 0;
  if (!tier) return [];
  if (BIZ_RUMOUR.test(title)) tier = 1;
  return [{ tier: tier as 1 | 2, event: 'merger', subject: buyer.company.q, country: buyer.company.country }];
}

function collapseEvents(title: string, cos: CoMatch[]): BusinessHit[] {
  const out: BusinessHit[] = [];
  for (const c of cos) {
    if (!companyContext(title, c)) continue;
    const after = title.slice(c.end);
    if (COLLAPSE_AFTER.test(after)) out.push({ tier: c.company.gsib ? 3 : 2, event: 'collapse', subject: c.company.q, country: c.company.country });
    else if (RESCUE_AFTER.test(after) || RESCUE_BEFORE.test(title.slice(0, c.index))) out.push({ tier: 2, event: 'collapse', subject: c.company.q, country: c.company.country });
  }
  if (!out.length && FAILURE_RECORD.test(title)) {
    const f = FAILED_FIRM.exec(title);
    const ids = primaryCountries(title);
    if (f && ids.length === 1) {
      const slug = fold(f[1]).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      out.push({ tier: 2, event: 'collapse', subject: `x-${slug}`, country: ids[0] });
    }
  }
  return out;
}

/** A record one-day loss of one company: "Nvidia loses $593bn in biggest one-day drop in US stock market history". */
function wipeoutEvents(title: string, cos: CoMatch[]): BusinessHit[] {
  if (!cos.length || !/\bbiggest (?:one-day |single-day )?(?:loss|drop|wipeout|fall) in (?:US |U\.S\. )?(?:stock market|corporate|market)? ?history\b/i.test(title)) return [];
  if (moneyUsd(title) < BUSINESS_CONFIG.wipeout) return [];
  const c = cos.find((x) => companyContext(title, x)) ?? cos[0];
  return [{ tier: 2, event: 'crash', subject: c.company.q, country: c.company.country }];
}

// ---------------------------------------------------------------- the entry point

/**
 * The business event of a headline, or null. The tier here includes the business rules (a plan, a board
 * seat, a rumour, a reaction, a feature). classify() also applies the general demotions to the main clause.
 */
export function businessEvent(title: string): BusinessHit | null {
  const cos: CoMatch[] = [];
  for (const m of COMPANY_INDEX.find(title)) if (m.value) cos.push({ text: m.text, index: m.index, end: m.end, company: m.value });
  const people = PERSON_INDEX.find(title).map((m) => ({ m: { text: m.text, index: m.index, end: m.end }, ...m.value }));
  const main = mainClause(title);
  const hits: BusinessHit[] = [];
  for (const h of leaderEvents(title, cos, people)) {
    // A plan to leave is no departure, unless it takes effect now.
    hits.push(FUTURE.test(main) && !IMMEDIATE.test(title) ? { ...h, tier: 1 } : h);
  }
  hits.push(...marketEvents(title), ...mergerEvents(title, cos), ...collapseEvents(title, cos), ...wipeoutEvents(title, cos));
  // Support: a company with a business word counts as a voice of its story.
  const support = cos.find((c) => companyContext(title, c));
  if (support && SUPPORT_WORDS.test(title)) hits.push({ tier: 1, event: 'support', subject: support.company.q, country: support.company.country });
  if (!hits.length) return null;
  const demote = BIZ_AFTERMATH.test(main) || BIZ_FEATURE.test(title) || BIZ_DEESCALATE.test(main);
  let best = hits.sort((a, b) => b.tier - a.tier)[0];
  // A leader event keeps the person, so that the detector can join the headlines of one person who leads
  // two companies ("Elon Musk resigns" and "Musk quits as Tesla chief executive").
  if (best.event === 'leader' && people.length) best = { ...best, person: people[0].name };
  return demote && !best.violent ? { ...best, tier: 1 } : best;
}
