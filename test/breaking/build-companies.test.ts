// The pure helpers of scripts/build-companies.mjs. Synthetic Wikidata rows; no network.
import { describe, expect, it } from 'vitest';

interface Company {
  q: string;
  name: string;
  names: string[];
  ambiguous?: string[];
  country: string;
  people: { name: string; role: string; links: number }[];
  gsib?: boolean;
}
interface Builder {
  stripSuffix(label: string): string;
  okName(name: string, alt?: boolean): boolean;
  toUsd(amount: number, currency: string): number | null;
  latestValue(rows: { amount: number; currency: string; date: string | null }[]): number;
  pickCountry(hq: string[], iso: string[], countries?: Set<string> | null): string | null;
  parseTsv(text: string): Record<string, { value: string }>[] | null;
  selectCompanies(input: unknown): { companies: Company[]; block: string[]; log: string[]; missing: string[] };
  missingCompanies(companies: Company[], extra: unknown): string[];
  diffCompanies(old: { companies: Company[] } | null, next: { companies: Company[] }): string[];
}

// A path in a variable, so the type checker does not need a declaration for the .mjs module.
const builderPath = '../../scripts/build-companies.mjs';
const b = (await import(/* @vite-ignore */ builderPath)) as Builder;

describe('names', () => {
  it('strips legal suffixes', () => {
    expect(b.stripSuffix('Nvidia Corporation')).toBe('Nvidia');
    expect(b.stripSuffix('Toyota Motor Corporation')).toBe('Toyota Motor');
    expect(b.stripSuffix('Shell plc')).toBe('Shell');
    expect(b.stripSuffix('Samsung Electronics Co., Ltd.')).toBe('Samsung Electronics');
    expect(b.stripSuffix('Adani Group')).toBe('Adani');
  });

  it('strips the "&" or "and" before a suffix, and keeps it inside a name', () => {
    expect(b.stripSuffix('Merck & Co.')).toBe('Merck');
    expect(b.stripSuffix('Merck & Co., Inc')).toBe('Merck');
    expect(b.stripSuffix('Eli Lilly and Company')).toBe('Eli Lilly');
    expect(b.stripSuffix('JPMorgan Chase & Co.')).toBe('JPMorgan Chase');
    expect(b.stripSuffix('Procter & Gamble Co.')).toBe('Procter & Gamble');
    expect(b.stripSuffix('Johnson & Johnson')).toBe('Johnson & Johnson');
  });

  it('drops tickers, domains, codes and QIDs', () => {
    expect(b.okName('INTC')).toBe(false); // a ticker in an alternative label
    expect(b.okName('ibm.com')).toBe(false);
    expect(b.okName('18M')).toBe(false);
    expect(b.okName('Q483551')).toBe(false);
    expect(b.okName('nvidia')).toBe(false);
    expect(b.okName('IBM')).toBe(true);
    expect(b.okName('BP')).toBe(true);
    expect(b.okName('eBay')).toBe(true);
    expect(b.okName('Nvidia')).toBe(true);
    expect(b.okName('BASF', false)).toBe(true); // a main label is not a ticker
  });
});

describe('values', () => {
  it('converts the currency and drops an unknown one', () => {
    expect(b.toUsd(100, 'USD')).toBe(100);
    expect(b.toUsd(100, 'EUR')).toBeCloseTo(115);
    expect(b.toUsd(100, 'XXX')).toBeNull();
  });

  it('takes the newest value from 2018, and drops a value over $6 trillion', () => {
    expect(b.latestValue([
      { amount: 50e9, currency: 'USD', date: '2022-01-01T00:00:00Z' },
      { amount: 60e9, currency: 'USD', date: '2024-01-01T00:00:00Z' },
      { amount: 90e9, currency: 'USD', date: '2015-01-01T00:00:00Z' },
    ])).toBe(60e9);
    expect(b.latestValue([{ amount: 90e9, currency: 'USD', date: '2015-01-01T00:00:00Z' }])).toBe(0);
    expect(b.latestValue([{ amount: 24_580e9, currency: 'USD', date: '2024-01-01T00:00:00Z' }])).toBe(0); // Aramco
    expect(b.latestValue([{ amount: 3e12, currency: 'JPY', date: '2024-01-01T00:00:00Z' }])).toBeCloseTo(19.8e9, -7);
  });

  it('prefers the headquarters country', () => {
    expect(b.pickCountry(['CHN'], ['CYM'])).toBe('CHN'); // Evergrande
    expect(b.pickCountry([], ['SWE'])).toBe('SWE');
    expect(b.pickCountry(['XKX'], [], new Set(['X-kosovo']))).toBe('X-kosovo');
    expect(b.pickCountry(['ZZZ'], [], new Set(['USA']))).toBeNull();
  });
});

describe('parseTsv', () => {
  it('reads a complete answer', () => {
    const rows = b.parseTsv('?c\t?n\t?l\n<http://www.wikidata.org/entity/Q1>\t12\t"A \\"b\\""@en\n<http://www.wikidata.org/entity/Q2>\t3\t\n');
    expect(rows).toEqual([
      { c: { value: 'http://www.wikidata.org/entity/Q1' }, n: { value: '12' }, l: { value: 'A "b"' } },
      { c: { value: 'http://www.wikidata.org/entity/Q2' }, n: { value: '3' } },
    ]);
  });

  it('rejects an answer that a timeout cut', () => {
    expect(b.parseTsv('?c\t?n\n<http://www.wikidata.org/entity/Q1>\t12\njava.util.concurrent.TimeoutException')).toBeNull();
    expect(b.parseTsv('<html>error</html>')).toBeNull();
  });
});

describe('selectCompanies', () => {
  const base = () => ({
    candidates: new Map<string, unknown>(),
    core: new Map<string, unknown>(),
    classes: new Map<string, Set<string>>(),
    alts: new Map<string, string[]>(),
    people: new Map<string, unknown[]>(),
    extra: { include: {}, gsib: { Q3: 'Bank' }, ambiguous: ['Apple'], block: ['Nikola Tesla'], names: {}, people: {} },
    aliasForms: new Set(['Jordan', 'America']),
    leaderNames: new Set(['Donald Trump']),
    countries: new Set(['USA', 'CHN', 'GBR', 'DEU']),
    words: new Set(['apple', 'news', 'future']),
  });
  const add = (input: ReturnType<typeof base>, q: string, o: { label: string; country?: string; revenue?: number; links?: number; listed?: boolean; dissolved?: boolean; cls?: string[]; alts?: string[] }) => {
    input.candidates.set(q, { links: o.links ?? 50, revenue: o.revenue ?? 100e9, marketCap: 0, assets: 0, listed: o.listed ?? false });
    input.core.set(q, { label: o.label, links: o.links ?? 50, hq: [o.country ?? 'USA'], iso: [], dissolved: o.dissolved ?? false });
    if (o.cls) input.classes.set(q, new Set(o.cls));
    if (o.alts) input.alts.set(q, o.alts);
  };

  it('keeps large companies, and drops dissolved ones and excluded classes', () => {
    const input = base();
    add(input, 'Q1', { label: 'Nvidia Corporation', alts: ['NVDA', 'nVidia', 'Nvidia Corp.'] });
    add(input, 'Q2', { label: 'Old Corp', dissolved: true });
    add(input, 'Q4', { label: 'Dow Jones Industrial Average', cls: ['Q223371'] });
    add(input, 'Q5', { label: 'Bitcoin', cls: ['Q13479982'] });
    add(input, 'Q6', { label: 'FC Example', cls: ['Q476028'] });
    add(input, 'Q7', { label: 'Small Co', revenue: 1e9 });
    add(input, 'Q8', { label: 'Listed Co', revenue: 1e9, listed: true, links: 30 });
    const { companies } = b.selectCompanies(input);
    expect(companies.map((c) => c.q).sort()).toEqual(['Q1', 'Q8']);
    expect(companies.find((c) => c.q === 'Q1')!.names).toEqual(['Nvidia', 'Nvidia Corporation', 'nVidia', 'Nvidia Corp.']);
  });

  it('drops country aliases and common words, and marks the curated ambiguous names', () => {
    const input = base();
    add(input, 'Q1', { label: 'Apple Inc.', alts: ['Apple'] });
    add(input, 'Q2', { label: 'News Corp', alts: ['News', 'Jordan'] });
    const { companies, log } = b.selectCompanies(input);
    expect(companies.find((c) => c.q === 'Q1')).toMatchObject({ names: ['Apple', 'Apple Inc.'], ambiguous: ['Apple'] });
    expect(companies.find((c) => c.q === 'Q2')!.names).toEqual(['News Corp']);
    expect(log.join('\n')).toContain('common words that are not company names: News');
  });

  it('gives a shared name to the larger company of one country, and drops it across countries', () => {
    const input = base();
    add(input, 'Q1', { label: 'Volkswagen', country: 'DEU', links: 100, alts: ['VW'] });
    add(input, 'Q2', { label: 'Volkswagen Group', country: 'DEU', links: 60, alts: ['Volkswagen'] });
    add(input, 'Q10', { label: 'Continental AG', country: 'DEU', links: 50, alts: ['Continental'] });
    add(input, 'Q11', { label: 'Continental Airlines', country: 'USA', links: 40, alts: ['Continental'] });
    const { companies } = b.selectCompanies(input);
    const names = (q: string) => companies.find((c) => c.q === q)?.names;
    expect(names('Q1')).toContain('Volkswagen');
    expect(names('Q2')).not.toContain('Volkswagen');
    expect(names('Q10')).not.toContain('Continental');
    expect(names('Q11')).not.toContain('Continental');
  });

  it('a curated name wins a shared name across countries ("Merck" is Merck & Co.)', () => {
    const input = base();
    add(input, 'Q1', { label: 'Merck & Co.', country: 'USA', links: 41 });
    add(input, 'Q2', { label: 'Merck KGaA', country: 'DEU', links: 40, alts: ['Merck'] });
    const { companies } = b.selectCompanies(input);
    expect(companies.find((c) => c.q === 'Q2')!.names).not.toContain('Merck');
    // With no curated name, both lose it.
    expect(companies.find((c) => c.q === 'Q1')!.names).not.toContain('Merck');
    input.extra = { ...input.extra, names: { Q1: ['Merck'] } } as typeof input.extra;
    const curated = b.selectCompanies(input).companies;
    expect(curated.find((c) => c.q === 'Q1')!.names).toContain('Merck');
    expect(curated.find((c) => c.q === 'Q2')!.names).not.toContain('Merck');
  });

  it('lists a must-have company that the output does not have, or that lost its name', () => {
    const input = base();
    add(input, 'Q1', { label: 'Nvidia Corporation' });
    input.extra = { ...input.extra, mustHave: { Q1: 'Nvidia', Q2: 'Netflix' } } as typeof input.extra;
    expect(b.selectCompanies(input).missing).toEqual(['Q2 Netflix']);
    expect(b.missingCompanies([{ q: 'Q1', name: 'Nvidia', names: ['Nvidia'], country: 'USA', people: [] }], { mustHave: { Q1: 'NVIDIA' } })).toEqual(['Q1 NVIDIA']);
  });

  it('keeps people with two words, drops leaders and small-company founders, and gives a person to the larger company', () => {
    const input = base();
    add(input, 'Q1', { label: 'Tesla, Inc.', links: 100, revenue: 100e9 });
    add(input, 'Q2', { label: 'SpaceX', links: 100, revenue: 20e9 });
    add(input, 'Q3', { label: 'Big Bank', links: 20, revenue: 50e9 });
    input.people.set('Q1', [{ name: 'Elon Musk', role: 'ceo', links: 200 }, { name: 'Donald Trump', role: 'chair', links: 300 }]);
    input.people.set('Q2', [{ name: 'Elon Musk', role: 'ceo', links: 200 }, { name: 'Gwynne Shotwell', role: 'founder', links: 10 }]);
    input.people.set('Q3', [{ name: 'Jane Doe', role: 'founder', links: 5 }, { name: 'Madonna', role: 'ceo', links: 90 }]);
    const { companies } = b.selectCompanies(input);
    const people = (q: string) => companies.find((c) => c.q === q)!.people.map((p) => p.name);
    expect(people('Q1')).toEqual(['Elon Musk']);
    expect(people('Q2')).toEqual(['Gwynne Shotwell']);
    expect(people('Q3')).toEqual([]); // a founder of a company with few sitelinks, and a one-word name
    expect(companies.find((c) => c.q === 'Q3')!.gsib).toBe(true);
  });

  it('prints new and removed companies and each change of CEO', () => {
    const old = { companies: [{ q: 'Q1', name: 'Nvidia', names: ['Nvidia'], country: 'USA', people: [{ name: 'Jensen Huang', role: 'ceo', links: 60 }] }, { q: 'Q9', name: 'Gone', names: ['Gone'], country: 'USA', people: [] }] };
    const next = { companies: [{ q: 'Q1', name: 'Nvidia', names: ['Nvidia'], country: 'USA', people: [{ name: 'Colette Kress', role: 'ceo', links: 10 }] }, { q: 'Q2', name: 'New', names: ['New'], country: 'GBR', people: [] }] };
    expect(b.diffCompanies(old, next)).toEqual(['+ Q2 New (GBR)', '- Q9 Gone (USA)', '~ Q1 Nvidia: CEO Jensen Huang -> Colette Kress']);
  });
});
