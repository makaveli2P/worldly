// Ranking of candidate stories: cluster across feeds, score each cluster, pick 5.
// Pure functions with no network, so tests can drive them with fixtures.
import type { Candidate } from './providers/types.js';
import { fold, isJunk, isPressRelease, listsCountry, properNames, publisherKey, relevance, type Relevance } from './text.js';

export const W_COV = 0.35;
export const W_RANK = 0.3;
export const W_AUTH = 0.1;
export const W_REC = 0.25;
export const HALF_LIFE_H = 12;
export const MAX_AGE_H = 36;
export const DICE = 0.4;
export const REL_OTHER = 0.3;
export const PEN_SPORT = 0.5;
export const PEN_SOFT = 0.5;
export const PEN_OPINION = 0.7;
export const PEN_LIST = 0.5;
export const PEN_WORLD = 0.3;
/** An English cluster with at least this score is "strong", when STRONG_OUTLETS cover it (or the boost links it). */
export const STRONG_SCORE = 0.45;
/** Outlets that a strong English cluster needs when the boost does not link it to a native story. */
export const STRONG_OUTLETS = 3;
/** The hybrid boost compares English titles with this many native NATION titles. */
export const NATIVE_BOOST_TOP = 20;
/** A cluster that does not name the country (rel < 1) needs at least this score to reach the list. */
export const MIN_OTHER_SCORE = 0.2;
/** Two clusters younger than this can be one story on looser evidence (see sameCluster). */
export const FRESH_H = 12;
/** Age used for a story with no date. */
const UNKNOWN_AGE_H = 12;

// Wires, public broadcasters and national papers of record. Names are folded (lowercase, no accents).
const TIER1 = new Set([
  'reuters', 'ap', 'ap news', 'associated press', 'the associated press', 'afp', 'bbc', 'bbc news', 'the guardian',
  'the new york times', 'the washington post', 'wsj', 'the wall street journal', 'financial times', 'bloomberg',
  'bloomberg.com', 'al jazeera', 'al jazeera english', 'dw', 'dw.com', 'france 24', 'npr', 'cnn', 'nbc news',
  'cbs news', 'abc news', 'politico', 'axios', 'the economist', 'sky news', 'cbc', 'cbc news', 'the globe and mail',
  'abc news (australia)', 'abc (australia)', 'the sydney morning herald', 'the times of india', 'the hindu', 'ndtv',
  'hindustan times', 'the indian express', 'indian express', 'premium times nigeria', 'channels television',
  'punch newspapers', 'the times of israel', 'haaretz', 'kyodo news', 'nhk', 'nhk world', 'the japan times',
  'south china morning post', 'xinhua', 'interfax', 'meduza', 'kyiv independent', 'the kyiv independent',
  'ukrainska pravda', 'antara news', 'kompas.com', 'the jakarta post', 'g1', 'folha', 'el universal', 'el pais',
  'le monde', 'le figaro', 'der spiegel', 'spiegel', 'faz', 'tagesschau', 'zeit online', 'fbc news', 'the fiji times',
  'rnz', 'the straits times', 'cna', 'yonhap news agency', 'euronews', 'nz herald', 'the irish times', 'rte',
]);

const SPORT = /\b(?:vs\.?|match|cup|league|squad|coach|rugby|cricket|football|soccer|basketball|baseball|softball|volleyball|handball|hockey|nba|wnba|nfl|nhl|mlb|mls|ncaa|fifa|uefa|olympics?|tennis|golf|f1|formula 1|grand prix|wicket|wickets|innings|batsman|batter|bowler|pitcher|homers?|home runs?|striker|midfielder|t20|odi|test (?:match|series)|qualifiers?|fixtures?|semi-?finals?|quarter-?finals?|7s|bundesliga|eredivisie|ligue 1|la liga|laliga|serie a|premier league|brasileirao|copa|futbol|futebol|fussball|wwe|ufc|boxing|marathon|grand slam|playoffs?|touchdown|quarterback|transfer window|world series|pga|lpga|liv golf|nascar|motogp|bowl|sevens|team to face|injur(?:y|ies) crisis|line-?up|friendl(?:y|ies)|game time|goalkeeper|winger|national team|selecao|derby|kick-?off|tournament|championships?|medals?|athletes?|world juniors|juniors|call-?up|called up|hat-?trick|scores? twice|captaincy|afcon|nations league|top seed|district seed|seeded|games?(?![- ](?:changer|theory|plan))|dortmund|bayern|real madrid|fc barcelona|barca|man utd|manchester united|manchester city|arsenal|chelsea|liverpool fc|juventus|psg|ajax|feyenoord|psv|benfica|celtic|galatasaray|fenerbahce|flamengo|palmeiras|corinthians|all blacks|wallabies|springboks|mariners|astros|yankees|dodgers|(?:detroit|chicago|green bay|minnesota|dallas|philadelphia|new york|washington|san francisco|los angeles|seattle|arizona|new orleans|atlanta|carolina|tampa bay|kansas city|las vegas|denver|buffalo|miami|new england|pittsburgh|baltimore|cincinnati|cleveland|houston|indianapolis|jacksonville|tennessee) (?:lions|bears|packers|vikings|cowboys|eagles|giants|commanders|49ers|rams|chargers|seahawks|cardinals|saints|falcons|panthers|buccaneers|chiefs|raiders|broncos|bills|dolphins|patriots|jets|steelers|ravens|bengals|browns|texans|colts|jaguars|titans))\b/i;
// Cricket and score lines, with their case: "Pakistan score 390-6 in first Test", "nears century", "80-72 victory".
const SPORT_CASED =
  /\b(?:first|second|third|fourth|fifth|final|opening|1st|2nd|3rd|4th|5th|day-night|pink-ball) Test\b|\bTest (?:match|series|squad|win|defeat)\b|\b(?:nears|hits|scores|maiden|brings up|smashes|slams) (?:a |his |her )?(?:century|ton|fifty)\b|\b\d{1,3}-\d{1,3} (?:win|victory|defeat|loss|draw|rout)\b|\b(?:beat|beats|defeat|defeats|edge|edges|thrash|thrashes|rout|routs) [\w' ]{2,40} \d{1,3}-\d{1,3}\b|\b\d{2,3}-\d (?:in|at|after)\b|^Tickets\b|\b(?:XV|XI|XIII) v\.? [A-Z]/;
const SOFT = /\b(?:celebrity|celebrities|actress|actor|singer|rapper|kardashian|taylor swift|horoscope|recipes?|travel guide|travel|hotels?|resorts?|luxury|fashion|tips|how to|things to do|what to know before buying|review|deals?|discount|sale|black friday|ps5|playstation|xbox|iphone|guitar|netflix|box office|trailer|red carpet|dating|wedding|divorce|bollywood|hollywood|k-?pop|bts|blackpink|arirang|musical|biopic|sequel|grammys?|oscars?|emmys?|film rights|acquires? (?:the )?(?:film|rights)|influencer|lottery|jackpot|bikini|swimsuit|flaunts?|stuns|showbiz|paparazzi|honeymoon|steals? (?:the )?spotlight|ucapan|beauty|skincare|nonstop|flights? to|airfares?|cruises?|vacations?|getaways?|concerts?|tour dates|(?:world|concert|stadium|farewell|reunion|comeback|arena|global|anniversary|muse) tour|brings (?:the |his |her |their )?[\w' ]{2,30} tour|album|(?:literary|film|music|book) festival|best \w+ (?:to buy|in \d{4})|\d+ (?:best|things|ways|reasons|places))\b/i;
// Service items in native-language feeds: weather, prices of goods, lottery, horoscope, history features.
const SOFT_NATIVE = /الطقس|أسعار|سعر (?:الذهب|الدولار|الفراخ|اللحوم)|حظك|\bwetter\b|horoskop|\blotto\b|\bclima\b|hor[oó]scopo|loter[ií]a|mega-?sena|previs[aã]o do tempo|m[ée]t[ée]o|\bprix du\b|天気|運勢|天气|星座|気象予報士|冷え込み|最高気温|погода|гороскоп|курс (?:доллара|валют)|from the front page|on this day|this day in history|michelin|restaurants?|snövarning|vädret|\bsmhi\b/i;
// Sport publishers: a story from them is sport, whatever its title says ("Church scores four after Fiji fight").
const SPORT_SOURCE = /(?:^|[^a-z])sports?(?:[^a-z]|$)|foxsports|skysports|nbcsports|cbssports|eurosport|sportingnews|sportstar|sportskeeda|espn|the athletic|rugbypass|planet rugby|cricbuzz|cricinfo|wisden|goal\.com|\bmarca\b|\bole\b|lance!|ge\.globo|nrl\.com|wwos|motorsport|autosport|golf digest|golfweek|tennis\.com|livescore|sporting ?life|\brg\.org\b|sportsmole|90min|onefootball|fotmob|flashscore|transfermarkt|football ?365|tribal ?football|\brugby\b|\bcricket\b|\bpride of detroit\b|\b(?:arsenal|chelseafc|manutd|liverpoolfc|mancity|realmadrid|fcbarcelona)\.com\b|soccer|\bbarca\b/i;
// Weather and service sites in native-language feeds.
const SERVICE_SOURCE = /tenki\.jp|weathernews|ウェザーニュース|wetter\.com|wetteronline|meteored|tempo\.com|climatempo|accuweather/i;
// Market-data sites whose items are stock notes, not national news.
const TICKER_SOURCES = new Set([
  'gurufocus', 'tradingview', 'marketscreener', 'benzinga', 'seeking alpha', 'zacks', 'zacks investment research',
  'simply wall st', 'simply wall st.', 'marketbeat', 'stocktitan', 'stock titan', 'investing.com', 'the motley fool',
  'motley fool', 'tipranks', 'insider monkey', 'etf daily news', 'defense world', 'stocktwits', 'finimize', 'gurufocus.com',
  'kalkine media', 'kalkine', 'asktraders', 'asktraders.com', 'investing.com india', 'investing.com canada', 'investing.com uk',
  'investing.com australia', 'investing.com south africa', 'marketscreener.com', 'stockstory', 'tikr',
]);
// Stock-move and results notes: "Shares Fade From 6% Intraday Jump", "What Will Q3 Results Reveal".
const STOCK_NOTE = /\b(?:shares|stock) (?:fade|fades|rise|rises|fall|falls|jump|jumps|slide|slides|surge|surges|drop|drops|climb|climbs|tumble|tumbles|soar|soars|sink|sinks)\b|\b(?:q[1-4]|h[12]) (?:results|earnings)\b|\bby investing\.com$|most-watched stock|worth (?:betting|buying|a look)|stocks? to (?:buy|watch)|\beps\b/i;
const TICKER = /\((?:NYSE|NASDAQ|Nasdaq|TSX|TSXV|ASX|LSE|OTC|OTCQX|TSE|HKEX|NSE|BSE|NYSE American)\s*:\s*[A-Z0-9.]{1,6}\)/;
const OPINION =/^(?:opinion|commentary|analysis|editorial|column|view|letters?|op-ed)\b|\bop-ed\b|^(?:opinion|analysis)\s*[|:]/i;

const CJK = /[぀-ヿ㐀-鿿가-힯]/;
const STOP = new Set(
  'a an and are as at be by for from has have in into is it its of on or over says said than that the their this to was were will with after amid new up out about how why what who when where more than after before der die das und den dem des ein eine im zu von mit fur auf ist nach bei le la les de des du et en un une pour sur au aux dans par o os as do da dos das em no na para com um uma el los las del y por con se que di dan yang ke dari untuk dengan'.split(' '),
);

const stem = (w: string) => (w.length > 5 && w.endsWith('ing') ? w.slice(0, -3) : w.length > 4 && w.endsWith('es') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

// Words that headlines use for one thing. Each maps to one token.
const SYNONYM: Record<string, string> = {
  blast: 'explosion', blasts: 'explosion', explosions: 'explosion', explodes: 'explosion', exploded: 'explosion',
  factory: 'plant', factories: 'plant', plants: 'plant',
  kills: 'kill', killed: 'kill', killing: 'kill', dead: 'kill', dies: 'kill', died: 'kill', deaths: 'kill', death: 'kill',
  quake: 'earthquake', quakes: 'earthquake', earthquakes: 'earthquake', tremor: 'earthquake',
  polls: 'election', poll: 'election', vote: 'election', votes: 'election', elections: 'election',
  resigns: 'resign', resigned: 'resign', resignation: 'resign', quits: 'resign',
  arrested: 'arrest', arrests: 'arrest', detained: 'arrest', detains: 'arrest',
  pm: 'premier',
  intention: 'intent', intends: 'intent', intend: 'intent',
  fridge: 'fridge', fridges: 'fridge', freezer: 'fridge', freezers: 'fridge', refrigerator: 'fridge', refrigeration: 'fridge',
  hack: 'hack', hacks: 'hack', hacking: 'hack', hacked: 'hack', hackers: 'hack', cyberattack: 'hack', cyberattacks: 'hack',
  deadly: 'kill', fatal: 'kill',
  // Road and rail accidents: "Bulgaria highway pileup kills 12" and "Twelve dead after motorway pile-ups".
  crash: 'crash', crashes: 'crash', crashed: 'crash', collision: 'crash', collisions: 'crash', pileup: 'crash', pileups: 'crash',
  motorway: 'highway', motorways: 'highway', highways: 'highway', expressway: 'highway', freeway: 'highway',
  // Number words, so a toll in words matches a toll in digits.
  two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', twenty: '20',
};

// Phrases that headlines use for one thing, replaced before the split into words.
const PHRASES: [RegExp, string][] = [
  [/\bhead of state\b/g, 'president'],
  [/\bhead of government\b/g, 'premier'],
  [/\bprime minister\b/g, 'premier'],
  [/\bcyber[- ]attacks?\b/g, 'hack'],
  [/\bvice[- ]president\b/g, 'vp'],
  [/\bstep(?:s|ping|ped)? down\b/g, 'resign'],
  [/\bpile[- ]ups?\b/g, 'pileup'],
];

/** Stemmed word tokens of a title. CJK titles give character bigrams. */
export function storyTokens(title: string): Set<string> {
  const t = fold(title);
  if (CJK.test(t)) {
    const s = t.replace(/[^\p{L}\p{N}]/gu, '');
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  }
  let plain = t.replace(/['’]s\b/g, '');
  for (const [re, to] of PHRASES) plain = plain.replace(re, to);
  const words = plain.split(/[^\p{L}\p{N}]+/u);
  return new Set(words.filter((w) => (w.length > 1 || /\d/.test(w)) && !STOP.has(w)).map((w) => SYNONYM[w] ?? stem(w)));
}

/** The words of the country's aliases, which do not count when two titles are compared. */
export function ignoreSet(name: string, aliases: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const a of [name, ...aliases]) {
    for (const t of storyTokens(a)) out.add(t);
    for (const w of fold(a).split(/[^\p{L}\p{N}]+/u)) if (w.length >= 4) out.add(w);
  }
  return out;
}

export interface RankContext {
  name: string;
  aliases: readonly string[];
  ignore: Set<string>;
  /** Folded words of every country's names and leaders. They never make two stories one (see sameCluster). */
  places: ReadonlySet<string>;
  now: number;
}

export function rankContext(name: string, aliases: readonly string[], now: number, places: ReadonlySet<string> = new Set()): RankContext {
  return { name, aliases, ignore: ignoreSet(name, aliases), places, now };
}

/** The words that the pick step needs from the context. */
export type PickContext = Pick<RankContext, 'ignore'> & Partial<Pick<RankContext, 'places'>>;

interface Member {
  c: Candidate;
  tokens: Set<string>;
  names: Set<string>;
  /** Capitalised words in any position, for rule (d). */
  caps: Set<string>;
}

function member(c: Candidate, ignore: ReadonlySet<string>): Member {
  return { c, tokens: storyTokens(c.title), names: properNames(c.title, ignore), caps: capitalisedWords(c.title, ignore) };
}

export interface Cluster {
  members: Candidate[];
  /** The first member. Each new candidate is compared with the seed only (no chaining). */
  seed: Member;
  rep: Candidate;
  outlets: number;
  nationRank: number;
  topRank: number;
  /** Native NATION rank that an English cluster takes through the hybrid boost. */
  boostRank: number;
  ageH: number;
  rel: number;
  pen: number;
  score: number;
  /** The score that won the pick step (lower for a third story on one event). Set by pick(). */
  pickScore: number;
  /** The representative as a member, for the same-story test of the pick step. */
  repMember: Member;
}

/**
 * Same story when, without the country's own words:
 * (a) the Dice overlap of the tokens is 0.4 or more; or
 * (b) 3 or more tokens are shared (not for CJK); or
 * (c) 2 or more proper names are shared; or
 * (d) 2 or more tokens are shared, and one of them is a name that both titles capitalise
 *     ("Hegseth to Hold Rare News Conference" and "Pete Hegseth to address reporters ... impeachment").
 * Returns the Dice overlap for a match (at least 0.01), else 0.
 */
export function sameStory(a: Member, b: Member, ignore: ReadonlySet<string>): number {
  const sa = [...a.tokens].filter((w) => !ignore.has(w));
  const sb = new Set([...b.tokens].filter((w) => !ignore.has(w)));
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared += 1;
  const dice = sa.length + sb.size > 0 ? (2 * shared) / (sa.length + sb.size) : 0;
  if (dice >= DICE) return dice;
  const cjk = CJK.test(a.c.title) || CJK.test(b.c.title);
  const match = Math.max(dice, 0.01);
  if (shared >= 3 && !cjk) return match;
  let names = 0;
  for (const n of a.names) if (b.names.has(n)) names += 1;
  if (names >= 2) return match;
  if (shared >= 2 && !cjk) for (const w of a.caps) if (b.caps.has(w) && sb.has(stem(w))) return match;
  return 0;
}

/** Same story test for two candidates (see sameStory). */
export function sameCandidates(a: Candidate, b: Candidate, ignore: ReadonlySet<string>): boolean {
  return sameStory(member(a, ignore), member(b, ignore), ignore) > 0;
}

const FEED_ORDER: Record<Candidate['feed'], number> = { nation: 0, top: 1, outlet: 2, search: 3, newsdata: 4 };

function ageHours(c: Candidate, now: number): number | null {
  if (!c.publishedAt) return null;
  const t = Date.parse(c.publishedAt);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3.6e6) : null;
}

/** Drops junk, press releases and stories older than MAX_AGE_H. Keeps stories with no date. */
export function filterCandidates(cands: readonly Candidate[], now: number): Candidate[] {
  return cands.filter((c) => {
    if (isJunk(c.title, c.source) || isPressRelease(c.url, c.source)) return false;
    const age = ageHours(c, now);
    return age === null || age <= MAX_AGE_H;
  });
}

/** Greedy clustering: each candidate joins the cluster whose seed matches best, else starts a cluster. */
export function cluster(cands: readonly Candidate[], ctx: RankContext): Cluster[] {
  const sorted = [...cands].sort((a, b) => FEED_ORDER[a.feed] - FEED_ORDER[b.feed] || (a.rank ?? 999) - (b.rank ?? 999));
  const clusters: Cluster[] = [];
  for (const c of sorted) {
    const m = member(c, ctx.ignore);
    let best: Cluster | null = null;
    let bestDice = 0;
    for (const cl of clusters) {
      const d = sameStory(cl.seed, m, ctx.ignore);
      if (d > bestDice) {
        best = cl;
        bestDice = d;
      }
    }
    if (best) best.members.push(c);
    else {
      clusters.push({
        members: [c],
        seed: m,
        rep: c,
        outlets: 0,
        nationRank: Infinity,
        topRank: Infinity,
        boostRank: Infinity,
        ageH: 0,
        rel: 0,
        pen: 1,
        score: 0,
        pickScore: 0,
        repMember: m,
      });
    }
  }
  return clusters;
}

const isTier1 = (name: string) => TIER1.has(fold(name).trim());

/**
 * The story that the list shows for a cluster: the best NATION item; else, among the members whose
 * title names the country (all members when none does), a tier-1 outlet, else the newest.
 * So a cluster that holds a national story never shows a sister title about another country.
 */
function representative(cl: Cluster, now: number, rels: readonly Relevance[]): Candidate {
  const nation = cl.members.filter((m) => m.feed === 'nation').sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  if (nation.length > 0) return nation[0];
  const named = cl.members.filter((_, i) => rels[i] === 'yes');
  const pool = named.length > 0 ? named : cl.members;
  const tier1 = pool.find((m) => isTier1(m.source));
  if (tier1) return tier1;
  return [...pool].sort((a, b) => (ageHours(a, now) ?? UNKNOWN_AGE_H) - (ageHours(b, now) ?? UNKNOWN_AGE_H))[0];
}

/** Scores one cluster in place and returns the score. */
export function score(cl: Cluster, ctx: RankContext): number {
  const m = cl.members;
  const outlets = new Set<string>();
  for (const x of m) {
    outlets.add(publisherKey(x.source));
    for (const o of x.outlets) outlets.add(publisherKey(o));
  }
  outlets.delete('');
  cl.outlets = Math.max(1, outlets.size);
  cl.nationRank = Math.min(Infinity, ...m.filter((x) => x.feed === 'nation').map((x) => x.rank ?? Infinity));
  cl.topRank = Math.min(Infinity, ...m.filter((x) => x.feed === 'top').map((x) => x.rank ?? Infinity));
  const ages = m.map((x) => ageHours(x, ctx.now)).filter((x): x is number => x !== null);
  cl.ageH = ages.length > 0 ? Math.min(...ages) : UNKNOWN_AGE_H;
  // A 'weak' match counts as named when the search already tied the story to the country (a capital hint).
  const rels = m.map((x) => {
    const r = relevance(x.title, ctx.name, ctx.aliases);
    return r === 'weak' && x.confirmed ? 'yes' : r;
  });
  cl.rep = representative(cl, ctx.now, rels);
  cl.repMember = cl.rep === cl.seed.c ? cl.seed : member(cl.rep, ctx.ignore);

  const sCov = Math.min(1, Math.log2(1 + cl.outlets) / Math.log2(11));
  const r = Math.min(cl.nationRank, cl.topRank + 2, cl.boostRank);
  const sRank = Number.isFinite(r) ? 1 / (1 + (r - 1) / 5) : 0;
  const sAuth = m.some((x) => isTier1(x.source) || x.outlets.some(isTier1)) ? 1 : m.some((x) => (x.priority ?? Infinity) <= 3000) ? 0.7 : 0.4;
  const sRec = Math.pow(0.5, cl.ageH / HALF_LIFE_H);

  const national = m.some((x) => x.feed === 'nation');
  // 'weak' (only the bare name of a homonym country, with no context word) does not count as named.
  const named = rels.includes('yes');
  // A homonym or a longer place ("Mexico, NY") decides when as many members show it as name the country:
  // then the members that name the country only leave out the town.
  const traps = rels.filter((r) => r === 'trap').length;
  const trapped = !national && traps > 0 && traps >= rels.filter((r) => r === 'yes').length;
  cl.rel = trapped ? 0 : national || named ? 1 : rels.includes('trap') ? 0 : REL_OTHER;

  let pen = 1;
  // Sport: the representative, or most members, read as sport.
  const sportSource = SPORT_SOURCE.test(cl.rep.source) || SPORT_SOURCE.test(cl.rep.domain ?? '');
  const sporty = (t: string) => SPORT.test(t) || SPORT_CASED.test(t);
  if (sporty(cl.rep.title) || sportSource || m.filter((x) => sporty(x.title)).length * 2 > m.length) pen *= PEN_SPORT;
  const ticker = TICKER_SOURCES.has(fold(cl.rep.source).trim()) || TICKER.test(cl.rep.title) || STOCK_NOTE.test(cl.rep.title);
  const service = SOFT_NATIVE.test(cl.rep.title) || SERVICE_SOURCE.test(cl.rep.source);
  if (SOFT.test(cl.rep.title) || service || ticker) pen *= PEN_SOFT;
  if (OPINION.test(cl.rep.title)) pen *= PEN_OPINION;
  if (listsCountry(cl.rep.title, ctx.name)) pen *= PEN_LIST;
  if (Number.isFinite(cl.topRank) && !national && !named) pen *= PEN_WORLD;
  cl.pen = pen;

  cl.score = cl.rel * pen * (W_COV * sCov + W_RANK * sRank + W_AUTH * sAuth + W_REC * sRec);
  return cl.score;
}

/** Dice overlap and shared count of two token sets, without the ignored words. */
function overlap(a: Member, b: Member, ignore: ReadonlySet<string>): { shared: number; dice: number } {
  const sa = [...a.tokens].filter((w) => !ignore.has(w));
  const sb = new Set([...b.tokens].filter((w) => !ignore.has(w)));
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared += 1;
  return { shared, dice: sa.length + sb.size > 0 ? (2 * shared) / (sa.length + sb.size) : 0 };
}

/** Two capitalised names are one name when one starts with the other ("Exxon", "ExxonMobil"). */
const sameName = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

/**
 * The names of a story: its proper names, and the first word of a sentence-case title when that word
 * is a capitalised name ("ExxonMobil signs ..."). A Title Case title gives none.
 */
function storyNames(m: Member): Set<string> {
  const out = new Set(m.names);
  const title = m.c.title.trim();
  const first = fold((title.split(/\s+/)[0] ?? '').replace(/['’]s$/, '').replace(/[^\p{L}'’-]/gu, ''));
  const sentence = title.split(/\s+/).some((w) => w.length >= 4 && /^\p{Ll}/u.test(w));
  if (sentence && first.length >= 5 && m.caps.has(first)) out.add(first);
  return out;
}

const isTitleCase = (title: string) => {
  const long = title.split(/\s+/).filter((w) => /^\p{L}/u.test(w) && w.length >= 4);
  return long.length >= 3 && long.every((w) => /^\p{Lu}/u.test(w));
};

/**
 * True when two members share a name of 5 or more letters that is not a place word or a leader.
 * A Title Case title has no proper names of its own, so there its capitalised words count.
 */
function shareName(a: Member, b: Member, places: ReadonlySet<string>): boolean {
  const namesOf = (m: Member) => [...(isTitleCase(m.c.title) ? m.caps : storyNames(m))].filter((w) => !places.has(w));
  const na = namesOf(a);
  const nb = namesOf(b);
  // Two Title Case titles share capitalised common words ("Takes", "First"): not enough.
  if (isTitleCase(a.c.title) && isTitleCase(b.c.title)) return false;
  return na.some((x) => x.length >= 5 && nb.some((y) => sameName(x, y)));
}

/**
 * True when two clusters tell one story, for the pick step (a little looser than the clustering):
 * - their seeds or representatives pass the same-story test, or share 2 words with a Dice overlap of 0.25 or more;
 * - both link to the same native NATION story through the hybrid boost;
 * - both are younger than FRESH_H, and share 2 words with a Dice overlap of 0.2 or more, or share
 *   a name (brand variants count: "Exxon" and "ExxonMobil").
 */
function sameCluster(a: Cluster, b: Cluster, ignore: ReadonlySet<string>, places: ReadonlySet<string>): boolean {
  if (Number.isFinite(a.boostRank) && a.boostRank === b.boostRank) return true;
  const fresh = a.ageH < FRESH_H && b.ageH < FRESH_H;
  for (const x of [a.seed, a.repMember]) {
    for (const y of [b.seed, b.repMember]) {
      if (sameStory(x, y, ignore) > 0) return true;
      const o = overlap(x, y, ignore);
      if (o.shared >= 2 && o.dice >= 0.25) return true;
      if (fresh && o.shared >= 2 && o.dice >= 0.2) return true;
      if (fresh && shareName(x, y, places)) return true;
    }
  }
  return false;
}

/** True when 2 picked stories already share a capitalised name with this one (one event, many angles). */
function crowded(picked: readonly Cluster[], cl: Cluster): boolean {
  for (const w of cl.repMember.caps) if (picked.filter((p) => [...p.repMember.caps].some((x) => sameName(x, w))).length >= 2) return true;
  return false;
}

/** A third story on one event (a shared capitalised name) counts at this share of its score. */
export const CROWD_FACTOR = 0.6;

/**
 * Picks up to `max` clusters, greedily: the lowest tier first, then the best score.
 * Pass 1 takes at most 1 cluster per publisher; pass 2 allows a second one, only to fill the list.
 * A cluster that tells the same story as a picked cluster is skipped. A cluster that shares a
 * capitalised name with 2 picked clusters counts at CROWD_FACTOR of its score. A cluster that does
 * not name the country needs MIN_OTHER_SCORE, so a thin pool gives fewer than `max` stories, not filler.
 * The result is in tier order, then score order. `tier` defaults to 0 for every cluster.
 */
export function pick(
  clusters: readonly Cluster[],
  max: number,
  ctx: PickContext,
  tier: (cl: Cluster) => number = () => 0,
): Cluster[] {
  const places = ctx.places ?? new Set<string>();
  const picked: Cluster[] = [];
  const perPublisher = new Map<string, number>();
  for (const pass of [1, 2]) {
    while (picked.length < max) {
      let best: Cluster | null = null;
      let bestKey: [number, number] = [Infinity, -Infinity];
      for (const cl of clusters) {
        if (cl.score <= 0 || picked.includes(cl)) continue;
        if (cl.rel < 1 && cl.score < MIN_OTHER_SCORE) continue;
        if ((perPublisher.get(publisherKey(cl.rep.source)) ?? 0) >= pass) continue;
        if (picked.some((p) => sameCluster(p, cl, ctx.ignore, places))) continue;
        const key: [number, number] = [tier(cl), cl.score * (crowded(picked, cl) ? CROWD_FACTOR : 1)];
        if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
          best = cl;
          bestKey = key;
        }
      }
      if (!best) break;
      best.pickScore = bestKey[1];
      picked.push(best);
      const k = publisherKey(best.rep.source);
      perPublisher.set(k, (perPublisher.get(k) ?? 0) + 1);
    }
  }
  return picked.sort((a, b) => tier(a) - tier(b) || b.score - a.score);
}

/** Clusters, scores and sorts one pool of candidates. */
export function rankPool(cands: readonly Candidate[], ctx: RankContext, boost?: (cl: Cluster) => void): Cluster[] {
  // A title that holds only the country's own words ("Saint Vincent and the Grenadines") is no story.
  const stories = filterCandidates(cands, ctx.now).filter((c) => [...storyTokens(c.title)].some((w) => !ctx.ignore.has(w)));
  const clusters = cluster(stories, ctx);
  for (const cl of clusters) {
    boost?.(cl);
    score(cl, ctx);
  }
  return clusters.sort((a, b) => b.score - a.score);
}

/** Capitalised words of 4 or more letters in any position, folded. For the cross-language boost. */
export function capitalisedWords(title: string, ignore: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const m of ` ${title}`.matchAll(/(?<=[\s"“‘'(«])(\p{Lu}[\p{L}'’-]{3,})/gu)) {
    const w = fold(m[1].replace(/['’]s$/, '').replace(/[-'’]+$/, ''));
    if (w.length >= 4 && !ignore.has(w) && !HYBRID_STOP.has(w)) out.add(w);
  }
  return out;
}

// Words that both languages use but that do not identify a story.
const HYBRID_STOP = new Set([
  'deutschland', 'november', 'dezember', 'oktober', 'bank', 'union', 'europa', 'europe', 'european', 'president',
  'presidente', 'minister', 'ministro', 'government', 'police', 'court', 'news', 'live', 'update', 'world', 'says',
  'after', 'with', 'from', 'this', 'that', 'what', 'will', 'trump', 'putin', 'brasil', 'brazil', 'mexico', 'france',
  'germany', 'indonesia', 'japan', 'china', 'russia', 'ukraine', 'german', 'french', 'brazilian', 'mexican',
  'indonesian', 'japanese', 'chinese', 'russian', 'ukrainian', 'nacional', 'national', 'federal', 'senado', 'senate',
  'congreso', 'congresso', 'congress', 'state', 'estado', 'governo', 'gobierno', 'regierung', 'video', 'foto', 'fotos',
  'photos', 'today', 'heute', 'hoje', 'sobre', 'para', 'nach', 'gegen', 'america', 'americas', 'latin', 'sport',
  'sports', 'film', 'show', 'music', 'game', 'games', 'mundial', 'world', 'copa',
]);

/**
 * The hybrid boost: an English cluster that shares a capitalised name with one of the native NATION
 * top-20 titles takes that native rank as its edition rank ("Exxon" matches "ExxonMobil"). Works for Latin scripts only.
 * Returns a function that gives the best native rank for the members of a cluster (Infinity for none).
 */
export function linkNative(native: readonly Candidate[], ignore: ReadonlySet<string>): (members: readonly Candidate[]) => number {
  const top = [...native].filter((c) => c.feed === 'nation' && c.rank !== null).sort((a, b) => a.rank! - b.rank!).slice(0, NATIVE_BOOST_TOP);
  const natNames = top.map((c) => ({ rank: c.rank!, names: capitalisedWords(c.title, ignore) }));
  return (members) => {
    let best = Infinity;
    for (const m of members) {
      const names = capitalisedWords(m.title, ignore);
      for (const n of natNames) if (n.rank < best && [...names].some((w) => [...n.names].some((x) => sameName(w, x)))) best = n.rank;
    }
    return best;
  };
}

export interface Ranked {
  /** The picked clusters, in display order. */
  clusters: Cluster[];
  /** The picked clusters that are a native-language fill. */
  native: Set<Cluster>;
  /** Every scored cluster, English and native. */
  all: Cluster[];
}

/**
 * A strong English story: a score of STRONG_SCORE or more, and STRONG_OUTLETS or more outlets or a link
 * to a native top-20 story. A fresh story from 1 or 2 outlets scores about 0.45 on recency alone, which
 * is not coverage ("Toyota's Scion Brand Returns With Japan's Forbidden-Fruit Minitrucks").
 */
export function isStrong(cl: Cluster): boolean {
  return cl.score >= STRONG_SCORE && (cl.outlets >= STRONG_OUTLETS || Number.isFinite(cl.boostRank));
}

/**
 * Ranks the stories of a country with no English edition (owner decision: hybrid).
 * Strong English stories (see isStrong) take their places first, ranked with help from the native
 * NATION feed (shared proper names). The other places go to native and weak English stories by score,
 * so English filler never pushes out a main national story. English stories come first, then the native fill.
 */
export function rankHybrid(englishCands: readonly Candidate[], nativeCands: readonly Candidate[], ctx: RankContext, max = 5): Ranked {
  const rankOf = linkNative(nativeCands, ctx.ignore);
  const covered = new Set<number>();
  const english = rankPool(englishCands, ctx, (cl) => {
    cl.boostRank = rankOf(cl.members);
  });
  for (const cl of english) if (Number.isFinite(cl.boostRank) && isStrong(cl)) covered.add(cl.boostRank);
  const nativeAll = rankPool(nativeCands, ctx);
  const all = [...english, ...nativeAll];
  if (nativeAll.length === 0) return { clusters: pick(english, max, ctx), native: new Set(), all };
  // Count distinct strong stories: two clusters of one story count once, and a third angle
  // on one event counts only when it stays strong at CROWD_FACTOR.
  const strongPicked = pick(english.filter(isStrong), max, ctx).filter((cl) => cl.pickScore >= STRONG_SCORE);
  // A native story that an English story already tells (same native rank through the boost) is skipped.
  const nativeClusters = nativeAll.filter((cl) => !(Number.isFinite(cl.nationRank) && covered.has(cl.nationRank)));
  const weak = english.filter((cl) => !strongPicked.includes(cl));
  // Tiers: strong English stories, then native and weak English stories together, by score.
  const tierOf = new Map<Cluster, number>([
    ...strongPicked.map((c) => [c, 0] as const),
    ...nativeClusters.map((c) => [c, 1] as const),
    ...weak.map((c) => [c, 1] as const),
  ]);
  const picked = pick([...tierOf.keys()], max, ctx, (c) => tierOf.get(c) ?? 2);
  // Owner decision: English stories come first. The native fill goes after them. Each group is in score order.
  const isNative = (cl: Cluster) => (nativeClusters.includes(cl) ? 1 : 0);
  const clusters = picked.sort((a, b) => isNative(a) - isNative(b) || b.score - a.score);
  return { clusters, native: new Set(clusters.filter((cl) => nativeClusters.includes(cl))), all };
}
