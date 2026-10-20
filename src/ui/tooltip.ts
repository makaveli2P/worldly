// Country name label that follows the cursor. On touch it can also act as a button.

import { h } from './dom';

const OFFSET = 14; // px from the cursor, so the label never covers it
const EDGE = 8; // px kept clear of the viewport edge

export class Tooltip {
  private readonly el: HTMLElement;
  private action: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = h('div', { class: 'tooltip', role: 'tooltip', 'aria-hidden': 'true' });
    this.el.addEventListener('click', () => this.action?.());
    root.append(this.el);
  }

  show(text: string, x: number, y: number): void {
    if (this.el.textContent !== text) this.el.textContent = text;
    this.el.toggleAttribute('data-visible', true);
    const w = this.el.offsetWidth;
    const ht = this.el.offsetHeight;
    let left = x + OFFSET;
    let top = y + OFFSET;
    // Flip to the other side of the cursor when the label would leave the viewport.
    if (left + w > window.innerWidth - EDGE) left = x - OFFSET - w;
    if (top + ht > window.innerHeight - EDGE) top = y - OFFSET - ht;
    left = Math.max(EDGE, left);
    top = Math.max(EDGE, top);
    this.el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  /** With an action, a tap on the label calls it (touch preview). Null makes the label inert again. */
  setAction(action: (() => void) | null): void {
    this.action = action;
    this.el.toggleAttribute('data-action', action !== null);
  }

  hide(): void {
    this.el.removeAttribute('data-visible');
    this.setAction(null);
  }
}
