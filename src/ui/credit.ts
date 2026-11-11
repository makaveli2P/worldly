// Credit line for the satellite imagery. The EOX licence (CC BY-NC-SA 4.0) requires the attribution
// to be clearly visible on the map. Desktop: one line under the readout, in the same bar.
// Mobile (< 768px): a short button that opens the full text (the EOX terms allow this in compact UIs).
// CSS hides the credit when the atlas style is on (:root[data-style='atlas']).

import { TEXTURE_ATTRIBUTION } from '../globe/textureManifest';
import { h } from './dom';

/** The licence notice of the texture files (licence, attribution, and what was modified). */
export const TEXTURE_LICENCE_URL = '/textures/LICENSE.md';
export const TEXTURE_LICENCE_NAME = 'CC BY-NC-SA 4.0';

/**
 * Splits the attribution at its first URL, so the URL can be a link and the visible text stays word for word.
 * Returns [before, url, after]; url is '' when the text has no URL.
 */
export function splitAttribution(text: string): [string, string, string] {
  const m = /https?:\/\/\S+/.exec(text);
  if (!m) return [text, '', ''];
  return [text.slice(0, m.index), m[0], text.slice(m.index + m[0].length)];
}

let ids = 0;

/** Builds the credit element. The readout bar holds it (src/ui/readout.ts). */
export function creditElement(): HTMLElement {
  const [before, url, after] = splitAttribution(TEXTURE_ATTRIBUTION);
  const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);
  const textId = `credit-text-${++ids}`;
  const text = h(
    'span',
    { class: 'credit-text', id: textId },
    before,
    url ? link(url, url) : null,
    after,
    ' · ',
    link(TEXTURE_LICENCE_URL, TEXTURE_LICENCE_NAME),
  );
  const toggle = h(
    'button',
    { type: 'button', class: 'credit-toggle', 'aria-expanded': 'false', 'aria-controls': textId },
    'Imagery: EOX',
    h('span', { class: 'credit-i', 'aria-hidden': 'true' }, 'i'),
  );
  const el = h('p', { class: 'credit' }, toggle, text);
  const setOpen = (open: boolean) => {
    toggle.setAttribute('aria-expanded', String(open));
    if (open) el.setAttribute('data-open', '');
    else el.removeAttribute('data-open');
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  // Close the mobile pop-up on a tap elsewhere or on Escape.
  document.addEventListener('pointerdown', (e) => {
    if (el.hasAttribute('data-open') && !el.contains(e.target as Node)) setOpen(false);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.hasAttribute('data-open')) {
      e.stopPropagation();
      setOpen(false);
      toggle.focus();
    }
  });
  return el;
}
