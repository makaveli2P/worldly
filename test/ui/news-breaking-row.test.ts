// @vitest-environment happy-dom
// C6: the BREAKING row of the news plate shows the source and the age of the article it links to.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NewsPanel } from '../../src/ui/news';
import type { BreakingAlert } from '../../src/types';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const ALERT: BreakingAlert = {
  key: 'BGR-accident-20261110', country: 'BGR', level: 'major', kind: 'accident', headline: 'Motorway pile-up kills 12',
  url: 'https://www.dw.com/a', source: 'DW', publishedAt: iso(25), since: iso(6 * 60), updatedAt: iso(25), outlets: 3, basis: ['news'],
};

describe('the BREAKING row of the news plate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    document.body.replaceChildren();
  });
  afterEach(() => vi.useRealTimers());

  it('C6: the time and the label give the article age, not the first report', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const panel = new NewsPanel(root, { onClose: () => {} });
    panel.setBreaking(ALERT);
    const link = document.querySelector<HTMLAnchorElement>('.news-brk-link')!;
    const time = link.querySelector('time')!;
    expect([time.getAttribute('datetime'), time.textContent]).toEqual([iso(25), '25m']);
    expect(link.getAttribute('href')).toBe('https://www.dw.com/a');
    expect(link.getAttribute('aria-label')).toBe('Breaking news, major: Motorway pile-up kills 12. DW, 25 minutes ago. First reported 6 hours ago. Opens in a new tab.');
  });

  it('an alert from an older server (no publishedAt) shows the first report, as before', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const panel = new NewsPanel(root, { onClose: () => {} });
    const { publishedAt: _p, ...old } = ALERT;
    panel.setBreaking(old);
    expect(document.querySelector('.news-brk-link time')!.textContent).toBe('6h');
  });
});
