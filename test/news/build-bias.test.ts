// The table builder in scripts/build-bias.mjs. Synthetic records in the RapidAPI shape; no network.
import { describe, expect, it } from 'vitest';
import rules from '../../api/_lib/bias-rules.json' with { type: 'json' };

interface Builder {
  mapLean(v: unknown): number | null | undefined;
  mbfcSlug(v: unknown): string;
  splitSourceUrl(v: unknown): { host: string; path: string } | null;
  buildMbfcTable(
    records: Record<string, unknown>[],
    rules: unknown,
  ): { table: { v: 1; hosts: Record<string, [string, number | null, string]> }; stats: Record<string, number>; unknown: Map<string, number> };
  parseCsv(text: string): Record<string, string>[];
  buildStateTable(rows: Record<string, string>[], map: Record<string, string[]>): { table: { hosts: Record<string, string[]> }; warnings: string[] };
}

// A path in a variable, so the type checker does not need a declaration for the .mjs module.
const builderPath = '../../scripts/build-bias.mjs';
const b = (await import(/* @vite-ignore */ builderPath)) as Builder;

const rec = (source: string, url: string, bias: string, slug = 'x') => ({
  Source: source,
  'MBFC URL': `https://mediabiasfactcheck.com/${slug}/`,
  Bias: bias,
  Country: 'Test',
  'Factual Reporting': 'High',
  'Media Type': 'Website',
  'Source URL': url,
  Credibility: 'High',
  'Source ID#': 1,
});

describe('mapLean', () => {
  it('maps the documented and the likely values', () => {
    expect(b.mapLean('Left')).toBe(-2);
    expect(b.mapLean('Left-Center')).toBe(-1);
    expect(b.mapLean('left-center bias')).toBe(-1);
    expect(b.mapLean('Least Biased')).toBe(0);
    expect(b.mapLean('CENTER')).toBe(0);
    expect(b.mapLean('Right-Center Bias')).toBe(1);
    expect(b.mapLean('Right')).toBe(2);
    expect(b.mapLean('Extreme Right')).toBe(2);
  });

  it('gives null for known values with no lean, and undefined for unknown values', () => {
    expect(b.mapLean('Questionable')).toBeNull();
    expect(b.mapLean('Conspiracy-Pseudoscience')).toBeNull();
    expect(b.mapLean('Satire')).toBeNull();
    expect(b.mapLean('Pro-Science')).toBeNull();
    expect(b.mapLean('Right Questionable')).toBe(2);
    expect(b.mapLean('Sideways')).toBeUndefined();
    expect(b.mapLean(42)).toBeUndefined();
  });
});

describe('buildMbfcTable', () => {
  const records = [
    rec('CBS', 'cbsnews.com', 'Right-Center', 'cbs'),
    rec('CBS Atlanta', 'cbsnews.com/atlanta', 'Left-Center', 'cbs-atlanta'),
    rec('Paper A', 'https://www.papera.com/politics', 'Left'),
    rec('Paper A 2', 'papera.com/sport', 'Left'),
    rec('Paper B', 'paperb.com/one', 'Left'),
    rec('Paper B 2', 'paperb.com/two', 'Right'),
    rec('Google News', 'news.google.com', 'Left-Center'),
    rec('NHK', 'nhk.or.jp', 'Right-Center', 'nhk'),
    rec('NHK World', 'nhk.or.jp/nhkworld', 'Left-Center', 'nhk-world'),
    rec('Odd', 'odd.com', 'Sideways'),
    { Source: 'No URL', Bias: 'Left' },
  ];
  const { table, unknown, stats } = b.buildMbfcTable(records, rules);

  it('keeps the bare-host record and drops path records', () => {
    expect(table.hosts['cbsnews.com']).toEqual(['CBS', 1, 'cbs']);
  });

  it('keeps path records only when the host has no bare record and they agree', () => {
    expect(table.hosts['papera.com']?.[1]).toBe(-2);
    expect(table.hosts['paperb.com']).toBeUndefined();
  });

  it('drops hosts on the deny list', () => {
    expect(table.hosts['news.google.com']).toBeUndefined();
  });

  it('maps www3.nhk.or.jp to the NHK World record', () => {
    expect(table.hosts['nhk.or.jp']).toEqual(['NHK', 1, 'nhk']);
    expect(table.hosts['www3.nhk.or.jp']).toEqual(['NHK World', -1, 'nhk-world']);
  });

  it('logs an unknown bias value and stores no lean for it', () => {
    expect(unknown.get('Sideways')).toBe(1);
    expect(table.hosts['odd.com']?.[1]).toBeNull();
    expect(stats.skipped).toBe(1);
  });

  it('stores only the slug of an MBFC page', () => {
    expect(b.mbfcSlug('https://mediabiasfactcheck.com/the-guardian/')).toBe('the-guardian');
    expect(b.mbfcSlug('https://example.com/the-guardian/')).toBe('');
  });
});

describe('State Media Monitor join', () => {
  const csv = [
    'smm_id,iso3,entity,main_assets,class_2026,status_2026',
    'SMM-0137,RUS,TASS,"News agency: TASS, wire",SC,Active',
    'SMM-0028,GBR,British Broadcasting Corporation (BBC),"TV, radio",IP,Active',
    'SMM-0376,ZAF,Independent Media,Papers,CaPu,Active',
    'SMM-9999,XXX,Gone,Old,SC,Removed',
  ].join('\n');

  it('parses quoted fields', () => {
    const rows = b.parseCsv(csv);
    expect(rows).toHaveLength(4);
    expect(rows[0].main_assets).toBe('News agency: TASS, wire');
  });

  it('joins by smm_id and skips inactive or unknown ids', () => {
    const { table, warnings } = b.buildStateTable(b.parseCsv(csv), {
      'SMM-0137': ['tass.com', 'tass.ru'],
      'SMM-0028': ['bbc.co.uk'],
      'SMM-9999': ['gone.example'],
      'SMM-0000': ['missing.example'],
    });
    expect(table.hosts['tass.com']).toEqual(['SC', 'SMM-0137', 'TASS', 'RUS']);
    expect(table.hosts['bbc.co.uk'][0]).toBe('IP');
    expect(table.hosts['gone.example']).toBeUndefined();
    expect(warnings).toHaveLength(2);
  });
});
