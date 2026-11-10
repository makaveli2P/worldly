// Publisher ratings. All tables here are synthetic: no MBFC data is in the repo.
import { describe, expect, it } from 'vitest';
import { createBiasLookup, type BiasRules, type MbfcTable, type StateTable } from '../../api/_lib/bias.js';
import rules from '../../api/_lib/bias-rules.json' with { type: 'json' };
import { hostChain, normalizeHost, publisherHost, registrableDomain } from '../../api/_lib/domain.js';

// Synthetic records with real hosts, built as the builder builds them.
const mbfc: MbfcTable = {
  v: 1,
  generatedAt: '2026-11-01T00:00:00.000Z',
  hosts: {
    'theguardian.com': ['Guardian (test)', -1, 'test-guardian'],
    'cbsnews.com': ['CBS (test)', 1, 'test-cbs'],
    'news24.com': ['News24 SA (test)', 0, 'test-news24'],
    'thedailystar.com': ['Daily Star NY (test)', 0, 'test-daily-star'],
    'thenationalherald.com': ['National Herald US (test)', 2, 'test-national-herald'],
    'tass.com': ['TASS (test)', null, 'test-tass'],
    'foxnews.com': ['Fox News (test)', null, 'test-fox-news'],
    'nolink.example': ['No page (test)', null, ''],
    'timesofisrael.com': ['Times of Israel (test)', 1, 'test-toi'],
    'bbc.com': ['BBC (test)', 0, 'test-bbc'],
    'indiatimes.com': ['India Times (test)', 1, 'test-india-times'],
    'investing.com': ['Investing (test)', 0, 'test-investing'],
    'yahoo.com': ['Yahoo (test)', -1, 'test-yahoo'],
    // Records that the builder drops. Here they test the runtime deny list.
    'news.google.com': ['Google News (test)', 0, 'test-google-news'],
    'medium.com': ['Medium (test)', 0, 'test-medium'],
    // A host clash: the record names another outlet (bias-rules.json wrongRecords).
    'straitstimes.com': ['Other Straits paper (test)', 0, 'test-other-straits'],
  },
};

const state: StateTable = {
  hosts: {
    'tass.com': ['SC', 'SMM-0137', 'TASS', 'RUS'],
    'bbc.co.uk': ['IP', 'SMM-0028', 'BBC', 'GBR'],
    'bbc.com': ['IP', 'SMM-0028', 'BBC', 'GBR'],
    'iol.co.za': ['CaPu', 'SMM-0376', 'Independent Media', 'ZAF'],
  },
};

const lookup = createBiasLookup(mbfc, state, rules as BiasRules);
const noTable = createBiasLookup(null, state, rules as BiasRules);

describe('lookupBias: fixed cases from the review', () => {
  it('theguardian.com -> Lean left, rated by MBFC, with the MBFC page', () => {
    expect(lookup('theguardian.com')).toEqual({
      lean: -1,
      leanLabel: 'Lean left',
      rater: 'MBFC',
      ref: 'https://mediabiasfactcheck.com/test-guardian/',
      state: null,
      stateLabel: null,
    });
  });

  it('cbsnews.com -> the bare-host rating', () => {
    expect(lookup('https://www.cbsnews.com')?.lean).toBe(1);
  });

  it('news24.com.au, thedailystar.net and nationalheraldindia.com -> no rating (no name match)', () => {
    expect(lookup('news24.com.au', 'News24')).toBeNull();
    expect(lookup('thedailystar.net', 'The Daily Star')).toBeNull();
    expect(lookup('nationalheraldindia.com', 'National Herald')).toBeNull();
  });

  it('news.google.com -> no rating, even with a record in the table', () => {
    expect(lookup('news.google.com', 'Google News')).toBeNull();
    expect(lookup('https://news.google.com/rss/articles/abc')).toBeNull();
  });

  it('a subdomain of a denied platform -> no rating', () => {
    expect(lookup('medium.com')).toBeNull();
    expect(lookup('x.medium.com')).toBeNull();
  });

  it('a host on wrongRecords -> no MBFC lean (straitstimes.com)', () => {
    expect(lookup('straitstimes.com')).toBeNull();
  });

  it('Yahoo News: news.yahoo.com and its editions take the yahoo.com record; finance.yahoo.com does not', () => {
    expect(lookup('news.yahoo.com')?.lean).toBe(-1);
    expect(lookup('uk.news.yahoo.com')?.lean).toBe(-1);
    expect(lookup('finance.yahoo.com')).toBeNull();
  });

  it('tass.com -> STATE-CONTROLLED, with no MBFC lean but the MBFC page', () => {
    expect(lookup('tass.com')).toEqual({
      lean: null,
      leanLabel: null,
      rater: 'MBFC',
      ref: 'https://mediabiasfactcheck.com/test-tass/',
      state: 'state-controlled',
      stateLabel: 'STATE-CONTROLLED',
    });
  });

  it('foxnews.com (an MBFC record with no lean, no state tag) still gets a row with the MBFC page', () => {
    expect(lookup('foxnews.com')).toEqual({
      lean: null,
      leanLabel: null,
      rater: 'MBFC',
      ref: 'https://mediabiasfactcheck.com/test-fox-news/',
      state: null,
      stateLabel: null,
    });
  });

  it('an MBFC record with no lean and no page gives no row', () => {
    expect(lookup('nolink.example')).toBeNull();
  });

  it('a blog subdomain gets no rating of the parent outlet', () => {
    expect(lookup('timesofisrael.com')?.lean).toBe(1);
    expect(lookup('blogs.timesofisrael.com')).toBeNull();
  });

  it('bbc.co.uk -> PUBLIC tag, and the lean of bbc.com through the alias', () => {
    const b = lookup('bbc.co.uk');
    expect(b?.state).toBe('public');
    expect(b?.stateLabel).toBe('PUBLIC');
    expect(b?.lean).toBe(0);
    expect(b?.leanLabel).toBe('Centre');
  });

  it('CaPu -> CAPTURED, not STATE-CONTROLLED', () => {
    expect(lookup('iol.co.za')?.stateLabel).toBe('CAPTURED');
  });
});

describe('lookupBias: lookup order', () => {
  it('walks to the parent domain', () => {
    expect(lookup('au.investing.com')?.lean).toBe(0);
  });

  it('does not fall back to indiatimes.com from a Times Group subdomain', () => {
    expect(lookup('economictimes.indiatimes.com')).toBeNull();
    expect(lookup('indiatimes.com')?.lean).toBe(1);
  });

  it('uses the publisher name only when the domain is null, and only from the allowlist', () => {
    expect(lookup(null, 'Yahoo News')?.lean).toBe(-1);
    expect(lookup(null, 'The Guardian')).toBeNull();
    expect(lookup('example.org', 'Yahoo News')).toBeNull();
  });
});

describe('lookupBias with no MBFC table', () => {
  it('gives no lean anywhere, and the state tags still work', () => {
    expect(noTable('theguardian.com')).toBeNull();
    expect(noTable('bbc.co.uk')).toEqual({ lean: null, leanLabel: null, rater: null, ref: null, state: 'public', stateLabel: 'PUBLIC' });
    expect(noTable('tass.com')?.stateLabel).toBe('STATE-CONTROLLED');
  });
});

describe('domain helpers', () => {
  it('normalises hosts', () => {
    expect(normalizeHost('https://www.TheGuardian.com/world')).toBe('theguardian.com');
    expect(normalizeHost('nytimes.com')).toBe('nytimes.com');
    expect(normalizeHost('https://m.economictimes.com')).toBe('economictimes.com');
    expect(normalizeHost('https://www3.nhk.or.jp')).toBe('www3.nhk.or.jp');
    expect(normalizeHost('javascript:alert(1)')).toBeNull();
  });

  it('never takes the publisher from an aggregator link', () => {
    expect(publisherHost('https://news.google.com/rss/articles/x', null)).toBeNull();
    expect(publisherHost('https://news.google.com', 'https://www.reuters.com/x')).toBe('reuters.com');
  });

  it('finds the registrable domain with two-level suffixes', () => {
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(hostChain('edition.cnn.com')).toEqual(['edition.cnn.com', 'cnn.com']);
    expect(hostChain('bbc.co.uk')).toEqual(['bbc.co.uk']);
  });
});
