// Builds api/_lib/news-aliases.json: CountryId -> the words that show a news title is about that country.
//
// Inputs:
//   scripts/news-aliases-base.json  Names, demonyms and capitals (hand file, from mledoze/countries and
//                                   public/data/countries.json, with the traps removed).
//   public/data/countries.json      The heads of state and government (npm run data refreshes them).
//
// Rules for the leaders:
//   - A full name of 2 or more words is kept. A name that several countries share ("Charles III",
//     "Frederik X", "Emmanuel Macron") stays only on the country with the largest population.
//   - A bare surname is kept only when it identifies one person in the news: 5 or more letters
//     (or on KEEP_SHORT), not a common word, first name or frequent surname (SURNAME_STOP), not a
//     first name of another leader, and not an alias of another country.
//   - Arabic names with "bin", "Al" or "Ould", names with "of" and names with a regnal number keep
//     only the full name.
//   - WRONG_LEADERS removes known errors in the source data.
//
// Run: npm run aliases   (no network)

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = join(ROOT, 'scripts/news-aliases-base.json');
const COUNTRIES = join(ROOT, 'public/data/countries.json');
const OUT = join(ROOT, 'api/_lib/news-aliases.json');

export const fold = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// Errors in the leader data of public/data/countries.json (Wikidata). Key: country id.
export const WRONG_LEADERS = {
  GUY: ['Hugo Chávez'],
};

// Distinctive surnames of 4 letters.
export const KEEP_SHORT = new Set(['modi', 'merz', 'ruto', 'biya', 'orpo']);

// Surnames that are common words, first names or frequent surnames. Folded, with no accents.
export const SURNAME_STOP = new Set(
  `
friday monday sunday may march august summer winter spring price money bush grant ford lincoln washington jordan chase
sharp golden noble castle street bridge church love hope strong power black white green brown gray grey young king
pierre jose raul juan carlos luis maria manuel pedro pablo jorge diego miguel antonio francisco alexander andrew
peter michael david daniel joseph james john william paul robert thomas richard charles george edward henry philip
ramos neves carvalho sanchez fernandez rodriguez pena zamora schmidt haas barre hamad salam frieden browne herzog
mohamud chavez marcos ortega sharif idris faye pavel michal heine johor saud thani connolly albanese pellegrini
abela debono bostic palacios delgado cruz santos silva costa pereira ferreira oliveira souza lopez gonzalez martinez
garcia perez gomez diaz torres flores rivera morales ortiz castro ruiz romero herrera medina aguilar vargas mendoza
guzman navarro moreno alvarez jimenez gutierrez ramirez reyes mora castillo vega rojas nunez soto sosa molina serrano
campos blanco suarez luna leon acosta paz arce smith johnson williams jones miller davis wilson anderson taylor moore
martin jackson thompson harris clark lewis robinson walker allen wright scott baker adams nelson hill campbell
mitchell roberts carter phillips evans turner parker collins edwards stewart morris murphy cook rogers morgan cooper
peterson bailey reed kelly howard ward richardson watson brooks wood bennett hughes sanders myers long ross foster
powell jenkins perry russell sullivan bell coleman butler henderson barnes fisher graham hamilton wallace west cole
hayes gibson ellis stone hunt page rose muller mueller schneider fischer weber meyer wagner becker schulz hoffmann
koch richter klein wolf schroder neumann schwarz braun zimmermann kruger hartmann lange werner krause lehmann frank
berger kaiser fuchs vogel keller lang bernard dubois robert petit durand leroy moreau simon laurent lefebvre michel
david bertrand roux vincent fournier morel girard andre mercier dupont lambert bonnet francois legrand blanc guerin
faure rousseau hassan hussein ahmed mohamed mohammed omar ibrahim khalil salem saleh abdullah mahmoud mustafa youssef
khan rahman hamid karim aziz nasser said yusuf musa issa adam haddad mansour mansouri singh kumar sharma gupta patel
shah nguyen tran pham lim wong chen wang zhang liu park cross meade holiday bryan burton barrow nielsen rankin germain
abdullahi stocker ebanks abbas seguro manet akhund nguema chapo robinah
da silva
`
    .split(/\n/)
    .flatMap((line) => (line.includes(' ') && line.split(' ').length === 2 && line.startsWith('da ') ? [line] : line.split(/\s+/)))
    .filter(Boolean),
);

// Countries whose leaders put the family name first ("Xi Jinping", "Lee Jae-myung"). Full names only.
export const FAMILY_NAME_FIRST = new Set(['CHN', 'TWN', 'HKG', 'MAC', 'KOR', 'PRK', 'VNM', 'KHM', 'MMR', 'MNG']);

const REGNAL = /^[IVX]+$/;
const SUFFIX = /^(?:Jr|Sr)\.?$/;
// First names that stand between a first name and the surnames ("José Raúl Mulino").
const FIRST_NAMES = new Set(['jose', 'raul', 'juan', 'carlos', 'luis', 'maria', 'manuel', 'pedro', 'pablo', 'jorge', 'miguel', 'antonio', 'francisco']);
const ARABIC_PARTICLE = /^(?:bin|bint|ibn|al|el|ould|ag)$|^(?:al|el)-/i;
const PARTICLE = /^(?:de|van|von|der|den|da|di|du|le|la|dos|das|del|ter)$/i;

/** "Emmanuel Macron and Josep-Lluís Serrano Pentinat" -> 2 names. */
export function splitLeaders(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(/\s*,\s*|\s+and\s+|\s*&\s*/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 2);
}

/**
 * The surname that news titles use alone, or null when there is none that is safe.
 * Spanish names put the mother's surname last: "Santiago Peña Palacios" -> "Peña".
 */
export function surnameOf(name, spanish) {
  if (/\bof\b/i.test(name)) return null;
  const tokens = name.split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && SUFFIX.test(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.some((t) => ARABIC_PARTICLE.test(t))) return null;
  if (REGNAL.test(tokens[tokens.length - 1])) return null;
  if (tokens.length < 2) return null;
  let i = tokens.length - 1;
  if (spanish && tokens.length >= 3 && !FIRST_NAMES.has(fold(tokens[i - 1])) && !/^[A-Z]\.$/.test(tokens[i - 1])) i -= 1;
  // "Bart De Wever" -> "De Wever"; "Alexander Van der Bellen" -> "Van der Bellen".
  let start = i;
  while (start > 1 && PARTICLE.test(tokens[start - 1])) start -= 1;
  return tokens.slice(start, i + 1).join(' ');
}

/** True when a bare surname is safe as an alias on its own (see the rules at the top). */
export function surnameOk(surname, givenNames, otherAliases) {
  const key = fold(surname);
  const last = key.split(/\s+/).pop();
  const letters = last.replace(/[^a-z]/g, '').length;
  if (key.includes(' ')) return letters >= 4 && !SURNAME_STOP.has(key) && !otherAliases.has(key);
  if (letters < 5 && !KEEP_SHORT.has(key)) return false;
  return !SURNAME_STOP.has(key) && !givenNames.has(key) && !otherAliases.has(key);
}

const NOT_LATIN_OR_GREEK = /[Ѐ-ӿ]/;

/** Builds the alias table. Pure, so a test can run it on synthetic data. */
export function buildAliases(base, countries) {
  const leadersOf = new Map();
  const nameOwners = new Map();
  for (const [id, c] of Object.entries(countries)) {
    const wrong = new Set((WRONG_LEADERS[id] ?? []).map(fold));
    const list = [...splitLeaders(c.government?.headOfState), ...splitLeaders(c.government?.headOfGovernment)].filter(
      (n) => !wrong.has(fold(n)),
    );
    const unique = [...new Map(list.map((n) => [fold(n), n])).values()];
    leadersOf.set(id, unique);
    for (const n of unique) {
      const k = fold(n);
      if (!nameOwners.has(k)) nameOwners.set(k, []);
      nameOwners.get(k).push(id);
    }
  }
  const population = (id) => countries[id]?.population ?? 0;
  // A full name that several countries share stays only on the country with the most people.
  const ownerOf = (k) => [...nameOwners.get(k)].sort((a, b) => population(b) - population(a))[0];

  const givenNames = new Set();
  for (const list of leadersOf.values()) for (const n of list) givenNames.add(fold(n.split(/\s+/)[0]));

  const baseAliases = new Map();
  for (const [id, b] of Object.entries(base)) {
    if (id.startsWith('_')) continue;
    baseAliases.set(id, [...(b.names ?? []), ...(b.demonyms ?? []), ...(b.capitals ?? []), ...(b.extra ?? [])]);
  }
  const ownerOfAlias = new Map();
  for (const [id, list] of baseAliases) for (const a of list) if (!ownerOfAlias.has(fold(a))) ownerOfAlias.set(fold(a), id);

  // Surname candidates first, so that a surname that 2 countries use goes on neither.
  const surnames = new Map();
  const surnameCount = new Map();
  for (const [id, list] of leadersOf) {
    const spanish = (countries[id]?.languages ?? []).includes('Spanish');
    for (const n of list) {
      if (ownerOf(fold(n)) !== id || FAMILY_NAME_FIRST.has(id)) continue;
      const s = surnameOf(n, spanish);
      if (!s) continue;
      surnames.set(`${id}\u0000${n}`, s);
      surnameCount.set(fold(s), (surnameCount.get(fold(s)) ?? 0) + 1);
    }
  }

  const out = {};
  for (const id of [...new Set([...baseAliases.keys(), ...leadersOf.keys()])].sort()) {
    const list = [...(baseAliases.get(id) ?? [])];
    const others = new Set([...ownerOfAlias].filter(([, owner]) => owner !== id).map(([k]) => k));
    for (const n of leadersOf.get(id) ?? []) {
      if (ownerOf(fold(n)) !== id) continue;
      list.push(n);
      const s = surnames.get(`${id}\u0000${n}`);
      if (s && surnameCount.get(fold(s)) === 1 && surnameOk(s, givenNames, others)) list.push(s);
    }
    const seen = new Set();
    out[id] = list.filter((a) => {
      const k = fold(a);
      if (a.length < 2 || NOT_LATIN_OR_GREEK.test(a) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  return out;
}

async function main() {
  const base = JSON.parse(await readFile(BASE, 'utf8'));
  const countries = JSON.parse(await readFile(COUNTRIES, 'utf8'));
  const table = buildAliases(base, countries);
  const lines = Object.entries(table).map(([id, list]) => `${JSON.stringify(id)}:${JSON.stringify(list)}`);
  await writeFile(OUT, `{\n${lines.join(',\n')}\n}\n`);
  console.log(`[aliases] ${lines.length} countries written to api/_lib/news-aliases.json`);
}

// Run only as a script, not when a test imports the helpers.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
