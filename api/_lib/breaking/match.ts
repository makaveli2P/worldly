// Finds the countries that a headline names, and the country where the event happens.
//
// The matcher is one case-sensitive regex over all aliases (names, demonyms, places, leaders),
// longest alias first, with Unicode word boundaries. So "Woman" does not name Oman, "Indiana"
// does not name India, "Chadwick" does not name Chad and "Papua New Guinea" is not Guinea.
// Trap rules then remove the common false matches (Georgia the US state, Turkey the bird,
// "Jordan Davis" the person).
//
// A second pass looks up the capitalised words in a gazetteer of cities, districts and regions
// (places.json, from GeoNames). It finds the places that the curated aliases do not have ("Brooklyn",
// "Flatbush", "Zamfara"). Context rules keep it accurate: a place that is also a word or a person name
// counts only after "in" or "near", and a place right after a given name is part of a person name.
import aliasData from './aliases.json' with { type: 'json' };
import placeData from './places.json' with { type: 'json' };

export type AliasKind = 'name' | 'demonym' | 'place' | 'leader' | 'surname';
/** 'alias': the curated table (aliases.json). 'gazetteer': the place gazetteer (places.json). */
export type MatchSource = 'alias' | 'gazetteer';
/** major: counts alone, also in Title Case. place: counts alone. context: counts only after "in", "near" and similar words. */
export type PlaceClass = 'major' | 'place' | 'context';

interface PlaceData {
  given: string[];
  places: Record<string, Record<PlaceClass, string[]>>;
}

interface CountryAliases {
  names: string[];
  demonyms: string[];
  places: string[];
  leaders: { name: string; surname: string | null }[];
}

export const ALIASES = aliasData as Record<string, CountryAliases>;

// Phrases that hold a country word but do not name the country. They are longer than the
// country alias inside them, so the regex takes them first and the matcher drops them.
const BLOCK_PHRASES = [
  'Gulf of Mexico', 'Prince of Wales', 'Princess of Wales', 'Indian Ocean', 'Indian Wells', 'Indian Premier League',
  'Indian Express', 'American Indian', 'Native American', 'Latin American', 'South American', 'Central American',
  'North American', 'African American', 'Asian American', 'Latin America', 'South America', 'Central America',
  'North America', 'Bank of America', 'Captain America', 'Miss America', 'Voice of America', 'Good Morning America',
  'American Airlines', 'American Express', 'Gulf of Guinea', 'New Guinea', 'South China Sea', 'East China Sea',
  'South China Morning Post', 'Georgia Tech', 'Georgia State', 'Jordan Valley', 'New England', 'Turkish Airlines',
  'Dominican Sisters', 'West Indies', 'Lebanon County', 'Peru State', 'Washington Post', 'New York Times',
  'Times of India', 'Hindustan Times', 'Times of Israel', 'Korea Herald', 'Korea Times', 'Japan Times', 'China Daily',
  'Jerusalem Post', 'Kyiv Independent', 'Kyiv Post', 'Moscow Times', 'Tehran Times', 'Bangkok Post', 'Jakarta Post',
  'Arab News', 'Irish Times', 'Sydney Morning Herald', 'Paris Saint-Germain', 'Paris Hilton', 'Real Madrid',
  'England cricket', 'US Open', 'U.S. Open', 'French Open', 'Australian Open', 'Gulf of Oman', 'Sea of Japan',
  'Irish Sea', 'Chinese New Year', 'French Polynesian', 'Guinea pig', 'Guinea pigs',
];

// Names that are more often something else. They count only with country context.
const NEEDS_CONTEXT: Record<string, RegExp> = {
  GEO: /\b(?:Tbilisi|Georgian(?! Bay)|Georgian Dream|Kobakhidze|Kavelashvili|Caucasus|Black Sea|Abkhazia|South Ossetia|Georgia's (?:president|prime minister|PM|parliament|government|ruling)|(?:Russia|Moscow|Armenia|Azerbaijan|EU)\b.*\bGeorgia|Georgia\b.*\b(?:Russia|Moscow|Armenia|Azerbaijan|EU))\b/,
  JEY: /\b(?:Channel Islands?|St Helier|Saint Helier|Jersey's (?:government|chief minister)|States of Jersey|Bailiwick)\b/,
};
const GEORGIA_US = /\b(?:Atlanta|Savannah|Bulldogs|GA|Georgia Tech|Kemp|UGA|Braves|Falcons|Hawks|Senate race|governor|county|County|Ossoff|Warnock|Raffensperger|Fulton)\b/;
const TURKEY_FOOD = /\bTurkey\s+(?:Day|dinner|Dinner|prices?|Prices?|recipes?|Recipes?|shortage|farm|leg|breast|sandwich|trot|Trot|pardon|Pardon|hunt|bird|Bird)\b|\b(?:Thanksgiving|roast|wild|Wild|cold)\s+[Tt]urkey\b/;
// Country names that are also given names: "Jordan Davis", "Chad Smith", "India Hicks".
const GIVEN_NAME_COUNTRIES = new Set(['Jordan', 'Chad', 'India', 'Israel', 'Kenya', 'Jamaica', 'Georgia']);
// Words before a place that make it the scene of the event.
const LOCATIVE = /(?:\b(?:in|across|near|off|into|over|on|at|hits?|struck|strikes?|rocks?|jolts?|batters?|pounds?|lashes|invades?|invade|invaded|invading|attacks?|invasion of|attack on|war on|parts of)\s+(?:the\s+)?(?:(?:southern|northern|eastern|western|central|south|north|east|west|northeast|northwest|southeast|southwest)(?:ern)?\s+)?)$/i;
// A country before these words is the attacker, not the scene: "killed in Israeli strikes on Lebanon",
// "Russian missile strike on Kyiv", "US-Israeli attack". The attacker gets almost no weight.
const ATTACKER_AFTER = /^(?:-(?:led|backed))?(?:\s+(?:coalition|air|drone|missile|rocket|military|naval|joint|retaliatory|new|fresh|overnight|deadly|ballistic|cruise|artillery|tank))*\s+(?:air ?strikes?|strikes?|attacks?|missiles?|drones?|rockets?|shelling|shells|bombardments?|bombings?|bombs|raids?|jets|warplanes|artillery|incursions?|assaults?|offensive|fire)\b/i;
// Armed forces of a country are often on their own soil ("Malian soldiers seize power"), so these
// words keep the weight and only remove the scene bonus: "killed by Israeli forces in Gaza".
const FORCES_AFTER = /^(?:-(?:led|backed))?\s+(?:forces|troops|army|soldiers|military|navy|police|security forces)\b/i;
// Two countries joined into one attacker: "US-Israeli", "U.S.-Israeli", "US Israel", "US and Israeli".
const JOINED = /^(?:\s*[-–/]\s*|\s+and\s+|\s+)$/i;
// "London-bound", "Iran-backed", "Saudi-led", "Dubai-based": the country is not the scene.
const NOT_SCENE_AFTER = /^-(?:bound|based|backed|led|born|headquartered|registered|flagged|listed|made|linked|funded|allied|aligned|owned)\b/i;
// "53 dead on London flight": the destination of a flight is not the scene.
const VEHICLE_BEFORE = /\b(?:on|aboard|onto|from)\s+(?:a\s+|the\s+)?$/i;
const VEHICLE_AFTER = /^\s+(?:flights?|planes?|jets?|airliners?)\b/i;
// A short label before a colon that names an event there: "Gabon coup:", "Ukraine war:".
const LABEL_EVENT = /\b(?:coup|crisis|war|conflict|earthquake|quake|floods?|attacks?|crash|elections?|protests?|unrest|shooting|blast|explosion|fire|storm|cyclone|hurricane|typhoon|tsunami|landslide|violence|clashes|strikes?)\b/i;
// "DC" names Washington only before these words ("DC plane crash"), not "DC Comics" or "AC/DC".
const DC_CONTEXT = /^\s+(?:plane|air|midair|mid-air|crash|shooting|collision|helicopter|police|area)\b/i;
// A demonym before these words places the people, not the event: "Indian nationals killed in Kuwait".
const DIASPORA_AFTER = /^(?:-(?:origin|born|American|British|Canadian|Australian)|\s+(?:nationals?|citizens?|tourists?|students?|workers?|migrants?|journalists?|hostages?|pilgrims?|expats?|diaspora|crew|sailors?|embassy|envoy|ambassador|consulate|soldiers? (?:in|abroad))\b)/i;

interface Owner {
  id: string | null; // null: a block phrase
  kind: AliasKind | 'block';
}

const OWNER = new Map<string, Owner>();
const ascii = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
function own(text: string, id: string | null, kind: AliasKind | 'block'): void {
  // The first owner wins, but a block phrase always wins, and a name wins over a weaker kind.
  const prev = OWNER.get(text);
  if (prev && kind !== 'block' && !(kind === 'name' && prev.kind !== 'name' && prev.kind !== 'block')) return;
  OWNER.set(text, { id, kind });
}
for (const [id, a] of Object.entries(ALIASES)) {
  for (const n of a.names) own(n, id, 'name');
  for (const n of a.demonyms) own(n, id, 'demonym');
  for (const n of a.places) own(n, id, 'place');
  // Headlines often drop accents ("Pena" for "Peña"), so a leader name also matches without them.
  for (const l of a.leaders) {
    for (const name of new Set([l.name, ascii(l.name)])) own(name, id, 'leader');
    if (l.surname) for (const name of new Set([l.surname, ascii(l.surname)])) own(name, id, 'surname');
  }
}
for (const p of BLOCK_PHRASES) own(p, null, 'block');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[...OWNER.keys()].sort((x, y) => y.length - x.length).map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

// ---- the place gazetteer (places.json)

/** The first word of a form or of a text: up to a space, an apostrophe, a full stop or a hyphen. */
const firstWord = (s: string) => /^[^\s'’.-]+/u.exec(s)?.[0] ?? '';
const PLACES = placeData as unknown as PlaceData;
const GAZ = new Map<string, { id: string; cls: PlaceClass }>();
for (const [id, p] of Object.entries(PLACES.places)) {
  for (const cls of ['major', 'place', 'context'] as const) for (const f of p[cls]) if (!OWNER.has(f)) GAZ.set(f, { id, cls });
}
const GIVEN = new Set(PLACES.given);
// First word -> the gazetteer forms that start with it, longest first.
const GAZ_FIRST = new Map<string, string[]>();
// First word -> the alias and gazetteer forms of a country that start with it ("Alabama" for "Mobile, Alabama").
const ANY_FIRST = new Map<string, { text: string; id: string }[]>();
function addTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
for (const f of GAZ.keys()) addTo(GAZ_FIRST, firstWord(f), f);
for (const list of GAZ_FIRST.values()) list.sort((a, b) => b.length - a.length);
for (const [text, o] of OWNER) if (o.id) addTo(ANY_FIRST, firstWord(text), { text, id: o.id });
for (const [text, g] of GAZ) addTo(ANY_FIRST, firstWord(text), { text, id: g.id });

/** A capitalised word: the start of a gazetteer lookup. */
const CAP_WORD = /(?<![\p{L}\p{N}'’-])\p{Lu}[\p{L}\p{M}'’.]*/gu;
// A word after the place that makes the place a part of a name of a landmark: "Brooklyn Bridge".
const LANDMARK = /^\s+(?:Bridge|Bay|Park|Street|Avenue|Road|Airport|Station|Square|Mall|Market|Hospital|University|Port|Harbour|Harbor|Beach|River|Lake|City|County|Province|District|Region|State|Mosque|Temple|Church|Cathedral|Palace|Prison|Tower|Dam|Highway|Expressway|Metro|Subway|Valley|Mountains?|Hills?|Island|Islands)\b/;
// Strong locative words. The prepositions match in either case ("In Brooklyn" in a Title Case title).
// The verbs match in lower case only, so the Title Case "Strike Deal" is no locative.
// "at" and "on" are not strong: "at Paramount+", "on Austin Reaves".
const STRONG_LOC = /(?:\b(?:[Ii]n|IN|[Nn]ear|[Aa]cross|[Oo]utside|[Oo]ff)|\b(?:hits?|struck|strikes?|rocks?|jolts?|batters?|lashes|pounds?))\s+(?:the\s+)?(?:(?:southern|northern|eastern|western|central|south|north|east|west|northeast|northwest|southeast|southwest|downtown|rural)\s+)?$/;
// "straits of Malacca", "Gulf of Finland": a sea or a cape, not the town.
const WATER_BEFORE = /\b(?:Straits?|Gulf|Sea|Bay|Lake|Cape|Mount|Isle|Bank|Port) of\s+$/i;
// The next word is capitalised ("Brixton Academy") or is "of".
const NEXT_CAP = /^\s+(?:of\b|\p{Lu})/u;
const PREV_WORD = /(\p{Lu}[\p{L}'’-]*)\s+$/u;
// The text after a single-word place in a Title Case title, when the place ends the phrase.
const PHRASE_END = /^(?:\s*$|\s*[:,;!?–—|]|['’]s\b)/;

interface GazHit {
  text: string;
  index: number;
  id: string;
}

/** True when the text starts with an alias or a gazetteer form of the country. */
function startsWithPlaceOf(text: string, id: string): boolean {
  return (ANY_FIRST.get(firstWord(text)) ?? []).some(
    (o) => o.id === id && text.startsWith(o.text) && !/^[\p{L}\p{N}]/u.test(text.slice(o.text.length)),
  );
}

/**
 * The gazetteer places in a title that no alias match covers, with the context rules applied.
 * `taken` holds the spans of the alias matches. The function adds the span of each place that it looks at.
 */
function gazetteerMatches(title: string, taken: [number, number][], titleCase: boolean): GazHit[] {
  const out: GazHit[] = [];
  for (const m of title.matchAll(CAP_WORD)) {
    const i = m.index ?? 0;
    if (taken.some(([a, b]) => i >= a && i < b)) continue;
    for (const f of GAZ_FIRST.get(firstWord(m[0])) ?? []) {
      if (!title.startsWith(f, i)) continue;
      const end = i + f.length;
      const after = title.slice(end);
      // "Brooklyn-based", "Shibuya-style": the place is part of a longer word.
      if (/^[\p{L}\p{N}]|^-\p{L}/u.test(after)) continue;
      const g = GAZ.get(f)!;
      const before = title.slice(0, i);
      const loc = STRONG_LOC.test(before) || (LOCATIVE.test(before) && !/\b\p{Lu}\p{Ll}+\s+$/u.test(before) && g.cls !== 'context');
      // "Mobile, Alabama": the words after a comma name a place of the same country.
      const comma = /^,\s*/.exec(after);
      const qualified = !!comma && startsWithPlaceOf(after.slice(comma[0].length), g.id);
      const nextCap = NEXT_CAP.test(after) && !LANDMARK.test(after);
      const prev = PREV_WORD.exec(before)?.[1];
      const ok =
        !WATER_BEFORE.test(before) &&
        // "Lewis Hamilton", "Charles Darwin": a given name before the place makes a person name.
        !(prev && GIVEN.has(prev)) &&
        // "Austin Butler", "Nice weather": a word or a person name needs "in X" or "X, <same country>".
        !(g.cls === 'context' && !(qualified || (loc && !nextCap))) &&
        // "Ariana Grande", "Brooklyn Nets" in a Title Case title: one word needs a locative or the end of the phrase.
        !(titleCase && !loc && !qualified && !f.includes(' ') && !PHRASE_END.test(after)) &&
        // "Brixton Academy": a capitalised word after the place makes a name.
        !(!titleCase && !loc && !qualified && nextCap) &&
        // "Sanya Vats", "Tyler Robinson": a capitalised word before the place (not the first word) makes a name.
        !(!titleCase && !loc && prev && before.trim() !== prev && !/[.:!?‘'"“]\s*\S+\s+$/.test(before));
      if (ok) out.push({ text: f, index: i, id: g.id });
      // The first form that fits takes the words, also when a rule rejects it.
      taken.push([i, end]);
      break;
    }
  }
  return out;
}

/** The gazetteer entry of a form, or undefined. For tests and tools. */
export function gazetteerEntry(form: string): { id: string; cls: PlaceClass } | undefined {
  return GAZ.get(form);
}

export interface CountryMatch {
  id: string;
  text: string;
  kind: AliasKind;
  source: MatchSource;
  index: number;
  end: number;
  weight: number; // how sure the match names the country (0 to 1)
  locus: number; // extra score when the text puts the event there
}

/** "Some Words In Title Case" (the NYT style). A given name cannot be told from a country there. */
export function isTitleCase(title: string): boolean {
  const words = title.split(/\s+/).filter((x) => /^\p{L}{4,}/u.test(x));
  return words.length >= 3 && words.filter((x) => /^\p{Lu}/u.test(x)).length / words.length >= 0.7;
}

function isAllCaps(title: string): boolean {
  const letters = title.replace(/[^\p{L}]/gu, '');
  return letters.length > 10 && letters === letters.toUpperCase();
}

/** Returns the country matches in a title, in order, with the trap rules applied. */
export function matchCountries(title: string): CountryMatch[] {
  const out: CountryMatch[] = [];
  const titleCase = isTitleCase(title);
  const raw: { text: string; index: number; gaz?: GazHit }[] = [...title.matchAll(ALIAS_RE)].map((m) => ({ text: m[1], index: m.index ?? 0 }));
  const taken: [number, number][] = raw.map((m) => [m.index, m.index + m.text.length]);
  for (const g of gazetteerMatches(title, taken, titleCase)) raw.push({ text: g.text, index: g.index, gaz: g });
  raw.sort((a, b) => a.index - b.index);
  const starts = new Set(raw.filter((m) => m.gaz || OWNER.get(m.text)?.id).map((m) => m.index));
  for (const m of raw) {
    const { text, index } = m;
    const owner = m.gaz ? { id: m.gaz.id, kind: 'place' as const } : OWNER.get(text);
    if (!owner?.id || owner.kind === 'block') continue;
    const id = owner.id;
    const kind = owner.kind;
    const source: MatchSource = m.gaz ? 'gazetteer' : 'alias';
    const before = title.slice(0, index);
    const after = title.slice(index + text.length);
    if (text === 'US' && isAllCaps(title)) continue; // "LET US" in a shouted title
    if (text === 'DC' && !DC_CONTEXT.test(after)) continue;
    if (id === 'GEO' && (GEORGIA_US.test(title) || !NEEDS_CONTEXT.GEO.test(title))) continue;
    if (id === 'JEY' && !NEEDS_CONTEXT.JEY.test(title)) continue;
    if (text === 'Turkey' && TURKEY_FOOD.test(title)) continue;
    // "Jordan Davis", "Chad Smith": a given name and a capitalised surname, in a sentence-case title.
    // "India Pakistan war": the next word is a country, so this is no given name.
    const next = /^\s+(?=\p{Lu}\p{Ll}+)/u.exec(after);
    if (
      GIVEN_NAME_COUNTRIES.has(text) && !titleCase && next && !starts.has(index + text.length + next[0].length) &&
      !/^\s+(?:Valley|River|Sea|Strip|State|Basin)\b/.test(after)
    ) {
      continue;
    }

    let weight = kind === 'leader' || kind === 'surname' ? 0.5 : 1;
    if (kind === 'demonym' && DIASPORA_AFTER.test(after)) weight = 0;
    if (NOT_SCENE_AFTER.test(after) || (VEHICLE_BEFORE.test(before) && VEHICLE_AFTER.test(after))) weight = 0;
    if (titleCase && GIVEN_NAME_COUNTRIES.has(text)) weight = Math.min(weight, 0.5);
    let locus = 0;
    if (weight > 0.25) {
      if (LOCATIVE.test(before) && !(kind === 'demonym' && FORCES_AFTER.test(after))) locus += 2;
      // A curated place names the country with no doubt. A gazetteer place gets no such bonus, so a
      // curated name or dateline wins over it ("Scotland: ... Hampden victory").
      if (kind === 'place' && source === 'alias') locus += 1;
    }
    // A demonym before a strike word is the attacker: almost no weight, no scene bonus.
    if (kind === 'demonym' && ATTACKER_AFTER.test(after)) {
      weight = Math.min(weight, 0.1);
      locus = 0;
    }
    out.push({ id, text, kind, source, index, end: index + text.length, weight, locus });
  }
  // Joined attackers ("US-Israeli strikes", "US Israel Strike"): a country right before an attacker
  // is an attacker too. A name alone before a strike word stays the scene ("Pakistan attack kills 30").
  for (let i = out.length - 2; i >= 0; i--) {
    const a = out[i];
    const b = out[i + 1];
    const tail = title.slice(b.end);
    const gap = title.slice(a.end, b.index);
    const bAttacker = (b.weight <= 0.1 && b.kind === 'demonym') || (b.weight > 0 && b.kind === 'name' && ATTACKER_AFTER.test(tail));
    // A plain space joins two names only ("US Israel Strike"), not "Lebanon Israeli strikes".
    const joined = JOINED.test(gap) && (/\S/.test(gap) || (a.kind === 'name' && b.kind === 'name'));
    if (a.id !== b.id && a.kind !== 'place' && joined && bAttacker) {
      a.weight = Math.min(a.weight, 0.1);
      a.locus = 0;
      if (b.kind !== 'demonym') {
        b.weight = Math.min(b.weight, 0.1);
        b.locus = 0;
      }
    }
  }
  // A country after the first clause break ("Turkey quake kills 50, shaking felt in Greece") is
  // a side note: it keeps half its weight and gets no scene bonus. A comma before a country
  // ("France, Germany and Italy", "Kraków, Poland") continues a list and is no clause break.
  const clause = [...title.matchAll(/[,;]\s+/g)].find((c) => !out.some((m) => m.index === (c.index ?? 0) + c[0].length))?.index ?? -1;
  if (clause > 0) {
    for (const m of out) {
      if (m.index > clause) {
        m.weight = Math.min(m.weight, 0.5);
        m.locus = 0;
      }
    }
  }
  // A short label before a colon is a dateline: "Kyiv: Russian missile strike kills 30", "Gaza: ...".
  // The label is no scene when it names no event and the text after the colon names a country or
  // place ("Jerusalem Daily: Heavy rains flood Gaza"). An attacker demonym after the colon is not enough.
  // An event label ("Burkina Faso coup: Ousted ruler in Togo") names the scene; the rest is a side note.
  // A gazetteer place after the colon does not demote the label ("Scotland: ... Hampden victory").
  const colon = title.indexOf(':');
  if (colon > 0 && colon < 30 && title.slice(0, colon).split(/\s+/).length <= 3) {
    const labelText = title.slice(0, colon);
    const label = out.filter((m) => m.index < colon && m.weight > 0.25);
    const rest = out.filter((m) => m.index > colon);
    const eventLabel = LABEL_EVENT.test(labelText);
    if (label.length && !eventLabel && rest.some((m) => m.source === 'alias' && (m.kind === 'name' || m.kind === 'place') && m.weight >= 0.5)) {
      for (const m of label) {
        m.weight = Math.min(m.weight, 0.25);
        m.locus = 0;
      }
    } else if (label.length) {
      for (const m of label) m.locus += 1;
      if (eventLabel) for (const m of rest) m.locus = 0;
    }
  }
  // "Paris, Texas", "Lebanon, Pennsylvania": a place of another country right after a comma
  // qualifies the first name, so the first name is not the country.
  for (let i = 0; i + 1 < out.length; i++) {
    const a = out[i];
    const b = out[i + 1];
    if (b.kind === 'place' && b.id !== a.id && /^,\s*$/.test(title.slice(a.end, b.index))) {
      a.weight = 0;
      a.locus = 0;
    }
  }
  return out;
}

/**
 * The countries that a title names as an armed attacker: a demonym before a strike or forces word
 * ("Israeli attack on Gaza", "Russian troops"), or a country joined to such an attacker ("US-Israeli strikes").
 */
export function attackerCountries(title: string): Set<string> {
  const ids = new Set<string>();
  for (const m of matchCountries(title)) {
    const after = title.slice(m.end);
    if (m.kind === 'demonym' && (ATTACKER_AFTER.test(after) || FORCES_AFTER.test(after))) ids.add(m.id);
    else if (m.source === 'alias' && m.weight > 0 && m.weight <= 0.1 && m.kind === 'name') ids.add(m.id);
  }
  return ids;
}

/** True when the text names at least one country. */
export function namesAnyCountry(text: string): boolean {
  return matchCountries(text).some((m) => m.weight > 0);
}

/**
 * Removes "..., officials say" and "X says ..." so the speaker is not taken for the scene.
 * It keeps the full title when the rest would name no country ("Gabon army officers say they seized power").
 */
export function stripAttribution(title: string): string {
  let t = title;
  // "..., Trump confirms", "... as Israel says four soldiers killed": a second speaker clause.
  const tail = t.replace(/(?:\s*[,:]\s*|\s+[–—-]\s+|\s+as\s+(?=[^,:–—]*\b(?:says?|said)\b))[^,:–—]*\b(?:says?|said|reports?|claims?|tells|according to|announces?|confirms?)\b[^,:–—]*$/i, '');
  if (tail !== t && tail.trim() && namesAnyCountry(tail)) t = tail;
  // "Lebanon says Israeli strikes kill 47": when the rest names a country only as an attacker,
  // the speaker is the scene, so the speaker stays.
  const head = t.replace(/^[^:]{0,60}?\b(?:says?|said|claims?)\b\s*:?\s*/i, '');
  if (head !== t && head.trim() && namesScene(head)) t = head;
  return t;
}

/** True when the text names a country with half weight or more (not only as an attacker or a label). */
function namesScene(text: string): boolean {
  return matchCountries(text).some((m) => m.weight >= 0.5);
}

/**
 * The scene of the event: one country, or two on an exact tie (a war between two).
 * Three or more countries on a tie name no scene, so a story about many countries flags none.
 */
export function primaryCountries(title: string): string[] {
  const matches = matchCountries(stripAttribution(title));
  const score = new Map<string, number>();
  for (const m of matches) score.set(m.id, (score.get(m.id) ?? 0) + m.weight + m.locus);
  // A section label (0.25) alone is no scene. A leader name (0.5) alone is: "Putin dies".
  const ranked = [...score].filter(([, s]) => s > 0.25).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return [];
  const top = ranked.filter(([, s]) => s === ranked[0][1]);
  if (top.length >= 3) return [];
  return top.map(([id]) => id);
}

const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// Forms of one place from the curated aliases and the gazetteer that must give one key, so that the
// headlines of one event join one story. Bare "Washington" in a headline is the capital (the state is
// "Washington state").
const CANONICAL_PLACE: Record<string, string> = {
  'washington': 'washington dc',
  'washington d.c.': 'washington dc',
  'washington, d.c.': 'washington dc',
  'washington, dc': 'washington dc',
  'd.c.': 'washington dc',
  'dc': 'washington dc',
  'new york city': 'new york',
  'nyc': 'new york',
};

/** Folded texts of the sub-national places of one country in a title ("krakow"), one key for each place. */
export function placeKeys(title: string, id: string): Set<string> {
  return new Set(
    matchCountries(title)
      .filter((m) => m.kind === 'place' && m.id === id)
      .map((m) => {
        const key = fold(m.text);
        if (key === 'washington' && /^\s+state\b/i.test(title.slice(m.end))) return 'washington state';
        return CANONICAL_PLACE[key] ?? key;
      }),
  );
}

/** The folded words of all country aliases in a title ("russia", "estonia", "tel", "aviv"). */
export function countryWords(title: string): Set<string> {
  const words = new Set<string>();
  for (const m of matchCountries(title)) for (const w of fold(m.text).split(/[^\p{L}\p{N}]+/u)) if (w) words.add(w);
  return words;
}

/** Countries named by the Wikipedia "Ongoing" list ("Russo-Ukrainian war" -> RUS, UKR). */
export function ongoingCountries(entries: string[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    const text = entry
      .replace(/Russo-Ukrainian/g, 'Russia Ukraine')
      .replace(/Israeli–Palestinian|Israeli-Palestinian|Gaza war/g, 'Gaza Israel')
      .replace(/Sudanese civil war/gi, 'Sudan war')
      .replace(/Myanmar civil war/gi, 'Myanmar war');
    for (const m of matchCountries(text)) if (m.weight > 0) ids.add(m.id);
  }
  return ids;
}
