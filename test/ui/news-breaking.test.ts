// The news plate hides a story that tells the BREAKING row again (review: BGR).

import { describe, expect, it } from 'vitest';
import { tellsAlert } from '../../src/ui/news';

const alert = { url: 'https://www.aljazeera.com/news/2026/11/10/bulgaria-pile-up', headline: 'At least 12 people killed in Bulgaria motorway pile-up' };

describe('tellsAlert', () => {
  it('matches the same headline from another outlet', () => {
    expect(tellsAlert({ url: 'https://example.com/a', title: 'At least 12 people killed in Bulgaria motorway pile-up' }, alert)).toBe(true);
  });

  it('matches the same link, with or without a trailing slash or a hash', () => {
    expect(tellsAlert({ url: `${alert.url}/#top`, title: 'Other words' }, alert)).toBe(true);
  });

  it('does not match another story about the country', () => {
    expect(tellsAlert({ url: 'https://example.com/b', title: "EU pledges €10 million to protect Bulgaria's Black Sea shipping" }, alert)).toBe(false);
  });

  it('does not match a link that differs only in its query', () => {
    const a = { url: 'https://site.example/news.php?id=1', headline: 'Parliament passes the budget' };
    expect(tellsAlert({ url: 'https://site.example/news.php?id=2', title: 'Storm closes the main port' }, a)).toBe(false);
  });
});
