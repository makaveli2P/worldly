// The breaking-news detector. It is pure: the inputs and `now` decide the output, so saved
// inputs replay as tests.
//
// A country goes on alert only when several independent outlets lead with the same severe event
// there. GDACS and USGS can confirm or raise a news story, but they never start an alert alone.
// Wikipedia "In the news" (ITN) gives the list of chronic wars and a clock for follow-up stories.
//
// Each run also takes the state of the last run and returns the next state. The state is an argument,
// so `detect()` stays pure. Fresh coverage decides if an alert lives, not the age of its first headline:
// an alert stays while a placed outlet runs a fresh strong headline (the "pulse"), one wave lasts at
// most 24 h, and a story that ended alerts again only with a new wave of headlines or an escalation.
// See `lifeOf()`.
import type { BreakingAlert, BreakingLevel, BreakingResponse } from '../../../src/types';
import { BIZ_AFTERMATH } from './business.js';
import { AFTERMATH, classify, isLive } from './classify.js';
import { attackerCountries, countryWords, ongoingCountries, placeKeys, primaryCountries } from './match.js';
import { FEEDS } from './sources.js';
import type { BreakingInputs, BreakingState, Classification, EndedAlert, Family, Hazard, HazardType, Headline, HeldAlert } from './types.js';

export const CONFIG = {
  windowHours: 12, // only headlines this new count toward the level
  lookbackHours: 48, // older headlines of the same story still set its start time
  joinHours: 24, // headlines of one place up to this far apart can join one story
  hazardEndHours: 24, // a GDACS or USGS record that ended longer ago than this confirms nothing
  freshHours: 6, // a headline this new is fresh: the pulse needs a fresh lead
  itnFollowUpHours: 36, // a story that starts this long after the day of a matching ITN blurb is a follow-up
  itnSupportHours: 36, // an ITN blurb this new supports the story
  maxSpanHoursNoItn: 12, // with no ITN: a new story that spans more hours than this is a follow-up
  maxAlerts: 3,
  gnTopPositions: 12, // a Google News item in these positions leads its edition
  leadPositions: 3, // a front-page item in these positions is a lead
  undatedPositions: 10, // an item with no date counts only in these positions
  syndicationMinLength: 40, // identical titles this long from two outlets are one wire story
  criticalOutlets: 4,
  criticalGateOutlets: 6, // with no ITN or hazard support, critical needs this many outlets
  majorOutlets: 3,
  businessOutlets: 4, // a business story needs this many outlets for major (the critical rules stay the same)
  chronicOutlets: 6, // a chronic war: an escalation needs this many outlets ...
  chronicEditions: 3, // ... and this many editions
  chronicWaveVoices: 6, // a chronic war: a fresh wave needs this many voices with fresh strong headlines ...
  chronicWaveLeads: 3, // ... this many of them in a lead position ...
  chronicWaveDeaths: 20, // ... and this many dead (or tier 3)
  chronicDays: 2, // a conflict that started alerts on this many earlier days ...
  historyDays: 7, // ... of this many days is a recurring (chronic) conflict
  holdMinHours: 2, // for this long after the first alert, one voice with a fresh strong headline keeps the alert
  waveHours: 24, // one wave of an alert lasts at most this long; then it needs a renewal
  waveVoices: 3, // a new wave needs this many voices with new fresh strong headlines, one of them placed
  storyCapHours: 72, // after this long from the first alert, only an escalation renews a story
  endedHours: 48, // the state keeps an ended story this long
  escalateFactor: 2, // an escalation: the agreed toll at least doubles ...
  escalateAdd: 20, // ... and rises by at least this many
  pickSlackHours: 1.5, // the chip article: a trusted direct link this much older than the newest still wins
  sameStoryHours: 24, // a story found by its words only must start within this gap of the stored story
  heldItemIds: 40, // a state entry keeps at most this many item hashes
  heldWords: 20, // a state entry keeps at most this many distinctive words
  waveItemIds: 20, // the item hashes at the start of a wave
  maxEnded: 10, // ended stories in the state
  maxStarts: 60, // start days in the state
};

const HOUR = 3.6e6;
const LEVEL_RANK: Record<BreakingLevel, number> = { critical: 2, major: 1 };
// When ITN cannot be read: wars that lead the news every day and would otherwise flash all the time.
const CHRONIC_FALLBACK = ['UKR', 'RUS', 'PSE', 'SDN', 'IRN', 'YEM'];

// ---------------------------------------------------------------- text helpers

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have', 'in', 'into', 'is', 'it', 'its', 'of',
  'on', 'or', 'over', 'says', 'said', 'than', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'will', 'with',
  'after', 'amid', 'new', 'up', 'out', 'about',
]);
// Words that every story of a family shares. They do not show that two titles tell one story.
const GENERIC = new Set([
  'killed', 'kill', 'kills', 'killing', 'dead', 'dies', 'died', 'death', 'deaths', 'toll', 'injured', 'people', 'least',
  'police', 'shooting', 'attack', 'attacks', 'earthquake', 'quake', 'strikes', 'strike', 'city', 'man', 'woman',
  'officials', 'say', 'reports', 'report', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'more', 'near', 'during', 'country', 'state', 'news', 'live', 'updates', 'latest', 'breaking', 'video', 'watch',
  'dozens', 'hundreds', 'thousands', 'nearly', 'some', 'many', 'others', 'been',
  // Event words of one family: "jet crash" and "bus crash" in one country are two stories.
  'crash', 'crashes', 'collision', 'fire', 'blaze', 'explosion', 'blast', 'flood', 'floods', 'flooding', 'storm',
  'bombing', 'missile', 'missiles', 'drone', 'drones', 'airstrike', 'airstrikes', 'wounded', 'injures', 'victims',
  'mass', 'deadly', 'gunman', 'gunmen', 'shooter', 'attacker', 'attackers',
  // Business words: two CEO stories in one country are two stories.
  'ceo', 'chief', 'executive', 'boss', 'chairman', 'founder', 'resign', 'resigns', 'resigned', 'quits', 'shares', 'stock',
  'stocks', 'market', 'markets', 'billion', 'bn', 'trillion', 'deal', 'points', 'percent', 'investors', 'company', 'firm',
]);

/** "invades", "invaded", "invade" -> "invad". A crude stem, enough for headline words. */
function stem(w: string): string {
  for (const suffix of ['ing', 'ed', 'es', 's', 'e']) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 4) return w.slice(0, -suffix.length);
  }
  return w;
}

/** The distinctive words of a title: no stopwords, no generic words, no country words, no numbers. */
function storyTokens(title: string): Set<string> {
  const skip = countryWords(title);
  const words = fold(title).replace(/['’]s\b/g, '').split(/[^\p{L}\p{N}]+/u);
  return new Set(
    words.filter((w) => w.length > 1 && !STOPWORDS.has(w) && !GENERIC.has(w) && !skip.has(w) && !/^\d+$/.test(w)).map(stem),
  );
}

/**
 * Two token sets tell one story: 3 shared words, or half of the shorter set (also for short titles).
 * `minShared` sets how many words the second test needs.
 */
function similar(a: Set<string>, b: Set<string>, minShared = 1): boolean {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  const min = Math.min(a.size, b.size);
  return shared >= 3 || (min >= 1 && shared >= minShared && shared / min >= 0.5);
}

/** "The Hindu", "thehindu.com" and "THE HINDU" give one key. */
function publisherKey(source: string): string {
  return fold(source)
    .replace(/^www\./, '')
    .replace(/\.(?:com|net|org|co|news|in|uk|au|ca)(?:\.[a-z]{2})?$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .replace(/^the(?=.{3})/, '');
}

// Names of one outlet that the suffix rule does not join.
const OUTLET_ALIASES: Record<string, string> = {
  abcnewsaustralia: 'abcau',
  abcnewsheadlines: 'abcau',
  abcnewsheadlinesaustralianbroadcastingcorporation: 'abcau',
  australianbroadcastingcorporation: 'abcau',
  abcnet: 'abcau',
  apnews: 'ap',
  associatedpress: 'ap',
  deutschewelle: 'dw',
  nationalpublicradio: 'npr',
  nytimes: 'newyorktimes',
  bbccouk: 'bbc',
  aljazeeranet: 'aljazeera',
  agencefrancepresse: 'afp',
  thomsonreuters: 'reuters',
};

/** "CBC News", "CBC" and "cbc.ca" are one outlet; so are "Al Jazeera" and "Al Jazeera English". */
export function outletKey(publisher: string): string {
  const key = publisherKey(publisher);
  if (OUTLET_ALIASES[key]) return OUTLET_ALIASES[key];
  const short = key.replace(/(?:news|english|online|international|world|tv|ca|com)+$/, '') || key;
  return OUTLET_ALIASES[short] ?? short;
}

const normTitle = (t: string) => fold(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// ---------------------------------------------------------------- stories

export interface Item {
  h: Headline;
  c: Classification;
  ids: string[];
  id: string; // itemId(url)
  age: number | null; // hours; null when undated
  time: number | null; // epoch ms
  recent: boolean;
  strong: boolean; // tier 2 or more
  placed: boolean; // a front-page lead (top 3) or a Google News top-12 item
  fresh: boolean; // dated and at most freshHours old; an undated item is never fresh
  junk: boolean; // a live blog, a video clip or an aggregator copy: it neither keeps the pulse nor goes in the chip
  armed: boolean; // an attack headline that names another country as the attacker ("Israeli attack on Gaza")
  outlet: string;
  tokens: Set<string>;
  places: Set<string>;
}

/**
 * The countries of a headline. A business story is in the home country of its company or market, not in
 * a country that the title names ("Nvidia CEO quits over affair with Chinese spy" is a US story). A leader
 * of a company who is killed is in the country of the scene, else in the home country of the company.
 */
function sceneOf(title: string, c: Classification): string[] {
  if (c.family === 'business' && c.subject) return [c.subject.country];
  const ids = primaryCountries(title);
  return ids.length || !c.subject ? ids : [c.subject.country];
}

/**
 * One headline as a detector item, with no places (the caller adds them per country). Null when the
 * classifier does not flag it, or when it is too old, or undated and too low in its feed.
 */
export function makeItem(h: Headline, now: number): Omit<Item, 'places'> | null {
  const time = h.publishedAt ? Date.parse(h.publishedAt) : NaN;
  const age = Number.isFinite(time) ? (now - time) / HOUR : null;
  if (age !== null && (age > CONFIG.lookbackHours || age < -1)) return null;
  if (age === null && h.position > CONFIG.undatedPositions) return null;
  const c = classify(h.title);
  if (!c) return null;
  const ids = sceneOf(h.title, c);
  const armed = c.family === 'attack' && [...attackerCountries(h.title)].some((a) => !ids.includes(a));
  return {
    h, c, ids, id: itemId(h.url), age, time: age === null ? null : time, armed,
    recent: age === null || age <= CONFIG.windowHours,
    strong: c.tier >= 2,
    placed: (h.kind === 'front' && h.position <= CONFIG.leadPositions) || (h.kind === 'gn' && h.position <= CONFIG.gnTopPositions),
    fresh: age !== null && age <= CONFIG.freshHours,
    junk: isJunk(h),
    outlet: outletKey(h.publisher),
    tokens: storyTokens(h.title),
  };
}

interface Story {
  id: string;
  family: Family;
  items: Item[];
}

/** Splits one (country, family) group into stories, so that unrelated events do not add up. */
function splitStories(id: string, family: Family, items: Item[]): Story[] {
  const n = items.length;
  const parent = [...Array(n).keys()];
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = items[i];
      const b = items[j];
      // Two companies, or a company and a market, are two business stories. A leader of two companies
      // is one story: "Elon Musk resigns" (SpaceX in the data) joins "Elon Musk steps down as Tesla CEO".
      const samePerson = !!a.c.person && a.c.person === b.c.person;
      if (family === 'business' && a.c.subject?.id !== b.c.subject?.id && !samePerson) continue;
      // A place, a death toll or two critical-class headlines join a story only when they are close in
      // time ("Russia invades Estonia" and "Russian forces cross into Estonia"). A 30 h old attack in
      // Mogadishu does not join a new one there.
      const gap = a.time === null || b.time === null ? 0 : Math.abs(a.time - b.time);
      const close = gap <= CONFIG.windowHours * HOUR;
      // Up to 24 h apart, the same place joins only with the same toll or 2 shared words.
      const sameToll = a.c.deaths > 0 && a.c.deaths === b.c.deaths;
      const samePlace = [...a.places].some((p) => b.places.has(p)) &&
        (close || (gap <= CONFIG.joinHours * HOUR && (sameToll || similar(a.tokens, b.tokens, 2))));
      const sameDeaths = sameToll && close;
      const bothCritical = a.c.tier === 3 && b.c.tier === 3 && close;
      // Headlines far apart in time need 2 shared words: "church" alone does not join two shootings a day apart.
      if ((samePerson && close) || samePlace || sameDeaths || bothCritical || similar(a.tokens, b.tokens, close ? 1 : 2)) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Item[]>();
  items.forEach((it, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), it]);
  });
  return [...groups.values()].map((g) => ({ id, family, items: g }));
}

/** Outlets that carry one wire story with the same long title count as one voice. */
function voices(items: Item[]): Map<string, Item[]> {
  const outlets = [...new Set(items.map((i) => i.outlet))];
  const parent = new Map(outlets.map((o) => [o, o]));
  const find = (o: string): string => (parent.get(o) === o ? o : find(parent.get(o)!));
  const byTitle = new Map<string, string>();
  for (const it of items) {
    const t = normTitle(it.h.title);
    if (t.length < CONFIG.syndicationMinLength) continue;
    const other = byTitle.get(t);
    if (other && find(other) !== find(it.outlet)) parent.set(find(it.outlet), find(other));
    else if (!other) byTitle.set(t, it.outlet);
  }
  const groups = new Map<string, Item[]>();
  for (const it of items) groups.set(find(it.outlet), [...(groups.get(find(it.outlet)) ?? []), it]);
  return groups;
}

/** The second-highest value: two voices must agree. */
const second = (values: number[]) => values.sort((a, b) => b - a)[1] ?? 0;

// ---------------------------------------------------------------- hazards and ITN

const HAZARD_WORDS: Record<HazardType, RegExp> = {
  EQ: /\b(?:earthquake|quake|tremor|tsunami)\b/i,
  TC: /\b(?:cyclone|hurricane|typhoon|tropical storm|storm)\b/i,
  FL: /\bflood\w*/i,
  VO: /\b(?:volcan\w*|eruption|erupt\w*)\b/i,
};

/** A GDACS or USGS record that confirms a disaster story in the same country. */
function matchingHazards(story: Story, hazards: Hazard[], now: number): Hazard[] {
  if (story.family !== 'disaster') return [];
  return hazards.filter((z) => {
    if (!z.countries.includes(story.id)) return false;
    if (!story.items.some((i) => HAZARD_WORDS[z.type].test(i.h.title))) return false;
    const from = Date.parse(z.from);
    const to = Date.parse(z.to);
    if (!Number.isFinite(from) || from > now + HOUR) return false;
    if (Number.isFinite(to) && to < now - CONFIG.hazardEndHours * HOUR) return false;
    if (z.type === 'EQ' && now - from > 72 * HOUR) return false;
    const strong = z.level === 'orange' || z.level === 'red' || (z.source === 'usgs' && (z.magnitude ?? 0) >= 7);
    return strong;
  });
}

interface ItnEntry {
  ids: string[];
  family: Family;
  time: number;
  tokens: Set<string>;
  places: Map<string, Set<string>>;
  deaths: number;
  tier: number;
}

function itnEntries(inputs: BreakingInputs): ItnEntry[] {
  const out: ItnEntry[] = [];
  for (const b of inputs.itn?.blurbs ?? []) {
    const c = classify(b.text);
    const time = Date.parse(b.date);
    if (!c || !Number.isFinite(time)) continue;
    const ids = sceneOf(b.text, c);
    out.push({ ids, family: c.family, time, tokens: storyTokens(b.text), places: new Map(ids.map((id) => [id, placeKeys(b.text, id)])), deaths: c.deaths, tier: c.tier });
  }
  return out;
}

/**
 * True when an ITN blurb tells the same story: same country and family, and a shared place, toll or
 * words. `strict` needs 2 shared words: one word ("school") does not make an old blurb the same story.
 */
function itnMatches(e: ItnEntry, story: Pick<Story, 'id' | 'family' | 'items'>, strict: boolean): boolean {
  if (e.family !== story.family || !e.ids.includes(story.id)) return false;
  const places = e.places.get(story.id) ?? new Set();
  return story.items.some(
    (i) => [...i.places].some((p) => places.has(p)) || (e.deaths > 0 && i.c.deaths === e.deaths) || similar(e.tokens, i.tokens, strict ? 2 : 1),
  );
}

// ---------------------------------------------------------------- detection

export interface Candidate {
  id: string;
  family: Family;
  subject: string | null; // business only: the company or market of the story ("Q182477", "mkt-USA")
  level: BreakingLevel | null;
  reason: string; // why the level is what it is (debug output only)
  score: number;
  voices: number;
  editions: number;
  lead: number;
  tierEff: number;
  deaths: number;
  since: number;
  updatedAt: number;
  freshLeads: number; // voices with a strong, placed and fresh headline
  freshVoices: number; // voices with a strong and fresh headline
  windowVoices: number; // voices with a strong headline in the 12 h window
  pulse: boolean; // freshLeads >= 1 and windowVoices >= 2: the story still leads
  war: boolean; // a conflict story, or an attack story whose strong voices mostly name a state attacker
  fullLevel: BreakingLevel | null; // the level of the full test, before the gates and the life rules
  fullReason: string;
  pick: Item; // the article of the chip: its title, link, source and date go out together
  basis: BreakingAlert['basis'];
  items: Item[];
  held: boolean; // true when only the life rules keep the alert (it fails the full test now)
  renewed: boolean; // true when a new wave or an escalation renews the story in this run
  wave: number; // the wave number of the alert; 0 when the story is not an alert
  span: number; // hours from the first to the last dated headline
  aftermath: number; // recent voices with aftermath words
}

export interface DetectResult {
  response: BreakingResponse;
  candidates: Candidate[];
  state: BreakingState; // give it to the next run
}

/** Detects breaking news. See README "Breaking news" for the rules in plain words. */
export function detect(inputs: BreakingInputs, previous: BreakingState | null = null): DetectResult {
  const { now } = inputs;
  const groups = new Map<string, { id: string; family: Family; items: Item[] }>();
  for (const h of inputs.headlines) {
    const item = makeItem(h, now);
    if (!item) continue;
    for (const id of item.ids) {
      const key = `${id}|${item.c.family}`;
      if (!groups.has(key)) groups.set(key, { id, family: item.c.family, items: [] });
      const places = placeKeys(h.title, id);
      // The headlines of one company or market share a place key, so that they join one story.
      if (item.c.family === 'business' && item.c.subject) places.add(`biz:${item.c.subject.id}`);
      groups.get(key)!.items.push({ ...item, places });
    }
  }

  const itnOk = inputs.itn !== null;
  const chronic = inputs.itn?.ongoing?.length ? ongoingCountries(inputs.itn.ongoing) : new Set(CHRONIC_FALLBACK);
  const itn = itnEntries(inputs);

  let stories = [...groups.values()].flatMap((g) => splitStories(g.id, g.family, g.items)).filter((s) => s.items.some((i) => i.recent));

  // One story about two countries ("Russia launches invasion of Estonia") stays only with its subject:
  // the country that more headlines name alone, then the one with more outlets.
  const itemKey = (i: Item) => `${i.h.feed}#${i.h.position}`;
  const sole = (s: Story) => s.items.filter((i) => i.ids.length === 1).length;
  const outletsOf = (s: Story) => new Set(s.items.filter((i) => i.recent).map((i) => i.outlet)).size;
  const dropped = new Set<Story>();
  for (const a of stories) {
    for (const b of stories) {
      if (a === b || a.id >= b.id || a.family !== b.family || dropped.has(a) || dropped.has(b)) continue;
      const keysB = new Set(b.items.map(itemKey));
      const shared = a.items.filter((i) => keysB.has(itemKey(i))).length;
      if (shared * 2 < Math.min(a.items.length, b.items.length)) continue;
      const order = sole(a) - sole(b) || outletsOf(a) - outletsOf(b);
      if (order > 0) dropped.add(b);
      else if (order < 0) dropped.add(a);
    }
  }
  stories = stories.filter((s) => !dropped.has(s));

  const candidates: Candidate[] = [];
  for (const story of stories) {
    const recent = story.items.filter((i) => i.recent);
    const byVoice = [...voices(recent).values()];
    const voiceTier = byVoice.map((its) => Math.max(...its.map((i) => i.c.tier)));
    const voiceDeaths = byVoice.map((its) => Math.max(...its.map((i) => i.c.deaths)));
    let tierEff = second(voiceTier);
    const deaths = second(voiceDeaths);
    const nVoices = byVoice.length;
    const editions = new Set(recent.filter((i) => i.h.kind === 'gn' && i.placed).map((i) => i.h.edition)).size;
    const lead = new Set(recent.filter((i) => i.h.kind === 'front' && i.placed).map((i) => i.outlet)).size;
    // A live blog, a video clip or an aggregator copy is no fresh lead. An outlet changes the date of a live
    // blog at each update, so the blog alone would keep a story that is stale; and the chip never shows it.
    const freshLeads = byVoice.filter((its) => its.some((i) => i.strong && i.placed && i.fresh && !i.junk)).length;
    const freshVoices = byVoice.filter((its) => its.some((i) => i.strong && i.fresh && !i.junk)).length;
    const windowVoices = byVoice.filter((its) => its.some((i) => i.strong)).length;
    // "Israeli attack on Gaza tent camp kills 18" is war coverage in the attack family. A terror bombing or
    // a mass shooting names no state attacker.
    const armedVoices = byVoice.filter((its) => its.some((i) => i.strong && i.armed)).length;
    const war = story.family === 'conflict' || (story.family === 'attack' && armedVoices > 0 && armedVoices * 2 >= windowVoices);
    const live = recent.some((i) => isLive(i.h.title, i.h.url));
    const times = story.items.map((i) => i.time).filter((t): t is number => t !== null);
    const recentTimes = recent.map((i) => i.time).filter((t): t is number => t !== null);
    const since = times.length ? Math.min(...times) : now;
    const updatedAt = recentTimes.length ? Math.max(...recentTimes) : now;

    const hazards = matchingHazards(story, inputs.hazards, now);
    const red = hazards.some((z) => z.level === 'red');
    const itnSupport = itn.some((e) => now - e.time <= CONFIG.itnSupportHours * HOUR && itnMatches(e, story, false));
    // A red GDACS or PAGER level raises a deadly disaster story to critical-class.
    if (red && tierEff >= 2) tierEff = 3;
    const position = editions >= 1 || lead >= 1;

    // The full test: the level from the coverage of the 12 h window.
    let level: BreakingLevel | null = null;
    let reason = 'below thresholds';
    if (tierEff === 3 && nVoices >= CONFIG.criticalOutlets && (editions >= 2 || lead >= 2)) {
      // Critical needs ITN or hazard support, or wide coverage, until saved live data shows no false alarms.
      if (nVoices >= CONFIG.criticalGateOutlets || hazards.length || itnSupport) {
        level = 'critical';
        reason = 'critical';
      } else {
        level = 'major';
        reason = 'critical-class, gate not met';
      }
    } else if (tierEff >= 2 && nVoices >= (story.family === 'business' ? CONFIG.businessOutlets : CONFIG.majorOutlets) && position) {
      level = 'major';
      reason = 'major';
    } else if (tierEff >= 2 && nVoices >= 2 && position && hazards.length) {
      level = 'major';
      reason = 'major, hazard-confirmed';
    }

    const basis: BreakingAlert['basis'] = ['news'];
    if (hazards.some((z) => z.source === 'gdacs')) basis.push('gdacs');
    if (hazards.some((z) => z.source === 'usgs')) basis.push('usgs');
    if (itnSupport) basis.push('itn');
    const score = nVoices + 2 * editions + lead + 3 * tierEff + 2 * Math.log10(deaths + 1) + (live ? 1 : 0);
    const c: Candidate = {
      id: story.id, family: story.family, subject: storySubject(story), level, reason, score, voices: nVoices, editions, lead, tierEff, deaths, since, updatedAt,
      freshLeads, freshVoices, windowVoices, pulse: freshLeads >= 1 && windowVoices >= 2, war, fullLevel: level, fullReason: reason,
      pick: story.items[0], basis, items: story.items, held: false, renewed: false, wave: 0,
      span: times.length ? (Math.max(...times) - since) / HOUR : 0,
      // "resigns" is the event of a business story, not an aftermath word. Business has its own list.
      aftermath: new Set(recent.filter((i) => (story.family === 'business' ? BIZ_AFTERMATH : AFTERMATH).test(i.h.title)).map((i) => i.outlet)).size,
    };
    c.pick = pickArticle(c, null);
    candidates.push(c);
  }

  // Each live alert of the last run finds its story again; then each ended story does.
  const liveOf = new Map<Candidate, HeldAlert>();
  const gone: HeldAlert[] = [];
  for (const e of previous?.alerts ?? []) {
    const c = matchEntry(e, e.since, candidates.filter((x) => !liveOf.has(x)));
    if (c) liveOf.set(c, e);
    else gone.push(e);
  }
  const prevEnded = (previous?.ended ?? []).filter((x) => now - x.endedAt <= CONFIG.endedHours * HOUR);
  const endedOf = new Map<Candidate, EndedAlert>();
  for (const x of prevEnded) {
    const c = matchEntry(x, x.endedAt, candidates.filter((y) => !liveOf.has(y) && !endedOf.has(y)));
    if (c) endedOf.set(c, x);
  }

  // The life rules decide the level of each story.
  const ctx: LifeContext = { now, itn, itnOk, chronic, starts: previous?.starts ?? [] };
  const endsNow = new Set<Candidate>();
  for (const c of candidates) {
    const e = liveOf.get(c) ?? null;
    const x = endedOf.get(c) ?? null;
    if (e) c.pick = pickArticle(c, e.pickId);
    const life = lifeOf(c, e, x, ctx);
    c.level = life.level;
    c.reason = life.reason;
    c.held = life.held;
    c.renewed = life.renewed;
    if (life.ended) endsNow.add(c);
    const prev = e ?? x;
    c.wave = !c.level ? 0 : !prev ? 1 : c.renewed ? prev.waves + 1 : prev.waves;
  }

  // One alert per country: the best candidate. At the same level, a story that passes the full test
  // comes before a held story, so a new alert pushes a held alert off the list first. Then a business
  // story comes after every other kind, so it never pushes a deadly event off the list.
  const rank = (c: Candidate) => (c.level ? LEVEL_RANK[c.level] : 0);
  const isBiz = (c: Candidate) => Number(c.family === 'business');
  const order = (a: Candidate, b: Candidate) => rank(b) - rank(a) || Number(a.held) - Number(b.held) || isBiz(a) - isBiz(b) || b.score - a.score;
  const byCountry = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!c.level) continue;
    const prev = byCountry.get(c.id);
    if (!prev || order(c, prev) < 0) byCountry.set(c.id, c);
  }
  const shown = [...byCountry.values()].sort(order).slice(0, CONFIG.maxAlerts);

  // The next state. A story that ended, or that is gone, goes to `ended`. An alert that passes the
  // rules but is not on the list (one per country, at most 3) leaves the state.
  const today = utcDay(now);
  const starts: string[] = [];
  const alerts: HeldAlert[] = shown.map((c): HeldAlert => {
    const e = liveOf.get(c);
    const prev = e ?? endedOf.get(c) ?? null;
    const start = !prev || c.renewed;
    // War coverage in the attack family counts as a conflict start for the recurring rule.
    if (start) starts.push(`${c.id}|${c.war ? 'conflict' : c.family}|${today}`);
    const newestFirst = [...c.items].sort((a, b) => (b.time ?? now) - (a.time ?? now));
    return {
      key: prev ? prev.key : alertKey(c.id, c.family, c.since, c.subject),
      country: c.id,
      family: c.family,
      level: c.level!,
      since: prev ? Math.min(prev.since, c.since) : c.since,
      firstAlertAt: prev?.firstAlertAt ?? now,
      lastQualifiedAt: c.held && e ? e.lastQualifiedAt : now,
      // The item hashes of this run come first. The hashes of the last runs fill the rest.
      itemIds: unique([...c.items.map((i) => i.id), ...(prev?.itemIds ?? [])]).slice(0, CONFIG.heldItemIds),
      words: unique([...storyWords(c.items), ...(prev?.words ?? [])]).slice(0, CONFIG.heldWords),
      waveAt: start || !e ? now : e.waveAt,
      waves: c.wave,
      peakTier: Math.max(prev?.peakTier ?? 0, c.tierEff),
      peakDeaths: Math.max(prev?.peakDeaths ?? 0, c.deaths),
      waveIds: start || !e ? unique(newestFirst.map((i) => i.id)).slice(0, CONFIG.waveItemIds) : e.waveIds,
      pickId: c.pick.id,
    };
  });

  const toEnded = (e: HeldAlert, c: Candidate | null): EndedAlert => ({
    key: e.key, country: e.country, family: e.family, since: e.since, firstAlertAt: e.firstAlertAt, waveAt: e.waveAt, waves: e.waves,
    endedAt: now, peakTier: Math.max(e.peakTier, c?.tierEff ?? 0), peakDeaths: Math.max(e.peakDeaths, c?.deaths ?? 0),
    itemIds: unique([...(c?.items.map((i) => i.id) ?? []), ...e.itemIds]).slice(0, CONFIG.heldItemIds),
    words: e.words,
  });
  const revived = new Set(shown.map((c) => endedOf.get(c)).filter((x): x is EndedAlert => !!x));
  const ended = [
    ...gone.map((e) => toEnded(e, null)),
    ...[...liveOf].filter(([c]) => endsNow.has(c)).map(([c, e]) => toEnded(e, c)),
    ...prevEnded.filter((x) => !revived.has(x)),
  ]
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, CONFIG.maxEnded);
  // A start day stays while a story that started after it can still use it (the recurring rule).
  const keepFrom = utcDay(now - (CONFIG.historyDays + Math.ceil(CONFIG.storyCapHours / 24)) * DAY);
  const allStarts = unique([...(previous?.starts ?? []), ...starts])
    .filter((s) => s.slice(-8) >= keepFrom)
    .sort((a, b) => (a.slice(-8) === b.slice(-8) ? (a < b ? -1 : 1) : a.slice(-8) < b.slice(-8) ? -1 : 1))
    .slice(-CONFIG.maxStarts);
  const state: BreakingState = { v: 1, savedAt: now, alerts };
  if (ended.length) state.ended = ended;
  if (allStarts.length) state.starts = allStarts;

  const response: BreakingResponse = {
    alerts: shown.map((c, i): BreakingAlert => {
      const s = alerts[i];
      return {
        key: s.key,
        country: c.id,
        level: c.level!,
        kind: c.family,
        ...articleOf(c.pick),
        since: new Date(s.since).toISOString(),
        updatedAt: new Date(Math.max(c.updatedAt, s.since)).toISOString(),
        outlets: c.voices,
        basis: c.basis,
        ...(c.family === 'business' && c.subject ? { subject: c.subject } : {}),
      };
    }),
    generatedAt: new Date(now).toISOString(),
    sources: inputs.sources,
  };

  return { response, candidates: candidates.sort(order), state };
}

const DAY = 24 * HOUR;
const EMPTY = new Set<string>();
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
/** "20261112": the UTC day of a time. */
const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');

/** The distinctive words of the headlines of a story, the most frequent first. */
function storyWords(items: Item[]): string[] {
  const count = new Map<string, number>();
  for (const i of items) for (const w of i.tokens) count.set(w, (count.get(w) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([w]) => w);
}

/** The fields of a live or ended state entry that identify its story. */
type StoryRef = Pick<HeldAlert, 'key' | 'country' | 'family' | 'since' | 'itemIds' | 'words'>;

/**
 * The story of a state entry. The story must have the same country and kind, and an overlap with the
 * entry: an item with a stored URL hash, or a headline that shares 2 distinctive words with the stored
 * words. The country, kind and day are not enough, because two stories of one country and kind on one
 * day have the same key. A shared item hash needs no time check, so a story that lasts more than 48 h
 * keeps its entry. A match by words only needs the same key, or a story that starts at most 24 h before
 * the stored first evidence and at most 24 h after `until` (the stored first evidence of a live entry,
 * the end of an ended entry). The story with the most shared items wins, then the most headlines with
 * shared words, then the same key, then a story that passes the full test, then the higher score.
 */
function matchEntry(entry: StoryRef, until: number, candidates: Candidate[]): Candidate | null {
  const ids = new Set(entry.itemIds);
  const words = new Set(entry.words);
  const sameKey = (c: Candidate) => alertKey(c.id, c.family, c.since, c.subject) === entry.key;
  const near = (c: Candidate) => sameKey(c) || (c.since > entry.since - CONFIG.sameStoryHours * HOUR && c.since < until + CONFIG.sameStoryHours * HOUR);
  const matches = candidates
    // A business story keeps its company or market: the key ends with the subject.
    .filter((c) => c.id === entry.country && c.family === entry.family && (c.family !== 'business' || !c.subject || entry.key.endsWith(`-${c.subject}`)))
    .map((c) => ({
      c,
      byId: c.items.filter((i) => ids.has(i.id)).length,
      byWords: c.items.filter((i) => similar(i.tokens, words, 2)).length,
    }))
    .filter((m) => m.byId > 0 || (m.byWords > 0 && near(m.c)));
  matches.sort(
    (a, b) =>
      b.byId - a.byId ||
      b.byWords - a.byWords ||
      Number(sameKey(b.c)) - Number(sameKey(a.c)) ||
      Number(!!b.c.fullLevel) - Number(!!a.c.fullLevel) ||
      b.c.score - a.c.score,
  );
  return matches[0]?.c ?? null;
}

/** A short hash (FNV-1a, 32 bits) of an item URL. The state keeps the hash, not the URL. */
export function itemId(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------- the life of an alert

interface LifeContext {
  now: number;
  itn: ItnEntry[];
  itnOk: boolean;
  chronic: Set<string>; // the ITN "Ongoing" countries, or the fallback list
  starts: string[]; // BreakingState.starts of the last run
}

interface Life {
  level: BreakingLevel | null;
  reason: string;
  held: boolean; // only the life rules keep the alert: it fails the full test now
  renewed: boolean; // a new wave or an escalation starts a new wave of the story
  ended: boolean; // a live alert ends in this run
}

/**
 * A new wave: at least 3 voices (waveVoices) with fresh strong headlines that `known` does not hold, and
 * one of these headlines is placed. An outlet that changes the date of an old URL does not make a new wave.
 */
function freshWave(c: Candidate, known: Set<string>): boolean {
  const items = c.items.filter((i) => i.strong && i.fresh && !i.junk && !known.has(i.id));
  return items.some((i) => i.placed) && voices(items).size >= CONFIG.waveVoices;
}

type Peak = Pick<HeldAlert, 'peakTier' | 'peakDeaths' | 'waveAt' | 'firstAlertAt'>;

/** True when a toll is an escalation over the peak: it at least doubles and rises by 20. */
const tollEscalates = (deaths: number, peakDeaths: number) =>
  deaths > 0 && deaths >= Math.max(CONFIG.escalateFactor * peakDeaths, peakDeaths + CONFIG.escalateAdd);

/**
 * An escalation over the peak of the story: a higher tier (a red GDACS or PAGER level gives tier 3), an
 * agreed toll that at least doubles and rises by 20, or a new development in ITN.
 *
 * ITN often posts an event on the day after it happens, so a matching blurb alone is no development.
 * The blurb must be at most 36 h old, dated on a later UTC day than the start of the wave and the first
 * alert, and it must tell more than the story showed: a higher tier or toll than the peak, or 2 shared
 * words with a fresh strong headline that `known` does not hold (`waveIds` of a live alert, `itemIds` of
 * an ended story). An ended story also needs such a new headline, so old URLs with new dates never renew it.
 */
function escalated(c: Candidate, peak: Peak, known: Set<string>, ended: boolean, ctx: LifeContext): boolean {
  if (c.tierEff > peak.peakTier) return true;
  if (tollEscalates(c.deaths, peak.peakDeaths)) return true;
  const fresh = c.items.filter((i) => i.strong && i.fresh && !i.junk && !known.has(i.id));
  if (ended && !fresh.length) return false;
  const day = utcDay(Math.max(peak.waveAt, peak.firstAlertAt));
  return ctx.itn.some(
    (e) =>
      ctx.now - e.time <= CONFIG.itnSupportHours * HOUR && utcDay(e.time) > day && itnMatches(e, c, true) &&
      (e.tier > peak.peakTier || tollEscalates(e.deaths, peak.peakDeaths) || fresh.some((i) => similar(e.tokens, i.tokens, 2))),
  );
}

/** True when the story is larger than an ITN blurb: a higher tier, or a toll that doubles and rises by 20. */
function aboveBlurb(c: Candidate, e: ItnEntry): boolean {
  return c.tierEff > e.tier || (e.deaths > 0 && tollEscalates(c.deaths, e.deaths));
}

/**
 * The follow-up rules. `since` is the first evidence of the story (of its state entry when it has one).
 * - ITN as a clock: the story starts more than 36 h after the start of the day of a matching blurb,
 *   and it is not larger than the blurb.
 * - With no ITN: aftermath words in 2 outlets; for a new story also a span of more than 12 h.
 */
function followUp(c: Candidate, since: number, isNew: boolean, ctx: LifeContext): string | null {
  if (ctx.itn.some((e) => since - e.time > CONFIG.itnFollowUpHours * HOUR && itnMatches(e, c, true) && !aboveBlurb(c, e))) return 'ITN follow-up';
  if (!ctx.itnOk) {
    if (isNew && c.span > CONFIG.maxSpanHoursNoItn) return 'follow-up (no ITN)';
    if (c.family !== 'politics' && c.aftermath >= 2) return 'follow-up (no ITN)';
  }
  return null;
}

/**
 * True when conflict alerts of the country started on 2 or more UTC days of the 7 days before `from`
 * (the day of the first alert of the story, or today). A war that ITN does not list as "Ongoing" is
 * then chronic too. An attack story with a state attacker (`Candidate.war`) records a conflict start.
 */
function recurring(id: string, from: number, starts: string[]): boolean {
  const end = utcDay(from);
  const begin = utcDay(from - CONFIG.historyDays * DAY);
  const days = new Set(
    starts
      .filter((s) => s.startsWith(`${id}|conflict|`))
      .map((s) => s.slice(-8))
      .filter((d) => d >= begin && d < end),
  );
  return days.size >= CONFIG.chronicDays;
}

/**
 * The chronic-war gate of the conflict and attack families. `kind` is null for a story that is not
 * chronic. A chronic story passes (`pass`, at most major) with a large escalation, a big fresh wave, or a
 * new ITN development. For a live alert the ITN development needs the pulse; else it needs a new wave
 * of headlines that `known` does not hold.
 */
function chronicGate(c: Candidate, known: Set<string> | null, from: number, ctx: LifeContext): { kind: string | null; pass: string | null } {
  let kind: string | null = null;
  if ((c.family === 'conflict' || c.family === 'attack') && ctx.chronic.has(c.id)) kind = 'chronic conflict';
  else if (c.war && recurring(c.id, from, ctx.starts)) kind = 'chronic conflict (recurring)';
  if (!kind) return { kind: null, pass: null };
  if (c.tierEff === 3 && c.voices >= CONFIG.chronicOutlets && c.editions >= CONFIG.chronicEditions) return { kind, pass: 'chronic, escalation' };
  if (c.freshVoices >= CONFIG.chronicWaveVoices && c.freshLeads >= CONFIG.chronicWaveLeads && (c.deaths >= CONFIG.chronicWaveDeaths || c.tierEff === 3)) {
    return { kind, pass: 'chronic, fresh wave' };
  }
  const itnNew = ctx.itn.some((e) => ctx.now - e.time <= CONFIG.itnSupportHours * HOUR && itnMatches(e, c, true));
  if (itnNew && (known ? freshWave(c, known) : c.pulse)) return { kind, pass: 'chronic, ITN development' };
  return { kind, pass: null };
}

/**
 * The life of a story. `e` is its live entry of the last run, `x` its ended entry; at most one is set.
 *
 * - A new story: the full test, the chronic gate, the follow-up rules and the pulse. A story whose first
 *   evidence is more than 24 h old also needs a new wave.
 * - A live alert: the chronic gate and the follow-up rules end it. Then it stays while it has the pulse
 *   (in the first 2 h, one voice with a fresh strong headline is enough). After 24 h, a wave needs a renewal:
 *   an escalation, or a new wave while the story is less than 72 h old. A live alert that fails the full
 *   test is held as major.
 * - An ended story alerts again only with the full test, the pulse, and an escalation or a new wave (less
 *   than 72 h after its first alert). It keeps its key and its first evidence.
 */
function lifeOf(c: Candidate, e: HeldAlert | null, x: EndedAlert | null, ctx: LifeContext): Life {
  const { now } = ctx;
  const no = (reason: string, ended = false): Life => ({ level: null, reason, held: false, renewed: false, ended });
  const yes = (level: BreakingLevel | null, reason: string, renewed = false): Life => ({
    level: level ?? 'major', reason, held: !level, renewed, ended: false,
  });
  const cap = CONFIG.storyCapHours * HOUR;

  if (e) {
    const gate = chronicGate(c, null, e.firstAlertAt, ctx);
    if (gate.kind && !gate.pass) return no(`ended: ${gate.kind}`, true);
    const stop = followUp(c, Math.min(e.since, c.since), false, ctx);
    if (stop) return no(`ended: ${stop}`, true);
    if (!c.pulse) {
      const young = now - e.firstAlertAt < CONFIG.holdMinHours * HOUR && c.items.some((i) => i.strong && i.fresh && !i.junk);
      return young ? yes(null, 'held: alert under 2 h old') : no('ended: no fresh lead headline', true);
    }
    const level = gate.pass ? 'major' : c.fullLevel;
    if (now - e.waveAt > CONFIG.waveHours * HOUR) {
      if (escalated(c, e, new Set(e.waveIds), false, ctx)) return yes(level, 'renewed: escalation', true);
      if (now - e.firstAlertAt > cap) return no('ended: story over 72 h', true);
      if (freshWave(c, new Set(e.waveIds))) return yes(level, 'renewed: new wave', true);
      return no('ended: wave over 24 h', true);
    }
    return yes(level, level ? (gate.pass ?? c.fullReason) : 'held: fresh lead');
  }

  if (!c.fullLevel) return no(c.fullReason);
  const known = x ? new Set(x.itemIds) : EMPTY;
  const gate = chronicGate(c, known, x ? x.firstAlertAt : now, ctx);
  if (gate.kind && !gate.pass) return no(gate.kind);
  const stop = followUp(c, x ? Math.min(x.since, c.since) : c.since, !x, ctx);
  if (stop) return no(stop);
  if (!c.pulse) return no('stale: no fresh lead headline');
  const level = gate.pass ? 'major' : c.fullLevel;

  if (!x) {
    if (now - c.since > CONFIG.waveHours * HOUR && !freshWave(c, EMPTY)) return no('stale: older than 24 h, no new wave');
    return yes(level, gate.pass ?? c.fullReason);
  }
  if (escalated(c, x, known, true, ctx)) return yes(level, 'renewed: escalation', true);
  if (now - x.firstAlertAt > cap) return no('ended earlier: story over 72 h');
  if (freshWave(c, known)) return yes(level, 'renewed: new wave', true);
  return no('ended earlier: no new wave');
}

// ---------------------------------------------------------------- the article of the chip

// Front-page outlets of the feed list, and the wires. The list grows with FEEDS.
const TRUSTED = new Set([...FEEDS.flatMap((f) => (f.publisher ? [outletKey(f.publisher)] : [])), 'ap', 'reuters', 'afp']);
// Outlets with a hard paywall: they rank lower, but they can still be the article.
const PAYWALL = new Set(['newyorktimes', 'wallstreetjournal', 'wsj', 'financialtimes', 'ft', 'telegraph', 'times', 'washingtonpost', 'bloomberg', 'australian', 'economist']);
// On a full tie, the order of the feed list decides, so the choice is always the same.
const FEED_RANK = new Map(FEEDS.map((f, i) => [f.id, i]));
const feedRank = (feed: string) => FEED_RANK.get(feed) ?? FEEDS.length;
// Aggregators copy the article of another outlet.
const AGGREGATOR = /\b(?:yahoo|msn|aol|newsbreak|head ?topics|devdiscourse|latestly|big news network|ground news|flipboard|newsnow|inkl)\b/i;
// A video clip is not a written report: "/video/", "/videos/", BBC "/av/", "/watch", or a "Video:" or "Watch:" title.
const VIDEO_URL = /\/(?:video|videos|av)\/|\/watch(?:[/?#]|$)|^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i;
const VIDEO_TITLE = /^(?:video|watch)\s*[:|–—-]/i;

/** True for a live blog, a video clip or an aggregator copy. The pulse and the chip both skip such an item. */
export function isJunk(h: Pick<Headline, 'title' | 'url' | 'publisher'>): boolean {
  return isLive(h.title, h.url) || AGGREGATOR.test(h.publisher) || VIDEO_URL.test(h.url) || VIDEO_TITLE.test(h.title);
}

/**
 * The article of the chip: a good, current representative of the story. The response takes its title,
 * link, publisher and date from this one item only (`articleOf`).
 *
 * 1. Live blogs, video clips and aggregators are out when another item exists (`isJunk`). They are no
 *    fresh lead either, so the pulse and the chip use the same items.
 * 2. The first group that is not empty, in this order: strong items at the agreed tier, then any strong
 *    item, each first placed and fresh, then fresh; then strong items of any age; then the rest the same way.
 *    An aftermath or feature headline is tier 1, so it comes last.
 * 3. The items at most 1.5 h older than the newest item of the group. Of these, the items with the agreed toll.
 * 4. The article of the last run, when it is still one of them, so the chip does not change at each run.
 * 5. Else: a trusted outlet, a direct link (not a Google News redirect), no paywall, the newer, the higher
 *    position, then the order of the feed list.
 */
export function pickArticle(c: Pick<Candidate, 'items' | 'tierEff' | 'deaths'>, prevPickId: string | null): Item {
  const recent = c.items.filter((i) => i.recent);
  const dated = recent.filter((i) => i.time !== null);
  let all = dated.length ? dated : recent.length ? recent : c.items;
  if (all.some((i) => !i.junk)) all = all.filter((i) => !i.junk);
  const top = all.filter((i) => i.c.tier >= Math.max(2, c.tierEff));
  const strong = all.filter((i) => i.strong);
  const lead = (i: Item) => i.placed && i.fresh;
  const fresh = (i: Item) => i.fresh;
  const any = () => true;
  let group: Item[] = [];
  for (const [pool, test] of [
    [top, lead], [strong, lead], [top, fresh], [strong, fresh], [top, any], [strong, any], [all, lead], [all, fresh], [all, any],
  ] as [Item[], (i: Item) => boolean][]) {
    group = pool.filter(test);
    if (group.length) break;
  }
  const times = group.map((i) => i.time).filter((t): t is number => t !== null);
  let near = times.length ? group.filter((i) => i.time !== null && i.time >= Math.max(...times) - CONFIG.pickSlackHours * HOUR) : group;
  if (c.deaths > 0 && near.some((i) => i.c.deaths >= c.deaths)) near = near.filter((i) => i.c.deaths >= c.deaths);
  const sticky = prevPickId ? near.find((i) => i.id === prevPickId) : undefined;
  if (sticky) return sticky;
  // A Google News item links to a news.google.com redirect.
  const direct = (i: Item) => i.h.kind !== 'gn' && !/^https?:\/\/news\.google\.com\//.test(i.h.url);
  return [...near].sort(
    (a, b) =>
      Number(TRUSTED.has(b.outlet)) - Number(TRUSTED.has(a.outlet)) ||
      Number(direct(b)) - Number(direct(a)) ||
      Number(PAYWALL.has(a.outlet)) - Number(PAYWALL.has(b.outlet)) ||
      (b.time ?? 0) - (a.time ?? 0) ||
      a.h.position - b.h.position ||
      feedRank(a.h.feed) - feedRank(b.h.feed) ||
      (a.h.feed < b.h.feed ? -1 : a.h.feed > b.h.feed ? 1 : 0) ||
      (a.h.url < b.h.url ? -1 : a.h.url > b.h.url ? 1 : 0),
  )[0];
}

/** The fields of the response that describe the article of the chip. They all come from one item. */
export function articleOf(i: Item): Pick<BreakingAlert, 'headline' | 'url' | 'source' | 'publishedAt'> {
  return {
    headline: clip(i.h.title, 200),
    url: i.h.url,
    source: i.h.publisher,
    publishedAt: i.time === null ? null : new Date(i.time).toISOString(),
  };
}

/**
 * The id of a new story: country, kind and the UTC day of the first evidence. New outlets join a story
 * with later times, so they do not change the key. The state keeps the key of an alert for the life of
 * the story, also when its first headline leaves the feeds. With no state, the first evidence can move by
 * some hours when its headline leaves a short feed; a day bucket keeps the key through such a move.
 * A business key ends with the subject ("USA-business-20261112-Q182477"), because one country can have
 * two business stories on one day.
 */
export function alertKey(country: string, family: Family, since: number, subject: string | null = null): string {
  const key = `${country}-${family}-${new Date(since).toISOString().slice(0, 10).replace(/-/g, '')}`;
  return family === 'business' && subject ? `${key}-${subject}` : key;
}

/** The subject of a business story: the subject that most strong headlines share, else most headlines. */
function storySubject(story: Story): string | null {
  if (story.family !== 'business') return null;
  const count = new Map<string, number>();
  for (const i of story.items) {
    const s = i.c.subject?.id;
    if (s) count.set(s, (count.get(s) ?? 0) + (i.strong ? 100 : 1));
  }
  return [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
