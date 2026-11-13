// @vitest-environment happy-dom
// The rotation of the breaking-news chip (BreakingBar) in a DOM: the timer, the pause rules, reduced motion,
// the "+N" list, a dismiss, a new story and the live region.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BreakingBar, type BreakingBarOptions } from '../../src/ui/alerts';
import { ROTATE_MS } from '../../src/ui/alerts-model';
import type { BreakingAlert } from '../../src/types';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();

function alert(key: string, country: string, p: Partial<BreakingAlert> = {}): BreakingAlert {
  return {
    key,
    country,
    level: 'major',
    kind: 'disaster',
    headline: `News from ${country}`,
    url: `https://example.com/${key}`,
    source: 'BBC News',
    since: iso(30),
    updatedAt: iso(10),
    outlets: 3,
    basis: ['news'],
    ...p,
  };
}

// Sort order: UKR (critical), then JPN (newer), then LBN.
const UKR = alert('u', 'UKR', { level: 'critical', kind: 'conflict', since: iso(12) });
const JPN = alert('j', 'JPN', { updatedAt: iso(20) });
const LBN = alert('l', 'LBN', { kind: 'attack', updatedAt: iso(60) });
const FRA = alert('f', 'FRA', { kind: 'politics', updatedAt: iso(90) });
const names: Record<string, string> = { UKR: 'Ukraine', JPN: 'Japan', LBN: 'Lebanon', FRA: 'France' };

let reduced = false;
let visibility: DocumentVisibilityState = 'visible';
let bar: BreakingBar;
let slot: HTMLElement;
let live: HTMLElement;
let previews: string[];
let rotations: string[];
let changes: { keys: string[]; fresh: string[] }[];

function setup(): void {
  document.body.replaceChildren();
  const header = document.createElement('header');
  header.className = 'bar';
  slot = document.createElement('div');
  slot.className = 'brk-slot';
  header.append(slot);
  const outside = document.createElement('button');
  outside.id = 'outside';
  document.body.append(header, outside);
  previews = [];
  rotations = [];
  changes = [];
  const opts: BreakingBarOptions = {
    nameOf: (id) => names[id] ?? null,
    resolve: (id) => (names[id] ? id : null),
    onSelect: () => {},
    onPreview: (a) => previews.push(a.country),
    onRotate: (a) => rotations.push(a.country),
    onChange: (alerts, fresh) => changes.push({ keys: alerts.map((a) => a.key), fresh: [...fresh] }),
    focusFallback: () => {},
  };
  bar = new BreakingBar(slot, document.body, opts);
  live = document.body.querySelector('[aria-live]')!;
}

/** The key of the alert in the chip, from the chip and from the visible text layer. */
function shownKey(): string | undefined {
  const chip = slot.querySelector<HTMLElement>('.brk');
  const on = slot.querySelectorAll<HTMLElement>('.brk-item[data-on]');
  expect(on.length).toBe(1);
  expect(on[0].dataset.item).toBe(chip?.dataset.key);
  return chip?.dataset.key;
}

const main = () => slot.querySelector<HTMLElement>('.brk-main')!;
const more = () => slot.querySelector<HTMLElement>('.brk-more');
const rows = () => [...slot.querySelectorAll<HTMLElement>('.brk-row')].map((r) => r.dataset.key);
const tick = (ms: number) => vi.advanceTimersByTime(ms);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  reduced = false;
  visibility = 'visible';
  sessionStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduced-motion') && reduced,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  setup();
});

afterEach(() => {
  bar.destroy();
  vi.useRealTimers();
});

describe('BreakingBar rotation', () => {
  it('shows the next alert every ROTATE_MS in sort order, and wraps', () => {
    bar.set([LBN, JPN, UKR]);
    expect(shownKey()).toBe('u');
    tick(ROTATE_MS - 1);
    expect(shownKey()).toBe('u');
    tick(1);
    expect(shownKey()).toBe('j');
    tick(ROTATE_MS);
    expect(shownKey()).toBe('l');
    tick(ROTATE_MS);
    expect(shownKey()).toBe('u');
  });

  it('pulses the map marker one time per change, and keeps the chip name and level right', () => {
    bar.set([UKR, JPN, LBN]);
    tick(ROTATE_MS);
    // onRotate (one ring cycle), not onPreview (3 cycles, as on a hover).
    expect(rotations).toEqual(['JPN']);
    expect(previews).toEqual([]);
    expect(main().getAttribute('aria-label')).toMatch(/^Breaking news, major, Japan: News from JPN/);
    // The tooltip names the source and the age of the article. (Before: the headline only.)
    expect(main().title).toBe('News from JPN — BBC News, 30m ago');
    expect(slot.querySelector('.brk')!.getAttribute('data-level')).toBe('major');
    expect(slot.querySelector('.brk-main > .brk-tag')!.getAttribute('data-level')).toBe('major');
    expect(slot.querySelector('.brk-open')!.getAttribute('href')).toBe('https://example.com/j');
    expect(slot.querySelector('.brk-x')!.getAttribute('aria-label')).toBe('Dismiss breaking news for Japan');
    tick(ROTATE_MS);
    expect(rotations).toEqual(['JPN', 'LBN']);
  });

  it('does not rotate with 0 or 1 alert', () => {
    bar.set([UKR]);
    tick(ROTATE_MS * 3);
    expect(shownKey()).toBe('u');
    expect(rotations).toEqual([]);
    // holdDropped keeps the alert for one more poll.
    bar.set([]);
    bar.set([]);
    tick(ROTATE_MS * 3);
    expect(slot.children.length).toBe(0);
  });

  it('keeps the chip elements: only the text layers change', () => {
    bar.set([UKR, JPN, LBN]);
    const chip = slot.querySelector('.brk');
    const tag = slot.querySelector('.brk-main > .brk-tag');
    tick(ROTATE_MS);
    expect(slot.querySelector('.brk')).toBe(chip);
    expect(slot.querySelector('.brk-main > .brk-tag')).toBe(tag);
    expect(slot.querySelectorAll('.brk-item').length).toBe(3);
  });

  it('does not change the live region when it rotates', () => {
    bar.set([UKR, JPN, LBN]);
    const said = live.textContent;
    expect(said).toBe('Breaking news in 3 countries: Ukraine, Japan and Lebanon.');
    tick(ROTATE_MS);
    expect(shownKey()).toBe('j');
    expect(live.textContent).toBe(said);
    // The live region clears after 10 s, and a later rotation does not fill it again.
    tick(ROTATE_MS * 2);
    expect(shownKey()).toBe('u');
    expect(live.textContent).toBe('');
    expect(slot.closest('[aria-live]')).toBeNull();
    expect(slot.querySelector('[aria-live]')).toBeNull();
  });

  it('shows N = count - 1 and lists the other alerts', () => {
    bar.set([UKR, JPN, LBN]);
    expect(more()!.textContent).toBe('+2');
    expect(more()!.getAttribute('aria-label')).toBe('2 more breaking alerts');
    expect(rows()).toEqual(['j', 'l']);
    tick(ROTATE_MS);
    expect(more()!.textContent).toBe('+2');
    expect(rows()).toEqual(['u', 'l']);
  });
});

describe('BreakingBar pause rules', () => {
  beforeEach(() => bar.set([UKR, JPN, LBN]));

  it('pauses while the pointer is over the chip, then waits a full interval', () => {
    slot.dispatchEvent(new Event('pointerenter'));
    tick(ROTATE_MS * 3);
    expect(shownKey()).toBe('u');
    slot.dispatchEvent(new Event('pointerleave'));
    tick(ROTATE_MS - 1);
    expect(shownKey()).toBe('u');
    tick(1);
    expect(shownKey()).toBe('j');
  });

  it('pauses while focus is in the chip', () => {
    main().focus();
    tick(ROTATE_MS * 3);
    expect(shownKey()).toBe('u');
    expect(document.activeElement).toBe(main());
    document.getElementById('outside')!.focus();
    tick(ROTATE_MS);
    expect(shownKey()).toBe('j');
  });

  it('pauses while the +N list is open', () => {
    more()!.click();
    expect(slot.querySelector('.brk-list')!.hasAttribute('hidden')).toBe(false);
    tick(ROTATE_MS * 3);
    expect(shownKey()).toBe('u');
    // A pointerdown outside closes the list.
    document.getElementById('outside')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(slot.querySelector('.brk-list')!.hasAttribute('hidden')).toBe(true);
    tick(ROTATE_MS);
    expect(shownKey()).toBe('j');
  });

  it('pauses while the page is hidden', () => {
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    tick(ROTATE_MS * 3);
    expect(shownKey()).toBe('u');
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    tick(ROTATE_MS);
    expect(shownKey()).toBe('j');
  });
});

describe('BreakingBar with reduced motion', () => {
  it('shows the top alert and does not rotate', () => {
    reduced = true;
    bar.destroy();
    setup();
    bar.set([JPN, UKR, LBN]);
    tick(ROTATE_MS * 3);
    expect(shownKey()).toBe('u');
    expect(rotations).toEqual([]);
    expect(more()!.textContent).toBe('+2');
  });
});

describe('BreakingBar list changes', () => {
  it('shows the next alert at once when the alert on screen is dismissed', () => {
    bar.set([UKR, JPN, LBN]);
    tick(ROTATE_MS);
    expect(shownKey()).toBe('j');
    slot.querySelector<HTMLElement>('.brk-x')!.click();
    expect(shownKey()).toBe('l');
    expect(more()!.textContent).toBe('+1');
    expect(rows()).toEqual(['u']);
    expect(changes.at(-1)!.keys).toEqual(['u', 'l']);
  });

  it('wraps to the top when the last alert on screen is dismissed', () => {
    bar.set([UKR, JPN, LBN]);
    tick(ROTATE_MS * 2);
    expect(shownKey()).toBe('l');
    slot.querySelector<HTMLElement>('.brk-x')!.click();
    expect(shownKey()).toBe('u');
  });

  it('keeps focus in the open list after a dismiss from the list, when the chip shows a lower alert', () => {
    bar.set([UKR, JPN, LBN]);
    tick(ROTATE_MS * 2);
    expect(shownKey()).toBe('l');
    more()!.click();
    expect(rows()).toEqual(['u', 'j']);
    slot.querySelector<HTMLElement>('.brk-row[data-key="j"] .brk-x')!.click();
    expect(shownKey()).toBe('l');
    expect(slot.querySelector('.brk-list')!.hasAttribute('hidden')).toBe(false);
    expect(rows()).toEqual(['u']);
    const active = document.activeElement as HTMLElement;
    expect(active.closest('.brk-list')).not.toBeNull();
    expect(active.dataset.focus).toBe('main:u');
  });

  it('moves focus to the next row after a dismiss of the top row from the list', () => {
    bar.set([UKR, JPN, LBN]);
    tick(ROTATE_MS);
    expect(shownKey()).toBe('j');
    more()!.click();
    expect(rows()).toEqual(['u', 'l']);
    slot.querySelector<HTMLElement>('.brk-row[data-key="u"] .brk-x')!.click();
    expect(shownKey()).toBe('j');
    expect(rows()).toEqual(['l']);
    const active = document.activeElement as HTMLElement;
    expect(active.closest('.brk-list')).not.toBeNull();
    expect(active.dataset.focus).toBe('main:l');
  });

  it('moves focus to the chip when a dismiss from the list leaves no row', () => {
    bar.set([UKR, JPN]);
    tick(ROTATE_MS);
    expect(shownKey()).toBe('j');
    more()!.click();
    slot.querySelector<HTMLElement>('.brk-row[data-key="u"] .brk-x')!.click();
    expect(shownKey()).toBe('j');
    expect(slot.querySelector('.brk-list')).toBeNull();
    expect(document.activeElement).toBe(main());
  });

  it('keeps the alert on screen when a poll still has it', () => {
    bar.set([UKR, JPN, LBN]);
    tick(ROTATE_MS);
    bar.set([UKR, JPN]);
    expect(shownKey()).toBe('j');
  });

  it('shows the top alert when the alert on screen leaves the feed', () => {
    bar.set([UKR, JPN, LBN]);
    tick(ROTATE_MS);
    // holdDropped keeps a dropped alert for one more poll.
    bar.set([UKR, LBN]);
    bar.set([UKR, LBN]);
    expect(shownKey()).toBe('u');
  });

  it('shows a new story at once, and announces it one time', () => {
    bar.set([UKR, JPN]);
    bar.set([UKR, JPN, FRA]);
    expect(changes.at(-1)!.fresh).toEqual(['f']);
    expect(shownKey()).toBe('f');
    expect(live.textContent).toBe('Breaking news in France: News from FRA.');
    expect(rows()).toEqual(['u', 'j']);
    tick(ROTATE_MS);
    expect(shownKey()).toBe('u');
    expect(live.textContent).toBe('Breaking news in France: News from FRA.');
  });

  it('updates the age of the alert on screen', () => {
    bar.set([UKR, JPN, LBN]);
    tick(ROTATE_MS);
    const age = () => slot.querySelector('.brk-item[data-on] time.brk-age')!.textContent;
    const before = age();
    tick(60 * 60_000);
    expect(age()).not.toBe(before);
    expect(main().getAttribute('aria-label')).toContain('hour');
  });
});

describe('the article age in the chip', () => {
  it('C3: the age, the label and the tooltip describe the article; "first reported" names the first report', () => {
    const bgr = alert('b', 'JPN', { headline: 'Motorway pile-up kills 12', source: 'DW', publishedAt: iso(25), since: iso(6 * 60), updatedAt: iso(25) });
    bar.set([bgr]);
    const time = slot.querySelector('.brk-item[data-on] time.brk-age')!;
    expect([time.getAttribute('datetime'), time.textContent]).toEqual([iso(25), '25m']);
    expect(main().getAttribute('aria-label')).toBe(
      'Breaking news, major, Japan: Motorway pile-up kills 12. DW, 25 minutes ago. First reported 6 hours ago. Show on the globe.',
    );
    expect(main().title).toBe('Motorway pile-up kills 12 — DW, 25m ago · first reported 6h ago');
    expect(slot.querySelector('.brk-open')!.getAttribute('title')).toBe('Read at DW');
  });

  it('C3: "first reported" is left out when the story is less than 1 h older than the article', () => {
    bar.set([alert('b', 'JPN', { headline: 'Motorway pile-up kills 12', source: 'DW', publishedAt: iso(25), since: iso(60) })]);
    expect(main().getAttribute('aria-label')).toBe('Breaking news, major, Japan: Motorway pile-up kills 12. DW, 25 minutes ago. Show on the globe.');
  });

  it('an article with no date shows no age', () => {
    bar.set([alert('b', 'JPN', { publishedAt: null })]);
    expect(slot.querySelector('time.brk-age')).toBeNull();
    expect(main().getAttribute('aria-label')).toBe('Breaking news, major, Japan: News from JPN. BBC News. Show on the globe.');
  });

  it('the rows of the + list show the article age', () => {
    bar.set([UKR, alert('j', 'JPN', { publishedAt: iso(5), since: iso(200) })]);
    slot.querySelector<HTMLElement>('.brk-more')!.click();
    const row = slot.querySelector<HTMLElement>('.brk-row[data-key="j"]')!;
    expect(row.querySelector('time.brk-age')!.textContent).toBe('5m');
    expect(row.querySelector('.brk-row-main')!.getAttribute('aria-label')).toContain('First reported 3 hours ago.');
  });
});
