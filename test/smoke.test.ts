import { describe, expect, it } from 'vitest';
import { findCountry } from '../api/_lib/news.js';

describe('findCountry', () => {
  it('finds a country in any case', () => {
    expect(findCountry('jpn')?.id).toBe('JPN');
    expect(findCountry('nope')).toBeNull();
  });
});
