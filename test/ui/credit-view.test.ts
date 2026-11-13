// The EOX licence needs a visible credit in the Satellite style, on the globe and on the flat map.
// The rules that hide the credit depend only on html[data-style], never on html[data-view].

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule as [selector list, declarations], with the media blocks flattened. */
function rules(): [string, string][] {
  const out: [string, string][] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([m[1].replace(/@media[^{]*\{/g, '').trim(), m[2]]);
  return out;
}

describe('the imagery credit and the view', () => {
  const credit = rules().filter(([sel]) => /\.credit(?![\w-])/.test(sel));

  it('has rules for the credit', () => {
    expect(credit.length).toBeGreaterThan(0);
  });

  it('only data-style hides the credit', () => {
    const hiding = credit.filter(([, body]) => /display:\s*none|visibility:\s*hidden|opacity:\s*0\b/.test(body));
    expect(hiding.length).toBeGreaterThan(0);
    for (const [sel] of hiding) expect(sel).toMatch(/data-style='atlas'/);
  });

  it('no rule for the credit or the readout reads data-view', () => {
    for (const [sel] of rules()) {
      if (/\.credit(?![\w-])|\.readout(?![\w-])/.test(sel)) expect(sel).not.toMatch(/data-view/);
    }
  });
});
