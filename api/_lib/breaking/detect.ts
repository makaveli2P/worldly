// The breaking-news detector. It is pure: the inputs and `now` decide the output, so saved
// inputs replay as tests.
//
// A country goes on alert only when several independent outlets lead with the same severe event
// there. GDACS and USGS can confirm or raise a news story, but they never start an alert alone.
// Wikipedia "In the news" (ITN) gives the list of chronic wars and a clock for follow-up stories.
import type { BreakingAlert, BreakingLevel, BreakingResponse } from '../../../src/types';
import { AFTERMATH, classify, isLive } from './classify.js';
import { countryWords, ongoingCountries, placeKeys, primaryCountries } from './match.js';
import type { BreakingInputs, Classification, Family, Hazard, HazardType, Headline } from './types.js';

export const CONFIG = {
  windowHours: 12, // only headlines this new count toward the level
  lookbackHours: 48, // older headlines of the same story still set its start time
  maxAgeHours: 24, // an alert ends this long after its first evidence
  fullHours: 6, // a critical alert with no headline newer than this drops to major
  itnFollowUpHours: 36, // a story that starts this long after the day of a matching ITN blurb is a follow-up
  itnSupportHours: 36, // an ITN blurb this new supports the story
  maxSpanHoursNoItn: 12, // with no ITN: a story that spans more hours than this is a follow-up
  maxAlerts: 3,
  gnTopPositions: 12, // a Google News item in these positions leads its edition
  leadPositions: 3, // a front-page item in these positions is a lead
  undatedPositions: 10, // an item with no date counts only in these positions
  syndicationMinLength: 40, // identical titles this long from two outlets are one wire story
  criticalOutlets: 4,
  criticalGateOutlets: 6, // with no ITN or hazard support, critical needs this many outlets
  majorOutlets: 3,
  chronicOutlets: 6,
  chronicEditions: 3,
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

interface Item {
  h: Headline;
  c: Classification;
  ids: string[];
  age: number | null; // hours; null when undated
  time: number | null; // epoch ms
  recent: boolean;
  outlet: string;
  tokens: Set<string>;
  places: Set<string>;
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
      // A place, a death toll or two critical-class headlines join a story only when they are close in
      // time ("Russia invades Estonia" and "Russian forces cross into Estonia"). A 30 h old attack in
      // Mogadishu does not join a new one there.
      const gap = a.time === null || b.time === null ? 0 : Math.abs(a.time - b.time);
      const close = gap <= CONFIG.windowHours * HOUR;
      // Up to 24 h apart, the same place joins only with the same toll or 2 shared words.
      const sameToll = a.c.deaths > 0 && a.c.deaths === b.c.deaths;
      const samePlace = [...a.places].some((p) => b.places.has(p)) &&
        (close || (gap <= CONFIG.maxAgeHours * HOUR && (sameToll || similar(a.tokens, b.tokens, 2))));
      const sameDeaths = sameToll && close;
      const bothCritical = a.c.tier === 3 && b.c.tier === 3 && close;
      // Headlines far apart in time need 2 shared words: "church" alone does not join two shootings a day apart.
      if (samePlace || sameDeaths || bothCritical || similar(a.tokens, b.tokens, close ? 1 : 2)) parent[find(i)] = find(j);
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
    if (Number.isFinite(to) && to < now - CONFIG.maxAgeHours * HOUR) return false;
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
}

function itnEntries(inputs: BreakingInputs): ItnEntry[] {
  const out: ItnEntry[] = [];
  for (const b of inputs.itn?.blurbs ?? []) {
    const c = classify(b.text);
    const time = Date.parse(b.date);
    if (!c || !Number.isFinite(time)) continue;
    const ids = primaryCountries(b.text);
    out.push({ ids, family: c.family, time, tokens: storyTokens(b.text), places: new Map(ids.map((id) => [id, placeKeys(b.text, id)])), deaths: c.deaths });
  }
  return out;
}

/**
 * True when an ITN blurb tells the same story: same country and family, and a shared place, toll or
 * words. `strict` needs 2 shared words: one word ("school") does not make an old blurb the same story.
 */
function itnMatches(e: ItnEntry, story: Story, strict: boolean): boolean {
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
  best: Item;
  basis: BreakingAlert['basis'];
  items: Item[];
}

export interface DetectResult {
  response: BreakingResponse;
  candidates: Candidate[];
}

/** Detects breaking news. See README "Breaking news" for the rules in plain words. */
export function detect(inputs: BreakingInputs): DetectResult {
  const { now } = inputs;
  const groups = new Map<string, { id: string; family: Family; items: Item[] }>();
  for (const h of inputs.headlines) {
    const time = h.publishedAt ? Date.parse(h.publishedAt) : NaN;
    const age = Number.isFinite(time) ? (now - time) / HOUR : null;
    if (age !== null && (age > CONFIG.lookbackHours || age < -1)) continue;
    if (age === null && h.position > CONFIG.undatedPositions) continue;
    const c = classify(h.title);
    if (!c) continue;
    const ids = primaryCountries(h.title);
    const item: Omit<Item, 'places'> = {
      h, c, ids, age, time: age === null ? null : time,
      recent: age === null || age <= CONFIG.windowHours,
      outlet: outletKey(h.publisher),
      tokens: storyTokens(h.title),
    };
    for (const id of ids) {
      const key = `${id}|${c.family}`;
      if (!groups.has(key)) groups.set(key, { id, family: c.family, items: [] });
      groups.get(key)!.items.push({ ...item, places: placeKeys(h.title, id) });
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
    const byVoice = voices(recent);
    const voiceTier = [...byVoice.values()].map((its) => Math.max(...its.map((i) => i.c.tier)));
    const voiceDeaths = [...byVoice.values()].map((its) => Math.max(...its.map((i) => i.c.deaths)));
    let tierEff = second(voiceTier);
    const deaths = second(voiceDeaths);
    const nVoices = byVoice.size;
    const editions = new Set(recent.filter((i) => i.h.kind === 'gn' && i.h.position <= CONFIG.gnTopPositions).map((i) => i.h.edition)).size;
    const lead = new Set(recent.filter((i) => i.h.kind === 'front' && i.h.position <= CONFIG.leadPositions).map((i) => i.outlet)).size;
    const live = recent.some((i) => isLive(i.h.title, i.h.url));
    const times = story.items.map((i) => i.time).filter((t): t is number => t !== null);
    const recentTimes = recent.map((i) => i.time).filter((t): t is number => t !== null);
    const since = times.length ? Math.min(...times) : now;
    const updatedAt = recentTimes.length ? Math.max(...recentTimes) : now;
    const newestAge = (now - updatedAt) / HOUR;

    const hazards = matchingHazards(story, inputs.hazards, now);
    const red = hazards.some((z) => z.level === 'red');
    const itnSupport = itn.some((e) => now - e.time <= CONFIG.itnSupportHours * HOUR && itnMatches(e, story, false));
    // A red GDACS or PAGER level raises a deadly disaster story to critical-class.
    if (red && tierEff >= 2) tierEff = 3;
    const position = editions >= 1 || lead >= 1;

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
    } else if (tierEff >= 2 && nVoices >= CONFIG.majorOutlets && position) {
      level = 'major';
      reason = 'major';
    } else if (tierEff >= 2 && nVoices >= 2 && position && hazards.length) {
      level = 'major';
      reason = 'major, hazard-confirmed';
    }
    if (level && chronic.has(story.id) && (story.family === 'conflict' || story.family === 'attack')) {
      // An ongoing war leads the news every day. Only a large escalation counts, and only as major.
      const escalation = tierEff === 3 && nVoices >= CONFIG.chronicOutlets && editions >= CONFIG.chronicEditions;
      level = escalation ? 'major' : null;
      reason = escalation ? 'chronic, escalation' : 'chronic conflict';
    }
    if (level === 'critical' && newestAge > CONFIG.fullHours) {
      level = 'major';
      reason = 'critical, no fresh headline';
    }
    // Follow-ups: an old story, a story that ITN reported days ago, or (with no ITN) a long or aftermath story.
    if (level && now - since > CONFIG.maxAgeHours * HOUR) {
      level = null;
      reason = 'older than 24 h';
    }
    // An ITN date is the UTC day of the event, with no time. The story is a follow-up only when its
    // first evidence comes more than 36 h after the start of that day (12 h after its end).
    if (level && itn.some((e) => since - e.time > CONFIG.itnFollowUpHours * HOUR && itnMatches(e, story, true))) {
      level = null;
      reason = 'ITN follow-up';
    }
    if (level && !itnOk) {
      const span = times.length ? (Math.max(...times) - since) / HOUR : 0;
      const aftermath = new Set(recent.filter((i) => AFTERMATH.test(i.h.title)).map((i) => i.outlet)).size;
      if (span > CONFIG.maxSpanHoursNoItn || (story.family !== 'politics' && aftermath >= 2)) {
        level = null;
        reason = 'follow-up (no ITN)';
      }
    }

    // The headline: a front-page item at the agreed tier, near the top, before a Google News redirect.
    const best = [...recent].sort(
      (a, b) =>
        Number(b.c.tier >= tierEff) - Number(a.c.tier >= tierEff) ||
        Number(b.h.kind === 'front') - Number(a.h.kind === 'front') ||
        Number(!/news\.google\.com/.test(b.h.url)) - Number(!/news\.google\.com/.test(a.h.url)) ||
        a.h.position - b.h.position,
    )[0];
    const basis: BreakingAlert['basis'] = ['news'];
    if (hazards.some((z) => z.source === 'gdacs')) basis.push('gdacs');
    if (hazards.some((z) => z.source === 'usgs')) basis.push('usgs');
    if (itnSupport) basis.push('itn');
    const score = nVoices + 2 * editions + lead + 3 * tierEff + 2 * Math.log10(deaths + 1) + (live ? 1 : 0);
    candidates.push({ id: story.id, family: story.family, level, reason, score, voices: nVoices, editions, lead, tierEff, deaths, since, updatedAt, best, basis, items: story.items });
  }

  // One alert per country: the best candidate.
  const rank = (c: Candidate) => (c.level ? LEVEL_RANK[c.level] : 0);
  const byCountry = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!c.level) continue;
    const prev = byCountry.get(c.id);
    if (!prev || rank(c) > rank(prev) || (rank(c) === rank(prev) && c.score > prev.score)) byCountry.set(c.id, c);
  }
  const alerts = [...byCountry.values()]
    .sort((a, b) => rank(b) - rank(a) || b.score - a.score)
    .slice(0, CONFIG.maxAlerts)
    .map((c): BreakingAlert => ({
      key: alertKey(c.id, c.family, c.since),
      country: c.id,
      level: c.level!,
      kind: c.family,
      headline: clip(c.best.h.title, 200),
      url: c.best.h.url,
      source: c.best.h.publisher,
      since: new Date(c.since).toISOString(),
      updatedAt: new Date(Math.max(c.updatedAt, c.since)).toISOString(),
      outlets: c.voices,
      basis: c.basis,
    }));

  return {
    response: { alerts, generatedAt: new Date(now).toISOString(), sources: inputs.sources },
    candidates: candidates.sort((a, b) => rank(b) - rank(a) || b.score - a.score),
  };
}

/**
 * A stable id: country, kind and the UTC day of the first evidence. New outlets join a story with
 * later times, so they do not change the key. The first evidence can move by some hours when its
 * headline leaves a short feed; a day bucket keeps the key through such a move, and an alert lasts
 * at most 24 h, so one key rarely holds two stories.
 */
export function alertKey(country: string, family: Family, since: number): string {
  return `${country}-${family}-${new Date(since).toISOString().slice(0, 10).replace(/-/g, '')}`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
