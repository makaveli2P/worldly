// The alias table (api/_lib/news-aliases.json) and its builder (scripts/build-news-aliases.mjs).
import { describe, expect, it } from 'vitest';
import aliasTable from '../../api/_lib/news-aliases.json' with { type: 'json' };
import countries from '../../api/_lib/countries.json' with { type: 'json' };
import { aliasesOf } from '../../api/_lib/news.js';
import { fold, relevance } from '../../api/_lib/text.js';

interface Builder {
  buildAliases(base: Record<string, unknown>, countries: Record<string, unknown>): Record<string, string[]>;
  surnameOf(name: string, spanish: boolean): string | null;
}
// A path in a variable, so the type checker does not need a declaration for the .mjs module.
const builderPath = '../../scripts/build-news-aliases.mjs';
const b = (await import(/* @vite-ignore */ builderPath)) as Builder;

const TABLE = aliasTable as Record<string, string[]>;
const COUNTRIES = countries as Record<string, { name: string; iso2: string | null }>;

// Aliases that 2 countries may share. Empty today: add a word here only with a reason.
const SHARED_ALLOWED = new Set<string>();

describe('news-aliases.json', () => {
  it('gives each alias to one country only', () => {
    const owners = new Map<string, string[]>();
    for (const [id, list] of Object.entries(TABLE)) for (const a of list) owners.set(fold(a), [...(owners.get(fold(a)) ?? []), id]);
    const shared = [...owners].filter(([a, ids]) => ids.length > 1 && !SHARED_ALLOWED.has(a)).map(([a, ids]) => `${a}: ${ids.join(',')}`);
    expect(shared).toEqual([]);
  });

  it('has no bare surname that is a common word or a frequent name', () => {
    const banned = ['friday', 'pierre', 'jose', 'raul', 'ramos', 'sanchez', 'rodriguez', 'schmidt', 'haas', 'chavez', 'barre', 'hamad', 'salam', 'frieden', 'browne', 'herzog', 'mohamud', 'zamora', 'pena', 'neves', 'carvalho', 'fernandez', 'hugo chavez', 'albanese', 'abbas', 'chapo'];
    const all = new Set(Object.values(TABLE).flat().map(fold));
    expect(banned.filter((w) => all.has(w))).toEqual([]);
    expect(TABLE.GBR.map(fold)).toContain('charles iii');
  });

  // Generic titles, each with the only countries that it names.
  const TITLES: [string, string[]][] = [
    ['Black Friday deals: the best TVs on sale', []],
    ['Stocks fall on Friday as Fed signals pause', []],
    ['King Charles III opens new hospital wing', ['GBR']],
    ['Schmidt named new coach of club after poor start', []],
    ['Rodriguez hits two homers as Mariners beat Astros', []],
    ['Ramos scores twice in cup win', []],
    ['Pierre Poilievre wins Conservative leadership review', []],
    ['Raúl Castro appears at rally', []],
    ['Alexis Sánchez scores late winner', []],
    ['Julio César Chávez Jr. arrested in Arizona', []],
    ['Haas confirms 2027 driver lineup', []],
    ['Abbas Araghchi meets envoy in Oman', ['OMN']],
    ['Francesca Albanese criticises new report', []],
    ['El Chapo trial: new witness speaks', []],
    ['José Mourinho returns to the dugout', []],
    ['Frieden warns of new outbreak', []],
  ];

  it.each(TITLES)('"%s" names only %j', (title, expected) => {
    const named = Object.entries(COUNTRIES)
      .filter(([id, c]) => relevance(title, c.name, aliasesOf({ id, name: c.name, iso2: c.iso2 })) === 'yes')
      .map(([id]) => id);
    expect(named).toEqual(expected);
  });
});

describe('buildAliases', () => {
  const base = {
    GBR: { names: ['United Kingdom'], demonyms: ['British'], capitals: ['London'] },
    CAN: { names: ['Canada'], demonyms: ['Canadian'], capitals: ['Ottawa'] },
    VCT: { names: ['Saint Vincent and the Grenadines'], demonyms: [], capitals: [] },
    PRY: { names: ['Paraguay'], demonyms: [], capitals: [] },
    CHN: { names: ['China'], demonyms: [], capitals: [] },
    GUY: { names: ['Guyana'], demonyms: [], capitals: [] },
  };
  const gov = (headOfState: string, headOfGovernment: string) => ({ headOfState, headOfGovernment });
  const data = {
    GBR: { population: 69e6, languages: ['English'], government: gov('Charles III', 'Keir Starmer') },
    CAN: { population: 40e6, languages: ['English', 'French'], government: gov('Charles III', 'Mark Carney') },
    VCT: { population: 1e5, languages: ['English'], government: gov('Charles III', 'Godwin Friday') },
    PRY: { population: 7e6, languages: ['Spanish', 'Guaraní'], government: gov('Santiago Peña Palacios', 'Santiago Peña Palacios') },
    CHN: { population: 1.4e9, languages: ['Chinese'], government: gov('Xi Jinping', 'Li Qiang') },
    GUY: { population: 8e5, languages: ['English'], government: gov('Irfaan Ali', 'Hugo Chávez') },
  };
  const out = b.buildAliases(base, data);

  it('keeps a shared monarch only on the country with the most people', () => {
    expect(out.GBR).toContain('Charles III');
    expect(out.CAN).not.toContain('Charles III');
    expect(out.VCT).not.toContain('Charles III');
  });

  it('keeps a full name, but not a surname that is a common word', () => {
    expect(out.VCT).toContain('Godwin Friday');
    expect(out.VCT).not.toContain('Friday');
    expect(out.GBR).toContain('Starmer');
  });

  it('uses the father’s surname for Spanish names, and drops it when it is common', () => {
    expect(b.surnameOf('Santiago Peña Palacios', true)).toBe('Peña');
    expect(b.surnameOf('José Raúl Mulino', true)).toBe('Mulino');
    expect(out.PRY).not.toContain('Peña');
    expect(out.PRY).not.toContain('Palacios');
  });

  it('gives no bare surname for family-name-first countries', () => {
    expect(out.CHN).toContain('Xi Jinping');
    expect(out.CHN).not.toContain('Jinping');
  });

  it('removes known errors in the leader data', () => {
    expect(out.GUY).not.toContain('Hugo Chávez');
    expect(out.GUY).toContain('Irfaan Ali');
  });

  it('keeps particles with the surname', () => {
    expect(b.surnameOf('Bart De Wever', false)).toBe('De Wever');
    expect(b.surnameOf('Alexander Van der Bellen', false)).toBe('Van der Bellen');
    expect(b.surnameOf('Surangel Whipps Jr.', false)).toBe('Whipps');
    expect(b.surnameOf('Tamim bin Hamad Al Thani', false)).toBeNull();
    expect(b.surnameOf('Frederik X', false)).toBeNull();
  });
});
