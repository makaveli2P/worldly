// Page frame: globe container, wordmark, first-use hint and the panel layer.

import { h } from './dom';
import { getLayout, isMobileViewport } from './layout';

/** Dispatch on window after the first drag, click or tap; the hint fades out. */
export const INTERACTED_EVENT = 'worldly:interacted';

export function mountShell(app: HTMLElement): {
  globe: HTMLElement;
  ui: HTMLElement;
  panelInsets(): { left: number; right: number; top: number; bottom: number };
  isMobile(): boolean;
} {
  const globe = h('div', { class: 'globe' });
  const touch = window.matchMedia('(hover: none)').matches;
  const hint = h('p', { class: 'hint' }, touch ? 'Drag to spin · Tap a country' : 'Drag to spin · Click a country');
  const ui = h(
    'div',
    { class: 'ui', 'data-ui-host': true },
    h('h1', { class: 'wordmark' }, 'Worldly'),
    hint,
  );
  app.append(globe, ui);

  const layout = getLayout(ui);
  window.addEventListener(INTERACTED_EVENT, () => hint.setAttribute('data-hidden', ''), { once: true });

  return {
    globe,
    ui,
    panelInsets: () => layout.insets(),
    isMobile: isMobileViewport,
  };
}
