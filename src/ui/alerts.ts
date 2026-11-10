// Breaking-news chip in the header. Desktop: grid column 2. Mobile: a third header row.
// It shows the most severe alert: BREAKING, the country, the headline (cut to fit) and the age.
// "+N" opens a list of the other alerts. A click selects the country; × dismisses the alert for the session.
// A polite live region announces each new alert key once. With no alert, the slot is empty.

import type { CountryId } from '../types';
import type { BreakingAlert } from './alerts-types';
import { closeIcon, h, svgIcon } from './dom';
import { age } from './format';
import {
  ANNOUNCED_KEY,
  DISMISSED_KEY,
  SessionSet,
  ageWords,
  announcement,
  sameView,
  sessionStore,
  stripBadge,
  visibleAlerts,
  withBadge,
} from './alerts-model';

export type { BreakingAlert, BreakingResponse, BreakingLevel, BreakingKind } from './alerts-types';
export { startBreakingFeed, type BreakingFeedOptions } from './alerts-feed';

/** Three blinks of the chip dot, 1.6 s each, plus a margin. */
const PULSE_MS = 3 * 1600 + 200;
const LIVE_CLEAR_MS = 10_000;
const AGE_TICK_MS = 60_000;
const OPEN_ICON = 'M6 3.5H3.5v9h9V10M9 3.5h3.5V7M12.5 3.5 7 9';

export interface BreakingBarOptions {
  nameOf: (id: CountryId) => string | null;
  /** Maps a wire id to a known country id, or null to drop the alert. */
  resolve: (id: string) => CountryId | null;
  /** A click on an alert: select its country and turn the globe there. */
  onSelect: (alert: BreakingAlert) => void;
  /** Hover or focus on an alert: the map marker may pulse again. */
  onPreview: (alert: BreakingAlert) => void;
  /**
   * The alerts on screen changed (a poll or a dismiss). Most severe first. `fresh` holds the keys
   * that are new in this session: only these pulse on the map.
   */
  onChange: (alerts: readonly BreakingAlert[], fresh: ReadonlySet<string>) => void;
  /** Focus target when the last alert is dismissed (not the search field: on mobile it opens the keyboard). */
  focusFallback: () => void;
}

export class BreakingBar {
  private readonly bar: HTMLElement | null;
  private readonly live: HTMLElement;
  private readonly dismissed: SessionSet;
  private readonly announced: SessionSet;
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  private all: BreakingAlert[] = [];
  private shown: BreakingAlert[] = [];
  private listOpen = false;
  private ageTimer = 0;
  private liveTimer = 0;
  private pulseTimer = 0;
  private pulseKey: string | null = null;
  /** A new top alert that came while the page was hidden: its dot blinks when the page is visible. */
  private heldPulse: string | null = null;
  private queued = '';
  private unseen = 0;
  private previewKey: string | null = null;

  constructor(
    private readonly slot: HTMLElement,
    liveHost: HTMLElement,
    private readonly opts: BreakingBarOptions,
  ) {
    this.bar = slot.closest<HTMLElement>('.bar');
    const store = sessionStore();
    this.dismissed = new SessionSet(DISMISSED_KEY, store);
    this.announced = new SessionSet(ANNOUNCED_KEY, store);
    // The live region exists, empty, before the first message (screen readers watch it from the start).
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    liveHost.append(this.live);

    slot.addEventListener('click', (e) => this.onClick(e));
    slot.addEventListener('pointerover', (e) => this.onPreview(e));
    slot.addEventListener('focusin', (e) => this.onPreview(e));
    // One preview per hover or focus of an alert, not one per pointer move.
    slot.addEventListener('pointerleave', () => (this.previewKey = null));
    slot.addEventListener('focusout', (e) => {
      // A control that a re-render removed is not a real focus change.
      if (!(e.target as Node).isConnected) return;
      if (!slot.contains(e.relatedTarget as Node | null)) this.previewKey = null;
    });
    // Esc closes the list only. The listener is on window in the capture phase: Safari does not focus a
    // button on a click, so after a click on +N the key goes to <body>, and main would close the selection.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || !this.listOpen) return;
        const active = document.activeElement;
        if (active && active !== document.body && !slot.contains(active)) return;
        e.stopPropagation();
        e.preventDefault();
        this.setListOpen(false);
        slot.querySelector<HTMLElement>('.brk-more')?.focus();
      },
      { capture: true },
    );
    document.addEventListener('pointerdown', (e) => {
      if (this.listOpen && !slot.contains(e.target as Node)) this.setListOpen(false);
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (this.unseen > 0) {
        this.unseen = 0;
        document.title = stripBadge(document.title);
      }
      if (this.queued) {
        const msg = this.queued;
        this.queued = '';
        this.say(msg);
      }
      if (this.heldPulse) {
        const key = this.heldPulse;
        this.heldPulse = null;
        if (this.shown[0]?.key === key) this.pulse(key);
      }
    });
  }

  /** A new list from the feed. Dismissed keys and unknown countries drop out. */
  set(alerts: readonly BreakingAlert[]): void {
    this.all = [...alerts];
    this.refresh(true);
  }

  /** The alerts on screen, most severe first. */
  visible(): readonly BreakingAlert[] {
    return this.shown;
  }

  // ---------- state ----------

  private refresh(fromFeed: boolean): void {
    const prev = this.shown;
    const list = visibleAlerts(this.all, this.dismissed.asSet(), this.opts.resolve);
    this.shown = list;
    const fresh = fromFeed ? list.filter((a) => !this.announced.has(a.key)) : [];
    if (list.length < 2) this.listOpen = false;
    // A poll with the same list changes nothing in the DOM: a focused control stays, and a screen
    // reader does not read it again.
    if (sameView(prev, list)) this.tickAges();
    else this.render();

    if (fresh.length > 0) {
      this.announced.add(...fresh.map((a) => a.key));
      const msg = announcement(fresh, this.opts.nameOf);
      const hidden = document.visibilityState === 'hidden';
      if (hidden) {
        this.queued = msg;
        this.unseen += fresh.length;
        document.title = withBadge(document.title, this.unseen);
      } else {
        this.say(msg);
      }
      // The chip dot blinks when its alert is new, and only on a visible page.
      if (list[0] && fresh.some((a) => a.key === list[0].key)) {
        if (hidden) this.heldPulse = list[0].key;
        else this.pulse(list[0].key);
      }
    }

    const same =
      prev.length === list.length &&
      prev.every((a, i) => a.key === list[i].key && a.level === list[i].level && a.country === list[i].country);
    if (!same) this.opts.onChange(list, new Set(fresh.map((a) => a.key)));

    clearInterval(this.ageTimer);
    this.ageTimer = list.length > 0 ? window.setInterval(() => this.tickAges(), AGE_TICK_MS) : 0;
  }

  /**
   * Updates the age text and the accessible names in place, with no new DOM. The focused control keeps
   * its name until it loses focus (a name change on the focused control makes a screen reader read it again).
   */
  private tickAges(): void {
    const now = Date.now();
    const active = document.activeElement;
    for (const a of this.shown) {
      const btn = this.slot.querySelector<HTMLElement>(`[data-focus="main:${CSS.escape(a.key)}"]`);
      if (!btn) continue;
      const time = btn.querySelector('time.brk-age');
      const text = age(a.since, now) ?? '';
      if (time && time.textContent !== text) time.textContent = text;
      const label = this.label(a, now);
      if (btn !== active && btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
    }
  }

  private dismiss(key: string): void {
    const i = this.shown.findIndex((a) => a.key === key);
    this.dismissed.add(key);
    this.refresh(false);
    // Focus goes to the next alert, or to the globe when none is left.
    const next = this.shown[Math.min(Math.max(i, 0), this.shown.length - 1)];
    const target = next ? this.slot.querySelector<HTMLElement>(`[data-focus="main:${CSS.escape(next.key)}"]`) : null;
    if (target) target.focus();
    else this.opts.focusFallback();
  }

  private say(msg: string): void {
    clearTimeout(this.liveTimer);
    this.live.textContent = msg;
    this.liveTimer = window.setTimeout(() => (this.live.textContent = ''), LIVE_CLEAR_MS);
  }

  private pulse(key: string): void {
    if (this.reduced.matches || document.visibilityState !== 'visible') return;
    this.pulseKey = key;
    clearTimeout(this.pulseTimer);
    this.slot.querySelector('.brk')?.setAttribute('data-pulse', '');
    this.pulseTimer = window.setTimeout(() => {
      this.pulseKey = null;
      this.slot.querySelector('.brk')?.removeAttribute('data-pulse');
    }, PULSE_MS);
  }

  private setListOpen(open: boolean): void {
    if (open === this.listOpen) return;
    this.listOpen = open;
    this.render();
  }

  // ---------- events ----------

  private alertOf(el: Element | null): BreakingAlert | null {
    const key = el?.closest<HTMLElement>('[data-key]')?.dataset.key;
    return key ? (this.shown.find((a) => a.key === key) ?? null) : null;
  }

  private onClick(e: MouseEvent): void {
    const t = e.target as Element;
    const btn = t.closest<HTMLElement>('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'more') {
      this.setListOpen(!this.listOpen);
      return;
    }
    const a = this.alertOf(btn);
    if (!a) return;
    if (act === 'select') {
      this.setListOpen(false);
      this.opts.onSelect(a);
    } else if (act === 'dismiss') {
      this.dismiss(a.key);
    }
    // act === 'open' is a plain link: the browser opens it.
  }

  private onPreview(e: Event): void {
    const el = (e.target as Element).closest('[data-act="select"]');
    const a = el ? this.alertOf(el) : null;
    if (!a || a.key === this.previewKey) return;
    this.previewKey = a.key;
    this.opts.onPreview(a);
  }

  // ---------- DOM ----------

  private render(): void {
    const list = this.shown;
    if (list.length === 0) {
      this.slot.replaceChildren();
      this.bar?.removeAttribute('data-breaking');
      document.documentElement.removeAttribute('data-breaking');
      return;
    }
    // Keep keyboard focus on the same control across a re-render.
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && this.slot.contains(active) ? active.dataset.focus : undefined;

    const now = Date.now();
    const first = list[0];
    const rest = list.slice(1);
    const chip = h(
      'section',
      {
        class: 'brk',
        'aria-label': 'Breaking news',
        'data-level': first.level,
        'data-key': first.key,
        'data-pulse': this.pulseKey === first.key,
      },
      h(
        'button',
        {
          type: 'button',
          class: 'brk-main',
          'data-act': 'select',
          'data-focus': `main:${first.key}`,
          'aria-label': this.label(first, now),
          title: first.headline,
        },
        this.tag(first),
        h('span', { class: 'brk-name' }, this.name(first)),
        h('span', { class: 'brk-head' }, first.headline),
        this.age(first, now),
      ),
      h(
        'a',
        {
          class: 'brk-btn brk-open',
          href: first.url,
          target: '_blank',
          rel: 'noopener noreferrer',
          'data-act': 'open',
          'data-focus': `open:${first.key}`,
          'aria-label': `Read the story${first.source ? ` at ${first.source}` : ''} (opens in a new tab)`,
          title: first.source ? `Read at ${first.source}` : 'Read the story',
        },
        svgIcon(OPEN_ICON, 14),
      ),
      rest.length > 0 &&
        h(
          'button',
          {
            type: 'button',
            class: 'brk-btn brk-more',
            'data-act': 'more',
            'data-focus': 'more',
            'aria-expanded': String(this.listOpen),
            'aria-controls': 'brk-list',
            'aria-label': `${rest.length} more breaking ${rest.length === 1 ? 'alert' : 'alerts'}`,
          },
          `+${rest.length}`,
        ),
      h(
        'button',
        {
          type: 'button',
          class: 'brk-btn brk-x',
          'data-act': 'dismiss',
          'data-focus': `x:${first.key}`,
          'aria-label': `Dismiss breaking news for ${this.name(first)}`,
          title: 'Dismiss',
        },
        closeIcon(),
      ),
    );
    const nodes: Node[] = [chip];
    if (rest.length > 0) {
      const ul = h('ul', { class: 'brk-list', id: 'brk-list', 'aria-label': 'More breaking news', hidden: !this.listOpen });
      for (const a of rest) {
        ul.append(
          h(
            'li',
            { class: 'brk-row', 'data-level': a.level, 'data-key': a.key },
            h(
              'button',
              {
                type: 'button',
                class: 'brk-row-main',
                'data-act': 'select',
                'data-focus': `main:${a.key}`,
                'aria-label': this.label(a, now),
              },
              h('span', { class: 'brk-row-top' }, this.tag(a), h('span', { class: 'brk-name' }, this.name(a)), this.age(a, now)),
              h('span', { class: 'brk-row-head' }, a.headline),
            ),
            h(
              'a',
              {
                class: 'brk-btn brk-open',
                href: a.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                'data-act': 'open',
                'data-focus': `open:${a.key}`,
                'aria-label': `Read the story${a.source ? ` at ${a.source}` : ''} (opens in a new tab)`,
              },
              svgIcon(OPEN_ICON, 14),
            ),
            h(
              'button',
              {
                type: 'button',
                class: 'brk-btn brk-x',
                'data-act': 'dismiss',
                'data-focus': `x:${a.key}`,
                'aria-label': `Dismiss breaking news for ${this.name(a)}`,
              },
              closeIcon(),
            ),
          ),
        );
      }
      nodes.push(ul);
    }
    this.slot.replaceChildren(...nodes);
    this.bar?.setAttribute('data-breaking', '');
    // On a tablet the header grows by a row: the plates (top: var(--top)) move down with it.
    document.documentElement.setAttribute('data-breaking', '');
    if (focusId) this.slot.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusId)}"]`)?.focus();
  }

  private name(a: BreakingAlert): string {
    return this.opts.nameOf(a.country) ?? a.country;
  }

  /** "BREAKING" with a dot. Critical: a yellow fill. Major: a yellow dot on the panel colour. */
  private tag(a: BreakingAlert): HTMLElement {
    return h(
      'span',
      { class: 'brk-tag', 'data-level': a.level, 'aria-hidden': 'true' },
      h('i', { class: 'brk-dot' }),
      h('span', { class: 'brk-tag-text' }, 'BREAKING'),
    );
  }

  private age(a: BreakingAlert, now: number): HTMLElement {
    return h('time', { class: 'brk-age', datetime: a.since, 'aria-hidden': 'true' }, age(a.since, now) ?? '');
  }

  private label(a: BreakingAlert, now: number): string {
    const level = a.level === 'critical' ? 'critical' : 'major';
    const when = ageWords(a.since, now);
    return `Breaking news, ${level}, ${this.name(a)}: ${a.headline}${when ? `, ${when}` : ''}. Show on the globe.`;
  }
}
