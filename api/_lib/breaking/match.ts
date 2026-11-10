// Finds the countries that a headline names, and the country where the event happens.
//
// The matcher is one case-sensitive regex over all aliases (names, demonyms, places, leaders),
// longest alias first, with Unicode word boundaries. So "Woman" does not name Oman, "Indiana"
// does not name India, "Chadwick" does not name Chad and "Papua New Guinea" is not Guinea.
// Trap rules then remove the common false matches (Georgia the US state, Turkey the bird,
// "Jordan Davis" the person).
import aliasData from './aliases.json' with { type: 'json' };

export type AliasKind = 'name' | 'demonym' | 'place' | 'leader' | 'surname';

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

export interface CountryMatch {
  id: string;
  text: string;
  kind: AliasKind;
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
  const raw = [...title.matchAll(ALIAS_RE)];
  const starts = new Set(raw.filter((m) => OWNER.get(m[1])?.id).map((m) => m.index ?? 0));
  for (const m of raw) {
    const text = m[1];
    const index = m.index ?? 0;
    const owner = OWNER.get(text);
    if (!owner?.id || owner.kind === 'block') continue;
    const id = owner.id;
    const kind = owner.kind;
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
      if (kind === 'place') locus += 1;
    }
    // A demonym before a strike word is the attacker: almost no weight, no scene bonus.
    if (kind === 'demonym' && ATTACKER_AFTER.test(after)) {
      weight = Math.min(weight, 0.1);
      locus = 0;
    }
    out.push({ id, text, kind, index, end: index + text.length, weight, locus });
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
  const colon = title.indexOf(':');
  if (colon > 0 && colon < 30 && title.slice(0, colon).split(/\s+/).length <= 3) {
    const labelText = title.slice(0, colon);
    const label = out.filter((m) => m.index < colon && m.weight > 0.25);
    const rest = out.filter((m) => m.index > colon);
    const eventLabel = LABEL_EVENT.test(labelText);
    if (label.length && !eventLabel && rest.some((m) => (m.kind === 'name' || m.kind === 'place') && m.weight >= 0.5)) {
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

/** Folded texts of the sub-national places of one country in a title ("krakow"). */
export function placeKeys(title: string, id: string): Set<string> {
  return new Set(matchCountries(title).filter((m) => m.kind === 'place' && m.id === id).map((m) => fold(m.text)));
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
