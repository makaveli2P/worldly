// @vitest-environment happy-dom
// The view preference (Globe | Map): the default, the stored value and html[data-view].

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prefs, VIEW_KEY } from '../../src/ui/prefs';

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.view;
});

describe('Prefs view', () => {
  it('is the globe by default', () => {
    const p = new Prefs();
    expect(p.view).toBe('globe');
    expect(document.documentElement.dataset.view).toBe('globe');
  });

  it('persists the map', () => {
    new Prefs().setView('map');
    expect(localStorage.getItem(VIEW_KEY)).toBe('map');
    expect(new Prefs().view).toBe('map');
    expect(document.documentElement.dataset.view).toBe('map');
  });

  it('reads a bad value as the globe', () => {
    localStorage.setItem(VIEW_KEY, 'cylinder');
    expect(new Prefs().view).toBe('globe');
  });

  it('tells the listeners once per change', () => {
    const p = new Prefs();
    const cb = vi.fn();
    const off = p.onViewChange(cb);
    p.setView('map');
    p.setView('map');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith('map');
    off();
    p.setView('globe');
    expect(cb).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.view).toBe('globe');
  });
});
