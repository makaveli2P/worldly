// Builds api/_lib/breaking/aliases.json: the alias table of the breaking-news country matcher.
//
// Output: Record<CountryId, { names, demonyms, places, leaders: [{ name, surname }] }>
//   names     country names and other proper nouns that stand for the country ("UK", "Kremlin")
//   demonyms  "Polish", "Nigerian" (a demonym that two countries share goes to one owner or is dropped)
//   places    capitals, regions and big cities that name the country with no doubt
//   leaders   head of state and head of government; `surname` is set only when it is safe alone
//
// Sources: public/data/countries.json (names, capitals, leaders) and mledoze/countries
// (demonyms, alternative spellings; ODbL, the same file that scripts/build-data.mjs reads).
// Curated lists below remove the traps (shared demonyms, ambiguous capitals, common surnames).
//
// Run: node scripts/build-aliases.mjs [--mledoze <local countries.json>]
// Run it after `npm run data`, then commit the JSON. The server never downloads it.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IN_COUNTRIES = join(ROOT, 'public/data/countries.json');
const OUT = join(ROOT, 'api/_lib/breaking/aliases.json');
const MLEDOZE_URL = 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json';

// Extra names that news uses. Each is a case-sensitive proper noun.
const EXTRA_NAMES = {
  USA: ['US', 'U.S.', 'USA', 'U.S.A.', 'United States', 'America', 'White House', 'Pentagon'],
  GBR: ['UK', 'U.K.', 'Britain', 'Great Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'Downing Street'],
  TUR: ['Turkey', 'Türkiye', 'Turkiye'],
  CZE: ['Czech Republic', 'Czechia'],
  CIV: ["Côte d'Ivoire", "Cote d'Ivoire", 'Ivory Coast'],
  COD: ['DR Congo', 'DRC', 'Congo', 'Democratic Republic of Congo', 'Democratic Republic of the Congo'],
  COG: ['Republic of Congo', 'Republic of the Congo', 'Congo-Brazzaville', 'Congo Republic'],
  PSE: ['Gaza', 'Gaza Strip', 'West Bank', 'Palestinian territories'],
  MMR: ['Myanmar', 'Burma'],
  SWZ: ['Eswatini', 'Swaziland'],
  CPV: ['Cape Verde', 'Cabo Verde'],
  TLS: ['Timor-Leste', 'East Timor'],
  MKD: ['North Macedonia'],
  KOR: ['South Korea'],
  PRK: ['North Korea'],
  VAT: ['Vatican', 'Holy See'],
  ARE: ['UAE', 'United Arab Emirates', 'Emirates'],
  RUS: ['Russia', 'Kremlin'],
  'X-kosovo': ['Kosovo'],
  TWN: ['Taiwan'],
};

// Demonyms that news uses, and the owner of a demonym that two countries share.
const EXTRA_DEMONYMS = {
  USA: ['American'], GBR: ['British'], TUR: ['Turkish'], PSE: ['Palestinian'], KOR: ['South Korean'],
  PRK: ['North Korean'], COD: ['Congolese'], DOM: ['Dominican'], NLD: ['Dutch'], CHE: ['Swiss'],
  PHL: ['Filipino', 'Philippine'], NZL: ['New Zealand'], CZE: ['Czech'], IND: ['Indian'], GIN: ['Guinean'],
  SDN: ['Sudanese'], IRL: ['Irish'], FRA: ['French'],
};

// Capitals that do not name the country with no doubt: they are also people, US cities,
// city-states (the country name already matches) or small-territory seats.
const CAPITAL_BLOCK = new Set([
  'San Juan', 'Melbourne', 'Vienna', 'Washington, D.C.', 'Washington', 'Victoria', 'Kingston', 'Georgetown',
  'Hamilton', 'Santiago', 'San José', 'Malé', 'Male', 'Nassau', 'Panama City', "Saint John's", "St. John's",
  'Plymouth', 'Jamestown', 'Kingstown', 'Saint Helier', 'Douglas', 'Avarua', 'Adamstown', 'Alofi', 'Hagåtña',
  'Road Town', 'Charlotte Amalie', 'Philipsburg', 'Willemstad', 'Gustavia', 'Marigot', 'Basseterre', 'Castries',
  'Roseau', 'The Valley', 'Brades', 'Cockburn Town', 'George Town', 'Oranjestad', 'Stanley', 'King Edward Point',
  'Flying Fish Cove', 'West Island', 'Mata-Utu', 'Nouméa', 'Papeete', 'Saint-Pierre', 'Mariehamn', 'Tórshavn',
  'Nuuk', 'Saipan', 'Pago Pago', 'Monaco', 'Luxembourg', 'Singapore', 'Djibouti', 'Vatican City', 'San Marino',
  'Andorra la Vella', 'Kuwait City', 'Mexico City', 'Guatemala City', 'Panama', 'Belize', 'Pristina', 'Nicosia',
  'North Nicosia', 'Hargeisa', 'Lima', 'Bern', 'Praia', 'Apia', 'Dili', 'Moroni', 'Yaren', 'Palikir', 'Majuro',
  'Funafuti', 'Ngerulmud', 'Tarawa', 'South Tarawa', 'Honiara', 'Port Vila', 'Suva', "Nuku'alofa", 'Valletta',
  'Vaduz', 'Brazzaville',
]);

// Regions and cities that headlines name instead of the country. Each one names one country only.
const EXTRA_PLACES = {
  USA: [
    'Washington D.C.', 'Washington DC', 'Washington, D.C.', 'D.C.', 'DC', 'Panama City Beach', 'Panama City, Florida', 'New York City', 'New York', 'Los Angeles', 'Chicago', 'Houston', 'Atlanta', 'San Francisco',
    'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida',
    'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland',
    'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada',
    'New Hampshire', 'New Jersey', 'Jersey City', 'New Mexico', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma',
    'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
    'Vermont', 'Virginia', 'West Virginia', 'Wisconsin', 'Wyoming',
  ],
  CAN: ['Ontario', 'Quebec', 'Alberta', 'British Columbia', 'Manitoba', 'Saskatchewan', 'Nova Scotia', 'Toronto', 'Montreal', 'Vancouver'],
  CHN: ['Beijing', 'Tibet', 'Xinjiang', 'Shanghai', 'Sichuan', 'Yunnan', 'Guangdong', 'Wuhan', 'Shenzhen', 'Inner Mongolia'],
  IND: [
    'New Delhi', 'Delhi', 'Mumbai', 'Kolkata', 'Chennai', 'Bengaluru', 'Bangalore', 'Hyderabad', 'Odisha',
    'Andhra Pradesh', 'Tamil Nadu', 'Kerala', 'West Bengal', 'Gujarat', 'Assam', 'Manipur', 'Uttarakhand',
    'Himachal Pradesh', 'Uttar Pradesh', 'Bihar', 'Punjab, India', 'Ahmedabad',
  ],
  PAK: ['Karachi', 'Lahore', 'Peshawar', 'Balochistan', 'Khyber Pakhtunkhwa', 'Quetta'],
  JPN: ['Tokyo', 'Osaka', 'Hokkaido', 'Okinawa', 'Kyushu', 'Fukushima', 'Noto'],
  IDN: ['Jakarta', 'Java', 'Sumatra', 'Bali', 'Sulawesi', 'Papua, Indonesia'],
  PHL: ['Manila', 'Mindanao', 'Luzon', 'Cebu'],
  MEX: ['Mexico City', 'Guadalajara', 'Acapulco', 'Sinaloa', 'Oaxaca'],
  BRA: ['Rio de Janeiro', 'São Paulo', 'Rio Grande do Sul'],
  AUS: ['Sydney', 'Queensland', 'New South Wales', 'Tasmania', 'Brisbane', 'Adelaide', 'Canberra'],
  ESP: ['Barcelona', 'Madrid', 'Valencia', 'Oviedo', 'Andalusia', 'Catalonia'],
  FRA: ['Marseille', 'Lyon', 'Nice, France'],
  DEU: ['Munich', 'Hamburg', 'Berlin', 'Frankfurt'],
  TUR: ['Ankara', 'Istanbul', 'Izmir', 'Aliağa', 'Antakya', 'Hatay'],
  MMR: ['Yangon', 'Mandalay', 'Rakhine'],
  ETH: ['Tigray', 'Amhara', 'Addis Ababa'],
  NGA: ['Lagos', 'Niger Delta', 'Niger State', 'Borno', 'Kano', 'Benin City'],
  PSE: ['Ramallah', 'Gaza City', 'Khan Younis', 'Rafah'],
  UKR: ['Kyiv', 'Kiev', 'Kharkiv', 'Odesa', 'Odessa', 'Zaporizhzhia', 'Donetsk', 'Dnipro'],
  ISR: ['Tel Aviv', 'Jerusalem'],
  LBN: ['Beirut'],
  SYR: ['Damascus', 'Aleppo'],
  SDN: ['Khartoum', 'Darfur', 'El Fasher', 'El-Fasher'],
  RUS: ['Moscow', 'St Petersburg', 'Saint Petersburg'],
  GRC: ['Crete'],
  IRN: ['Tehran'],
  AFG: ['Kabul'],
  IRQ: ['Baghdad'],
  YEM: ['Sanaa', "Sana'a"],
  HTI: ['Port-au-Prince'],
  POL: ['Kraków', 'Krakow', 'Warsaw'],
  VNM: ['Hanoi', 'Ho Chi Minh City'],
  ZAF: ['Johannesburg', 'Cape Town'],
  KWT: ['Kuwait City'],
  GTM: ['Guatemala City'],
  COG: ['Brazzaville'],
  'X-kosovo': ['Pristina'],
  GBR: ['London', 'Manchester', 'Glasgow', 'Edinburgh'],
  VAT: ['Vatican City'],
};

// Leader names that news uses in other forms.
const EXTRA_LEADERS = {
  UKR: [{ name: 'Volodymyr Zelensky', surname: 'Zelensky' }],
  CHN: [{ name: 'Xi Jinping', surname: 'Xi' }],
  PRK: [{ name: 'Kim Jong Un', surname: null }, { name: 'Kim Jong-un', surname: null }],
  VAT: [{ name: 'Pope', surname: null }],
  GBR: [{ name: 'King Charles', surname: null }],
};

// Alternative spellings that are also common words or given names.
// "South Georgia" is more often the south of the US state than the British territory.
const NAME_BLOCK = new Set(['Island', 'Timor', 'Aland', 'Dominique', 'Prathet', 'South Georgia']);

// Countries that put the family name first: use the full name only.
const FAMILY_FIRST = new Set(['CHN', 'KOR', 'PRK', 'TWN', 'VNM', 'KHM', 'HKG', 'MAC', 'MNG', 'SGP', 'LAO', 'MMR', 'HUN']);

// A leader surname on these lists does not count alone: it is a common surname, a given name,
// an English word or part of a common phrase ("Boko Haram", "El Chapo").
// This explicit list replaces a dictionary file, so that the build gives the same output on every machine.
const SURNAME_BLOCK = new Set([
  'Smith', 'Lee', 'Kim', 'Khan', 'Ali', 'Singh', 'Shah', 'Hasan', 'Hassan', 'Mohammed', 'Ahmed', 'Wang', 'Li',
  'Zhang', 'Chen', 'Park', 'Nguyen', 'Tran', 'Rahman', 'Hussein', 'Abdullah', 'Ibrahim', 'Silva', 'Santos', 'Costa',
  'Pereira', 'Rodrigues', 'Garcia', 'Martin', 'Bernard', 'Thomas', 'Lopez', 'Gonzalez', 'Brown', 'Jones', 'Davis',
  'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Jackson', 'White', 'Harris', 'Clark', 'Lewis', 'Young', 'King',
  'Wright', 'Hill', 'Green', 'Adams', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips',
  'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart', 'Morris', 'Murphy', 'Cook', 'Rogers', 'Morgan',
  'Bell', 'Ward', 'Cox', 'Howard', 'Gray', 'James', 'Watson', 'Brooks', 'Kelly', 'Price', 'Bennett', 'Wood', 'Ross',
  'Long', 'Ford', 'Hughes', 'Charles', 'Philip', 'George', 'William', 'Frederik', 'Felipe', 'Harald', 'Albert',
  'Henri', 'Hans-Adam', 'Salman', 'Mohamed', 'Mohammad',
  // Given names and words (the old dictionary filter, now explicit).
  'Bryan', 'Drew', 'Burt', 'Burton', 'Cross', 'Holiday', 'Levy', 'Nova', 'Said', 'Barrow', 'Antonio', 'Stocker',
  'Sima', 'Rama', 'Musar', 'Friday', 'Pierre', 'José', 'Raúl', 'Hamad', 'Saud', 'Thani', 'Idris', 'Robinah', 'Oury',
  'Michal', 'Salam', 'Barre', 'Pavel', 'Boko', 'Chapo', 'Johor', 'Haas', 'Heine', 'Faye', 'Abela', 'Debono', 'Wever',
  'Frieden', 'Neves', 'Carvalho', 'Ramos', 'Chávez', 'Chavez', 'Fernández', 'Fernandez', 'Rodriguez', 'Rodríguez',
  'Sánchez', 'Sanchez', 'Ortega', 'Marcos', 'Schmidt', 'Herzog', 'Pellegrini', 'Sharif', 'Mohamud', 'Akhund',
  'Connolly', 'Pentinat', 'Zamora', 'Browne', 'Bostic', 'Selassie', 'Bellen', 'Nandi',
  // Family names of ruling houses and common West African surnames: many people share them.
  'Al Nahyan', 'Nahyan', 'Al Maktoum', 'Maktoum', 'Al-Sabah', 'Sabah', 'Traoré', 'Traore', 'Ouattara', 'Maïga',
  'Maiga', 'Nguema', 'Obiang',
]);

async function loadMledoze() {
  const i = process.argv.indexOf('--mledoze');
  if (i > 0 && process.argv[i + 1]) return JSON.parse(await readFile(process.argv[i + 1], 'utf8'));
  const res = await fetch(MLEDOZE_URL, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; data-build)' } });
  if (!res.ok) throw new Error(`mledoze: HTTP ${res.status}`);
  return res.json();
}

const FOREIGN_FORM = /[ʻ’‘]|Republika|Repubblica|República|République|Republiek|Cumhuriyeti|Bundes|Königreich|Reino|Royaume|Koninkrijk|Kingdom of|Commonwealth of|Federation of|State of|Republic of|Islamic|People's|Socialist|Federal|Democratic|Principality|Sultanate|Grand Duchy|Kongeriget|Konungariket|Kongeriket|Rzeczpospolita|Hashemite|Plurinational|Bolivarian/;

async function main() {
  const countries = JSON.parse(await readFile(IN_COUNTRIES, 'utf8'));
  const mledoze = await loadMledoze();
  const byCca3 = new Map(mledoze.map((c) => [c.cca3, c]));
  byCca3.set('X-kosovo', byCca3.get('UNK'));
  const hispanic = new Set(
    Object.values(countries)
      .filter((c) => ((c.languages ?? []).some((l) => /Spanish|Portuguese/.test(l)) && c.region === 'Americas') || ['ESP', 'PRT'].includes(c.id))
      .map((c) => c.id),
  );

  const out = {};
  const demonymOwners = new Map();
  for (const [id, c] of Object.entries(countries)) {
    const m = byCca3.get(id);
    const names = new Set([c.name, ...(EXTRA_NAMES[id] ?? [])]);
    if (m?.name?.common) names.add(m.name.common);
    for (const s of m?.altSpellings ?? []) {
      // Keep long English-style spellings. Drop codes and official forms in the local language.
      if (s.length >= 5 && /^\p{Lu}/u.test(s) && /^[\p{Script=Latin}\s'.,()-]+$/u.test(s) && !FOREIGN_FORM.test(s)) names.add(s);
    }
    for (const b of NAME_BLOCK) names.delete(b);
    if (id === 'COG') names.delete('Congo'); // News uses plain "Congo" for DR Congo (AP and Reuters style).

    const demonyms = new Set(EXTRA_DEMONYMS[id] ?? []);
    const eng = m?.demonyms?.eng;
    if (eng) for (const d of [eng.m, eng.f]) if (d && d.length >= 4) demonyms.add(d);
    for (const d of demonyms) demonymOwners.set(d, [...(demonymOwners.get(d) ?? []), id]);

    const places = new Set([
      ...(c.capital ?? []).filter((x) => x.length >= 4 && !CAPITAL_BLOCK.has(x)),
      ...(EXTRA_PLACES[id] ?? []),
    ]);
    const leaders = [];
    for (const who of [c.government?.headOfState, c.government?.headOfGovernment]) {
      if (who && !leaders.some((l) => l.name === who)) leaders.push({ name: who, surname: null });
    }
    out[id] = { names: [...names], demonyms: [...demonyms], places: [...places], leaders, population: c.population ?? 0 };
  }

  // A demonym that two countries share stays only with the owner named in EXTRA_DEMONYMS.
  for (const [d, owners] of demonymOwners) {
    if (owners.length < 2) continue;
    const keep = owners.find((id) => EXTRA_DEMONYMS[id]?.includes(d));
    for (const id of owners) if (id !== keep) out[id].demonyms = out[id].demonyms.filter((x) => x !== d);
  }

  // A leader that heads several countries (Charles III) stays only with the most populous one.
  const leaderOwners = new Map();
  for (const [id, a] of Object.entries(out)) for (const l of a.leaders) leaderOwners.set(l.name, [...(leaderOwners.get(l.name) ?? []), id]);
  for (const [name, owners] of leaderOwners) {
    if (owners.length < 2) continue;
    const keep = owners.sort((x, y) => out[y].population - out[x].population)[0];
    for (const id of owners) if (id !== keep) out[id].leaders = out[id].leaders.filter((l) => l.name !== name);
  }

  // Leader surnames: unique across leaders, 4 or more letters, not a place word, not on the block list.
  const surnameOwners = new Map();
  const surnameOf = new Map();
  for (const [id, a] of Object.entries(out)) {
    for (const l of a.leaders) {
      const parts = l.name.replace(/\s+(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XIV|Jr\.?|Sr\.?)$/, '').split(/\s+/);
      if (FAMILY_FIRST.has(id) || parts.length < 2) continue;
      // Spanish and Portuguese double surnames: news uses the first one ("Santiago Peña Palacios" -> "Peña").
      const last = parts.length >= 3 && hispanic.has(id) ? parts[parts.length - 2] : parts[parts.length - 1];
      surnameOf.set(l, last);
      surnameOwners.set(last, new Set([...(surnameOwners.get(last) ?? []), id]));
    }
  }
  const placeWords = new Set(Object.values(out).flatMap((a) => [...a.names, ...a.demonyms, ...a.places]));
  for (const [id, a] of Object.entries(out)) {
    for (const l of a.leaders) {
      const s = surnameOf.get(l);
      const ok = s && countries[id].unMember === true && s.length >= 4 && /^\p{Lu}/u.test(s) &&
        !SURNAME_BLOCK.has(s) && surnameOwners.get(s).size === 1 && !placeWords.has(s);
      l.surname = ok ? s : null;
    }
    // An extra entry adds a leader, or sets the surname of a leader that is already present ("Xi").
    for (const extra of EXTRA_LEADERS[id] ?? []) {
      const known = a.leaders.find((l) => l.name === extra.name);
      if (!known) a.leaders.push({ ...extra });
      else if (extra.surname) known.surname = extra.surname;
    }
    delete a.population;
  }

  // Sorted keys and one country per line keep the diff small between runs.
  const sorted = Object.fromEntries(Object.keys(out).sort().map((id) => [id, out[id]]));
  const lines = Object.entries(sorted).map(([id, a]) => `${JSON.stringify(id)}:${JSON.stringify(a)}`);
  await writeFile(OUT, `{\n${lines.join(',\n')}\n}\n`);
  const count = Object.values(out).reduce((n, a) => n + a.names.length + a.demonyms.length + a.places.length + a.leaders.length, 0);
  console.log(`aliases: ${Object.keys(out).length} countries, ${count} aliases, ${JSON.stringify(sorted).length} bytes -> ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
