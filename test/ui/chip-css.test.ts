// Guards for the breaking-news chip layout in styles.css. The browser checks at 320 to 1440 px are in
// the Playwright runs; these tests keep the rules that make them pass.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

/** Declarations of every rule whose selector list is exactly `selector`, in source order. */
function rules(selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const sel = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    if (sel === selector) out.push(m[2]);
  }
  return out;
}

describe('breaking-news chip CSS', () => {
  it('lets the country name shrink with an ellipsis in every tier', () => {
    const base = rules('.brk-name').join('\n');
    expect(base).toMatch(/flex:\s*0 1 auto/);
    expect(base).toMatch(/min-width:\s*0/);
    expect(base).toMatch(/text-overflow:\s*ellipsis/);
    // No later rule may make the name rigid again.
    for (const sel of ['.brk-name', '.brk .brk-name']) {
      for (const body of rules(sel)) expect(body).not.toMatch(/flex:\s*none/);
    }
  });

  it('shrinks the headline before the name', () => {
    // A zero basis: the headline takes only the free width, so the name never shrinks while the headline shows.
    expect(rules('.brk-head').join('\n')).toMatch(/flex:\s*1 1 0;/);
  });

  it('keeps the text BREAKING in every tier (colour is not the only signal)', () => {
    for (const m of css.matchAll(/([^{}]+)\{[^{}]*display:\s*none[^{}]*\}/g)) {
      expect(m[1]).not.toMatch(/brk-tag-text/);
    }
  });

  it('moves the chip to a second header row on a tablet, and the plates down with it', () => {
    const tablet = css.slice(css.indexOf('@media (min-width: 768px) and (max-width: 999px)'));
    expect(tablet).toMatch(/:root\[data-breaking\]\s*\{\s*--bar:\s*104px;/);
    expect(tablet).toMatch(/\.bar\[data-breaking\] \.brk-slot\s*\{[^}]*grid-row:\s*2;/);
  });
});
