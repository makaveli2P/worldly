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
  'Irish Sea', 'Chinese New Year', 'French Polynesian',
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
// A demonym before these words places the people, not the event: "Indian nationals killed in Kuwait".
const DIASPORA_AFTER = /^(?:-(?:origin|born|American|British|Canadian|Australian)|\s+(?:nationals?|citizens?|tourists?|students?|workers?|migrants?|journalists?|hostages?|pilgrims?|expats?|diaspora|crew|sailors?|embassy|envoy|ambassador|consulate|soldiers? (?:in|abroad))\b)/i;

interface Owner {
  id: string | null; // null: a block phrase
  kind: AliasKind | 'block';
}

const OWNER = new Map<string, Owner>();
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
  for (const l of a.leaders) {
    own(l.name, id, 'leader');
    if (l.surname) own(l.surname, id, 'surname');
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
  for (const m of title.matchAll(ALIAS_RE)) {
    const text = m[1];
    const index = m.index ?? 0;
    const owner = OWNER.get(text);
    if (!owner?.id || owner.kind === 'block') continue;
    const id = owner.id;
    const kind = owner.kind;
    const before = title.slice(0, index);
    const after = title.slice(index + text.length);
    if (text === 'US' && isAllCaps(title)) continue; // "LET US" in a shouted title
    if (id === 'GEO' && (GEORGIA_US.test(title) || !NEEDS_CONTEXT.GEO.test(title))) continue;
    if (id === 'JEY' && !NEEDS_CONTEXT.JEY.test(title)) continue;
    if (text === 'Turkey' && TURKEY_FOOD.test(title)) continue;
    // "Jordan Davis", "Chad Smith": a given name and a capitalised surname, in a sentence-case title.
    if (GIVEN_NAME_COUNTRIES.has(text) && !titleCase && /^\s+\p{Lu}\p{Ll}+/u.test(after) && !/^\s+(?:Valley|River|Sea|Strip|State|Basin)\b/.test(after)) {
      continue;
    }

    let weight = kind === 'leader' || kind === 'surname' ? 0.5 : 1;
    if (kind === 'demonym' && DIASPORA_AFTER.test(after)) weight = 0;
    if (titleCase && GIVEN_NAME_COUNTRIES.has(text)) weight = Math.min(weight, 0.5);
    let locus = 0;
    if (weight > 0.25) {
      if (LOCATIVE.test(before)) locus += 2;
      if (kind === 'place') locus += 1;
    }
    out.push({ id, text, kind, index, end: index + text.length, weight, locus });
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
  // A short label before a colon ("Jerusalem Daily: Heavy rains flood Gaza") is not the scene
  // when the text after the colon names a country. "Gabon coup: officers take over" keeps Gabon.
  const colon = title.indexOf(':');
  if (colon > 0 && colon < 30 && title.slice(0, colon).split(/\s+/).length <= 3) {
    const label = out.filter((m) => m.index < colon);
    if (label.length && out.some((m) => m.index > colon && m.weight >= 0.5)) {
      for (const m of label) {
        m.weight = Math.min(m.weight, 0.25);
        m.locus = 0;
      }
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
  const tail = t.replace(/(?:\s*[,:]\s*|\s+[–—-]\s+)[^,:–—]*\b(?:says?|said|reports?|claims?|tells|according to|announces?)\b[^,:–—]*$/i, '');
  if (tail !== t && tail.trim() && namesAnyCountry(tail)) t = tail;
  const head = t.replace(/^[^:]{0,60}?\b(?:says?|said|claims?)\b\s*:?\s*/i, '');
  if (head !== t && head.trim() && namesAnyCountry(head)) t = head;
  return t;
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
