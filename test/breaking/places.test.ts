// The place gazetteer (api/_lib/breaking/places.json, built by scripts/build-places.mjs) and the
// gazetteer pass of the country matcher. A gazetteer place adds a country only where the headline
// clearly names a place. Each trap below is a word, a person, a club or a brand that has the name
// of a real place, and that must not give a country.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import aliasData from '../../api/_lib/breaking/aliases.json' with { type: 'json' };
import { classify } from '../../api/_lib/breaking/classify.js';
import { detect } from '../../api/_lib/breaking/detect.js';
import { gazetteerEntry, matchCountries, placeKeys, primaryCountries } from '../../api/_lib/breaking/match.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), '../../api/_lib/breaking/places.json');
const DATA = JSON.parse(readFileSync(FILE, 'utf8')) as {
  meta: { geonames: string; built: string; counts: Record<string, number> };
  given: string[];
  places: Record<string, Record<'major' | 'place' | 'context', string[]>>;
};
const ALIASES = aliasData as Record<string, { names: string[]; demonyms: string[]; places: string[]; leaders: { name: string; surname: string | null }[] }>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const REGIONS = ['Asia', 'Europe', 'Africa', 'America', 'Americas', 'Oceania', 'Antarctica', 'Arctic', 'Atlantic', 'Pacific', 'Caribbean', 'Balkans', 'Sahara', 'Sahel', 'Middle East', 'Mediterranean'];

describe('places.json: data invariants', () => {
  const owner = new Map<string, string[]>();
  for (const [id, p] of Object.entries(DATA.places)) {
    for (const cls of ['major', 'place', 'context'] as const) for (const f of p[cls]) owner.set(f, [...(owner.get(f) ?? []), id]);
  }
  const aliasForms = new Set<string>();
  for (const a of Object.values(ALIASES)) {
    for (const x of [...a.names, ...a.demonyms, ...a.places]) aliasForms.add(x);
    for (const l of a.leaders) {
      aliasForms.add(l.name);
      if (l.surname) aliasForms.add(l.surname);
    }
  }

  it('maps every form to exactly one country that aliases.json has', () => {
    expect(owner.size).toBeGreaterThan(20_000);
    for (const [f, ids] of owner) {
      expect(ids, f).toHaveLength(1);
      expect(ALIASES[ids[0]], `${f} -> ${ids[0]}`).toBeDefined();
    }
  });

  it('has no alias form, month, weekday, continent or royal title', () => {
    const bad = [...owner.keys()].filter(
      (f) => aliasForms.has(f) || MONTHS.includes(f) || DAYS.includes(f) || REGIONS.includes(f) || /^(?:Prince|Princess|King|Queen|Lord|Lady|Sir|Duke)\b/.test(f),
    );
    expect(bad).toEqual([]);
  });

  it('holds only forms that a headline can hold: 4 or more characters, a capital Latin letter first', () => {
    const bad = [...owner.keys()].filter((f) => f.length < 4 || !/^\p{Lu}/u.test(f) || /[0-9()/,]/.test(f) || [...f].some((ch) => /\p{L}/u.test(ch) && ch.codePointAt(0)! > 0x24f));
    expect(bad).toEqual([]);
  });

  it('has given names and stays small', () => {
    expect(DATA.given.length).toBeGreaterThan(1_000);
    expect(DATA.given).toContain('Charles');
    expect(statSync(FILE).size).toBeLessThan(1_000_000);
  });

  it('puts the spot checks in the right country and class', () => {
    const where = (f: string) => {
      const id = owner.get(f)?.[0];
      if (!id) return null;
      const p = DATA.places[id];
      return `${id} ${(['major', 'place', 'context'] as const).find((c) => p[c].includes(f))}`;
    };
    expect(where('Brooklyn')).toBe('USA major');
    expect(where('Manhattan')).toBe('USA major');
    expect(where('The Bronx')).toBe('USA major');
    expect(where('Flatbush')).toBe('USA place');
    expect(where('Kreuzberg')?.startsWith('DEU')).toBe(true);
    expect(where('Gauteng')?.startsWith('ZAF')).toBe(true);
    expect(where('Zamfara')?.startsWith('NGA')).toBe(true);
    expect(where('Bombay')?.startsWith('IND')).toBe(true);
    expect(where('Bavaria')?.startsWith('DEU')).toBe(true);
    expect(where('Mosul')?.startsWith('IRQ')).toBe(true);
    for (const f of ['Nice', 'Mobile', 'Austin', 'Washington', 'Phoenix']) expect(where(f)?.endsWith('context'), f).toBe(true);
    // Names of two countries (or a range, an island) are not in the gazetteer.
    for (const f of ['Victoria', 'Birmingham', 'Lincoln', 'Reading', 'San Jose', 'Valencia', 'Westminster', 'Andes', 'Samar']) {
      expect(where(f), f).toBeNull();
    }
  });

  it('gives the matcher no form that the curated table has', () => {
    expect(gazetteerEntry('London')).toBeUndefined(); // an alias place of GBR
    expect(gazetteerEntry('Brooklyn')).toEqual({ id: 'USA', cls: 'major' });
  });
});

describe('gazetteer: new correct matches', () => {
  it.each([
    ['Building collapse in Flatbush kills 8', ['USA']],
    ['Death toll climbs to 8 in Brooklyn building collapse as fire department ends rescue operation', ['USA']],
    ['Brooklyn building collapse: 2 children, 6 men killed in Flatbush', ['USA']],
    ['Officials End Rescue Operations at Site of Fatal Building Collapse in Brooklyn', ['USA']],
    ['Doctor kills one and injures four in Washington shooting', ['USA']],
    ['Tornado kills 5 in Mobile, Alabama', ['USA']],
    ['Explosion at fireworks factory in Sivakasi kills 8', ['IND']],
    ['Bus plunges into gorge in Uttarkashi, 12 dead', ['IND']],
    ['Truck attack in Nice kills 84', ['FRA']],
    ['Gunmen attack village in Zamfara', ['NGA']],
    ['Floods in Bavaria kill 6', ['DEU']],
    ['Ferry sinks off Zanzibar', ['TZA']],
    ['Fire in Mosul wedding hall kills 100', ['IRQ']],
    ['Riot police clash with protesters in Kreuzberg', ['DEU']],
    ['Gas explosion in Brixton injures four', ['GBR']],
    ['Heavy rain floods parts of Gauteng', ['ZAF']],
    ['Shelter-in-place advisory issued near Squamish, B.C., due to flooding from heavy rain', ['CAN']],
    ['Durban family desperate to find missing father in Phuket', ['THA']],
  ])('%s -> %j', (title, expected) => {
    expect(primaryCountries(title)).toEqual(expected);
  });

  it('makes a curated country stronger than a gazetteer place of another country', () => {
    // Before the gazetteer: IRQ+IRN and ESP+MAR. The city now names the scene.
    expect(primaryCountries('Iraq bars Iranian football team’s plane from landing in Basra: Report')).toEqual(['IRQ']);
    expect(primaryCountries('Spain clears Ceuta port migrant camp as 300 return to Morocco')).toEqual(['ESP']);
  });

  it('marks gazetteer matches with their source and gives them weight 1 and no place bonus', () => {
    const m = matchCountries('Building collapse kills 8 in Brooklyn');
    expect(m).toEqual([expect.objectContaining({ id: 'USA', text: 'Brooklyn', kind: 'place', source: 'gazetteer', weight: 1, locus: 2 })]);
    const plain = matchCountries('Brooklyn building collapse kills 8');
    expect(plain).toEqual([expect.objectContaining({ source: 'gazetteer', weight: 1, locus: 0 })]);
    expect(matchCountries('Fire in London kills 3')[0].source).toBe('alias');
  });

  it('gives the place keys that join one story', () => {
    expect([...placeKeys('Brooklyn building collapse: 2 children, 6 men killed in Flatbush', 'USA')]).toEqual(['brooklyn', 'flatbush']);
  });

  it('gives one key to the curated and gazetteer forms of one place (the DC gym shooting, 2026-11-13)', () => {
    for (const t of ['Gunman kills 3 in Washington gym attack', 'D.C. gunman kills 3 at gym', 'Deadly shooting in Washington DC', 'Deadly shooting in Washington, D.C.']) {
      expect([...placeKeys(t, 'USA')], t).toEqual(['washington dc']);
    }
    // Washington state is another place.
    expect([...placeKeys('Gunman kills 3 in Washington state school', 'USA')]).toEqual(['washington state']);
    expect([...placeKeys('New York City shooting kills 5', 'USA')]).toEqual(['new york']);
  });
});

describe('gazetteer traps: words, people, clubs and brands', () => {
  it.each([
    'Paris Hilton launches new perfume line',
    'Florence Pugh to star in new thriller',
    'Chelsea beat Arsenal 2-0 at Stamford Bridge',
    'Austin Butler cast as Elvis again',
    'Lincoln Riley fired after loss',
    'Reading list: the best books of the year',
    'Bath salts linked to overdoses',
    'Nice weather ahead for the weekend',
    'Mobile phone ban in schools starts',
    'Best of 2026: our picks',
    'Of Mice and Men revival opens',
    'Charles Darwin letter sold at auction',
    'Michael Jackson estate sells catalog',
    'Batman returns to cinemas',
    'Toyota recalls 1 million cars',
    'Independence Day parade cancelled',
    'Lakers’ Luka Doncic Has ‘Hope’ on Austin Reaves Injury',
    'Football gossip: Gusto, Lankshear, De Bruyne, Grealish, Balogun, Gomez, Moore, Gavi',
    'Man Utd ‘Strike Deal’ With Mauricio Pochettino, Contract Length Revealed',
    'Prince William Recalls Having to “Hit the Floor” After Tourists Nearly Caught Him Undressed',
    'Lewis Hamilton wins in the rain',
    'Brooklyn Nets Beat The Knicks In Overtime Thriller',
  ])('%s gives no country', (title) => {
    expect(primaryCountries(title)).toEqual([]);
  });

  it.each([
    ['Victoria Beckham opens London store', ['GBR']],
    ['Meta fined by EU regulators', []],
    ['European diplomats press Rubio for a role in Russia-Ukraine talks', ['RUS']],
    ['Ariana Grande & Ricky Alvarez Make Red-Carpet Debut at ‘Focker-in-Law’ NYC Premiere: See Photos', []],
    ['Teen who fired shots at two GTA synagogues in March sentenced after pleading guilty', []],
    ['Three sea robbery cases in straits of Malacca and Singapore over a week in November', ['SGP']],
    ['Recipe for Success: What’s cooking at Waldorf Astoria Kuala Lumpur with Chef Vijayakant Shanmugam', ['MYS']],
    ['Scotland: No excuses as Pocognoli seeks first Hampden victory', ['GBR']],
    ['Oxford museum returns ancestral Naga skulls to India', ['IND']],
    ['Bus plunges into gorge in Peru, killing 20', ['PER']],
    ['Peru bus crash kills 20 in Andes', ['PER']],
  ])('%s keeps the old country %j', (title, expected) => {
    expect(primaryCountries(title)).toEqual(expected);
  });

  it('never takes a family or a company for the old name or the county of the same name', () => {
    // "Romanov" is an old name of Murmansk: an old name counts only after "in".
    expect(primaryCountries('A Romanov sapphire bracelet sells for $8.8 million at a Geneva auction')).not.toContain('RUS');
    // "Fairfax" is an alternate name of Fairfax County: a county counts only in its full form.
    expect(primaryCountries('Fairfax plans to integrate IDBI Bank, Digit and IIFL businesses into financial services platform')).toEqual([]);
  });

  it('never takes a sea, a strait or a gulf for the town of the same name', () => {
    expect(primaryCountries('Russian warship hit by Ukrainian drone in Gulf of Finland')).not.toContain('PNG');
    expect(primaryCountries('Three sea robbery cases in straits of Malacca and Singapore over a week in November')).not.toContain('MYS');
  });

  it('never takes a person, a show or a brand for a place', () => {
    expect(primaryCountries('Dolly Parton’s Final Vocals Featured on ‘Torn,’ a Duet with Bono from U2 Recorded Just Weeks Before Her Death')).not.toContain('GHA');
    expect(primaryCountries('Joo Chiat gets Shibuya-style scramble crossing in trial from Nov 16')).not.toContain('JPN');
    expect(primaryCountries('Can the Eurovision Song Contest succeed in Asia?')).not.toContain('PHL');
    expect(primaryCountries('European diplomats press Rubio for a role in Russia-Ukraine talks')).not.toContain('VEN');
    expect(primaryCountries('Ariana Grande & Ricky Alvarez Make Red-Carpet Debut at ‘Focker-in-Law’ NYC Premiere: See Photos')).not.toContain('TUN');
  });
});

describe('detect(): the Brooklyn building collapse of 2026-11-12', () => {
  // Real titles. Before the gazetteer, only the France 24 title ("New York") named a country, so the
  // story had 1 voice and no edition. With "Brooklyn" and "Flatbush", 5 outlets and 2 editions join it.
  const NOW = Date.parse('2026-11-12T16:00:00Z');
  const rows: [string, 'front' | 'gn', string | null, number, string, string][] = [
    ['france24', 'front', null, 2, 'France 24', 'Eight killed, including two children, in New York building collapse'],
    ['gn_top_us', 'gn', 'US', 3, 'ABC7 New York', 'Brooklyn building collapse: 2 children, 6 men killed in Flatbush'],
    ['gn_top_ca', 'gn', 'CA', 5, 'CTV News', 'Death toll rises to 8 in Brooklyn building collapse as rescuers dig through rubble'],
    ['cbc_world', 'front', null, 5, 'CBC', 'Death toll climbs to 8 in Brooklyn building collapse as fire department ends rescue operation'],
    ['gn_top_gb', 'gn', 'GB', 14, 'BBC', "'How does a building just fall?' Neighbours grieve after deadly Brooklyn building collapse"],
  ];
  const out = detect({
    headlines: rows.map(([feed, kind, edition, position, publisher, title], i) => ({
      feed, kind, edition, position, publisher, title, url: `https://example.org/${feed}/${i}`, publishedAt: new Date(NOW - 2 * 3.6e6).toISOString(),
    })),
    itn: { blurbs: [], ongoing: [] }, hazards: [], now: NOW, sources: { ok: 26, total: 26 },
  });

  it('joins the outlets into one USA story with 4 or more voices and 2 editions', () => {
    const c = out.candidates.find((x) => x.id === 'USA' && x.family === 'accident');
    expect(c).toBeDefined();
    expect(c!.voices).toBeGreaterThanOrEqual(4);
    expect(c!.editions).toBe(2);
    expect(out.candidates.filter((x) => x.family === 'accident')).toHaveLength(1);
  });

  it('gives a major alert', () => {
    expect(out.response.alerts.map((a) => `${a.country}:${a.level}`)).toEqual(['USA:major']);
  });
});

describe('classify() ignores gazetteer places', () => {
  it('reads no invasion, war or coup from a city name', () => {
    expect(classify('Tourists invade Venice as carnival starts')).toBeNull();
    expect(primaryCountries('Tourists invade Venice as carnival starts')).toEqual(['ITA']);
    expect(classify('Russia declares war on Georgia')).toMatchObject({ family: 'conflict', tier: 3 });
  });
});

describe('gazetteer: cost', () => {
  it('matches 1,000 headlines fast', () => {
    const titles = [
      'Death toll climbs to 8 in Brooklyn building collapse as fire department ends rescue operation',
      'Ariana Grande & Ricky Alvarez Make Red-Carpet Debut at ‘Focker-in-Law’ NYC Premiere: See Photos',
      'Football gossip: Gusto, Lankshear, De Bruyne, Grealish, Balogun, Gomez, Moore, Gavi',
      'Spain clears Ceuta port migrant camp as 300 return to Morocco',
    ];
    const t0 = performance.now();
    for (let i = 0; i < 250; i++) for (const t of titles) primaryCountries(t);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });
});
