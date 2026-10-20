// Shared panel frame. Desktop: details plate on the left, news plate on the right.
// Mobile: one bottom sheet with the country identity and an "Overview | News" switch.

import { closeButton, h } from './dom';

export type PanelKind = 'details' | 'news';

/** Fired on window when a panel opens or closes, or the layout switches desktop/mobile. */
export const PANELS_CHANGE_EVENT = 'worldly:panelschange';

const MOBILE_QUERY = '(max-width: 767px)';

export function isMobileViewport(): boolean {
  return window.matchMedia(MOBILE_QUERY).matches;
}

interface Slot {
  el: HTMLElement;
  body: HTMLElement;
  open: boolean;
  onClose: () => void;
}

export class PanelLayout {
  readonly el: HTMLElement;
  private readonly slots = new Map<PanelKind, Slot>();
  private readonly tabs: Record<PanelKind, HTMLButtonElement>;
  private tab: PanelKind = 'details';
  private readonly identity: HTMLElement;

  constructor(host: HTMLElement) {
    this.tabs = {
      details: this.tabButton('details', 'Overview'),
      news: this.tabButton('news', 'News'),
    };
    const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Panel' }, this.tabs.details, this.tabs.news);
    tablist.addEventListener('keydown', (e) => this.onTabKey(e));
    this.identity = h('div', { class: 'sheet-id' });
    const head = h(
      'div',
      { class: 'sheet-head' },
      h('div', { class: 'sheet-handle', 'aria-hidden': 'true' }),
      this.identity,
      tablist,
      closeButton('Close', () => this.closeAll()),
    );
    this.enableSwipeDown(head);
    this.el = h('div', { class: 'panels' }, head);
    host.append(this.el);

    window.matchMedia(MOBILE_QUERY).addEventListener('change', () => this.sync());
    this.sync();
  }

  /** Creates the panel frame (close button + scroll body) and returns the body to fill. */
  register(kind: PanelKind, label: string, onClose: () => void): HTMLElement {
    const body = h('div', { class: 'panel-body' });
    const el = h(
      'aside',
      { class: `panel panel--${kind}`, 'aria-label': label, id: `panel-${kind}` },
      closeButton(`Close ${label.toLowerCase()}`, onClose),
      body,
    );
    // Details sits on the left, so it comes first in the Tab order too.
    if (kind === 'details') this.el.querySelector('.sheet-head')!.after(el);
    else this.el.append(el);
    this.slots.set(kind, { el, body, open: false, onClose });
    this.sync();
    return body;
  }

  /** Mobile sheet: the flag and name above the tabs. Null clears it. */
  setIdentity(node: Node | null): void {
    if (node) this.identity.replaceChildren(node);
    else this.identity.replaceChildren();
  }

  setOpen(kind: PanelKind, open: boolean): void {
    const slot = this.slots.get(kind);
    if (!slot || slot.open === open) return;
    slot.open = open;
    if (open) slot.body.scrollTop = 0;
    this.sync();
    window.dispatchEvent(new CustomEvent(PANELS_CHANGE_EVENT));
  }

  insets(): { left: number; right: number; top: number; bottom: number } {
    const out = { left: 0, right: 0, top: 0, bottom: 0 };
    if (isMobileViewport()) {
      if (this.anyOpen()) out.bottom = this.el.offsetHeight;
      return out;
    }
    // offsetLeft/offsetWidth ignore the slide-in transform, so the result is stable mid-animation.
    const details = this.slots.get('details');
    if (details?.open) out.left = details.el.offsetLeft + details.el.offsetWidth;
    const news = this.slots.get('news');
    if (news?.open) out.right = window.innerWidth - news.el.offsetLeft;
    return out;
  }

  /** Screen rects for the leader lines. Mobile: the whole sheet stands in for "details". */
  rects(): { details: DOMRect | null; news: DOMRect | null } {
    if (isMobileViewport()) {
      return { details: this.anyOpen() ? this.el.getBoundingClientRect() : null, news: null };
    }
    const rect = (kind: PanelKind) => {
      const slot = this.slots.get(kind);
      return slot?.open ? slot.el.getBoundingClientRect() : null;
    };
    return { details: rect('details'), news: rect('news') };
  }

  private anyOpen(): boolean {
    for (const s of this.slots.values()) if (s.open) return true;
    return false;
  }

  private tabButton(kind: PanelKind, text: string): HTMLButtonElement {
    const b = h('button', { type: 'button', role: 'tab', id: `tab-${kind}`, 'aria-controls': `panel-${kind}` }, text);
    b.addEventListener('click', () => {
      this.tab = kind;
      this.sync();
    });
    return b;
  }

  /** Arrow keys, Home and End move between the two tabs (WAI-ARIA tabs pattern). */
  private onTabKey(e: KeyboardEvent): void {
    const order: PanelKind[] = ['details', 'news'];
    const i = order.indexOf(this.tab);
    let next: PanelKind | null = null;
    if (e.key === 'ArrowRight') next = order[(i + 1) % order.length];
    else if (e.key === 'ArrowLeft') next = order[(i + order.length - 1) % order.length];
    else if (e.key === 'Home') next = order[0];
    else if (e.key === 'End') next = order[order.length - 1];
    if (!next) return;
    e.preventDefault();
    this.tab = next;
    this.sync();
    this.tabs[this.tab].focus();
  }

  private closeAll(): void {
    // Main treats either close as "deselect"; call the overview one first.
    const s = this.slots.get('details') ?? this.slots.get('news');
    s?.onClose();
  }

  private sync(): void {
    const mobile = isMobileViewport();
    const open = this.anyOpen();
    this.el.toggleAttribute('data-open', open);
    // If the chosen tab has nothing to show, fall back to the other one.
    if (!this.slots.get(this.tab)?.open) {
      const other: PanelKind = this.tab === 'details' ? 'news' : 'details';
      if (this.slots.get(other)?.open) this.tab = other;
    }
    for (const [kind, slot] of this.slots) {
      const visible = mobile ? open && kind === this.tab : slot.open;
      slot.el.toggleAttribute('data-open', slot.open);
      slot.el.toggleAttribute('data-active', kind === this.tab);
      slot.el.inert = !visible;
      slot.el.setAttribute('aria-hidden', String(!visible));
      // Tab panels only where the tabs show. On desktop each panel is a plain labelled landmark.
      if (mobile) {
        slot.el.setAttribute('role', 'tabpanel');
        slot.el.setAttribute('aria-labelledby', `tab-${kind}`);
      } else {
        slot.el.removeAttribute('role');
        slot.el.removeAttribute('aria-labelledby');
      }
    }
    for (const kind of ['details', 'news'] as const) {
      const on = kind === this.tab;
      this.tabs[kind].setAttribute('aria-selected', String(on));
      this.tabs[kind].tabIndex = on ? 0 : -1;
    }
  }

  /** Mobile: drag the sheet head down past 80px to close. */
  private enableSwipeDown(head: HTMLElement): void {
    let startY: number | null = null;
    head.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      startY = e.clientY;
      head.setPointerCapture(e.pointerId);
    });
    head.addEventListener('pointermove', (e) => {
      if (startY === null) return;
      const dy = Math.max(0, e.clientY - startY);
      this.el.style.transform = `translateY(${dy}px)`;
      this.el.style.transition = 'none';
    });
    const end = (e: PointerEvent) => {
      if (startY === null) return;
      const dy = e.clientY - startY;
      startY = null;
      this.el.style.transform = '';
      this.el.style.transition = '';
      if (dy > 80) this.closeAll();
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }
}

const layouts = new WeakMap<HTMLElement, PanelLayout>();

/** One layout per UI host. mountShell marks its host; other roots get their own. */
export function getLayout(root: HTMLElement): PanelLayout {
  const host = (root.closest('[data-ui-host]') as HTMLElement | null) ?? root;
  let layout = layouts.get(host);
  if (!layout) {
    layout = new PanelLayout(host);
    layouts.set(host, layout);
  }
  return layout;
}
