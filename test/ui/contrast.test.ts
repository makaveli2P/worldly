// The colour tokens: styles.css and theme.ts must agree, and every text pair must meet WCAG AA.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { globePalettes, ui } from '../../src/theme';

const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const overlayCss = readFileSync(new URL('../../src/overlay/overlay.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const prefs = readFileSync(new URL('../../src/ui/prefs.ts', import.meta.url), 'utf8');

/** Custom properties of the first rule block that starts with `selector`. */
function tokens(source: string, selector: string): Record<string, string> {
  const start = source.indexOf(selector);
  if (start < 0) throw new Error(`no block ${selector}`);
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const m of source.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim().toLowerCase();
  return out;
}

function luminance(hex: string): number {
  const n = hex.replace('#', '');
  const c = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const shared = tokens(css, ':root {');
const light = { ...shared, ...tokens(css, ":root[data-theme='light']") };
const dark = { ...shared, ...tokens(css, ":root[data-theme='dark']") };
const noScript = tokens(css, ':root:not([data-theme])');

describe('colour tokens', () => {
  it('match theme.ts in both themes', () => {
    for (const [t, theme] of [
      [light, ui.light],
      [dark, ui.dark],
    ] as const) {
      expect(t.paper).toBe(theme.paper.toLowerCase());
      expect(t.panel).toBe(theme.panel.toLowerCase());
      expect(t.ink).toBe(theme.ink.toLowerCase());
      expect(t.rule).toBe(theme.rule.toLowerCase());
      expect(t.muted).toBe(theme.muted.toLowerCase());
      expect(t.accent).toBe(theme.accent.toLowerCase());
    }
  });

  it('repeat the dark values in the no-script block', () => {
    for (const k of Object.keys(tokens(css, ":root[data-theme='dark']"))) {
      expect(noScript[k], k).toBe(dark[k]);
    }
  });

  it('give the globe the canvas colour', () => {
    for (const t of ['light', 'dark'] as const) {
      for (const s of ['satellite', 'atlas'] as const) expect(globePalettes[t][s].paper).toBe(ui[t].paper);
      expect(globePalettes[t].atlas.recede).toBe(ui[t].paper);
    }
  });

  it('keep the overlay halo paper in step', () => {
    const o = [...overlayCss.matchAll(/--wo-paper:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
    expect(o).toEqual([light.paper, dark.paper]);
  });

  it('use the canvas and muted colours as the first-paint fallbacks in index.html', () => {
    const fallbacks = (name: string) => [...html.matchAll(new RegExp(`var\\(--${name}, (#[0-9a-f]{6})\\)`, 'gi'))].map((m) => m[1].toLowerCase());
    expect(fallbacks('paper')).toEqual([ui.light.paper.toLowerCase(), ui.dark.paper.toLowerCase()]);
    expect(fallbacks('muted')).toEqual([ui.light.muted.toLowerCase(), ui.dark.muted.toLowerCase()]);
  });

  it('set theme-color to the header (panel) colour in all three places', () => {
    // The static value is the default (dark) theme. The boot script and prefs.ts change it for light.
    expect(html).toContain(`name="theme-color" content="${ui.dark.panel}"`);
    expect(html).toContain(`t === 'dark' ? '${ui.dark.panel}' : '${ui.light.panel}'`);
    expect(prefs).toContain(`{ light: '${ui.light.panel}', dark: '${ui.dark.panel}' }`);
  });
});

describe('contrast (WCAG 2.x)', () => {
  // Text pairs: AA for normal text is 4.5:1.
  const text: [fg: string, bg: string][] = [
    ['ink', 'panel'],
    ['ink', 'paper'],
    ['ink', 'hover'],
    ['muted', 'panel'],
    ['muted', 'paper'],
    ['muted', 'hover'],
    ['faint', 'panel'],
    ['faint', 'hover'],
    ['accent-text', 'panel'],
    ['accent-text', 'hover'],
    ['on-ink', 'ink'],
  ];
  for (const [name, t] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const [fg, bg] of text) {
      it(`${name}: ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`${name}: the ink frame is at least 3:1 on the canvas and on the panel`, () => {
      expect(contrast(t.ink, t.paper)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.ink, t.panel)).toBeGreaterThanOrEqual(3);
    });
    it(`${name}: the plate is lighter than the canvas by more than before`, () => {
      expect(contrast(t.panel, t.paper)).toBeGreaterThan(name === 'light' ? 1.2 : 1.1);
    });
    it(`${name}: the alert tag text (on-alert on alert) is at least 4.5:1`, () => {
      expect(contrast(t['on-alert'], t.alert)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('the alert yellow or its ink keyline is at least 3:1 on every canvas', () => {
    for (const bg of [light.paper, dark.paper, light.panel, dark.panel, '#d9d9d4', '#13202e']) {
      expect(Math.max(contrast('#ffb800', bg), contrast('#111111', bg))).toBeGreaterThanOrEqual(3);
    }
  });
});
