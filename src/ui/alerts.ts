// Breaking-news chip in the header. Desktop: grid column 2. Mobile: a third header row.
// It shows one alert: BREAKING, the country, the headline (cut to fit) and the age of that article. The headline,
// the link, the source and the age all come from one article. With 2 or more alerts, the
// chip shows the next alert every ROTATE_MS, in sortAlerts order. Hover, focus, the open list, a hidden page
// and reduced motion stop the rotation. "+N" opens a list of the other alerts. A click selects the country; × dismisses the alert for the session.
// A polite live region announces each new story once. With no alert, the slot is empty.
// A story keeps its identity when its key moves at 00:00 UTC (sameStory), and an alert stays on screen
// for one more poll after it drops out of the feed (holdDropped).

import type { BreakingAlert, CountryId } from '../types';
import { closeIcon, h, svgIcon } from './dom';
import { age } from './format';
import {
  ANNOUNCED_KEY,
  DISMISSED_KEY,
  NO_ALERTS,
  ROTATE_MS,
  StorySet,
  ageWords,
  announcement,
  articleTime,
  firstReportedWords,
  holdDropped,
  newStories,
  nextIndex,
  sameView,
  sessionStore,
  shownIndex,
  stripBadge,
  visibleAlerts,
  withBadge,
  type HeldAlerts,
} from './alerts-model';

export type { BreakingAlert, BreakingResponse, BreakingLevel, BreakingKind } from '../types';
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
  /** The chip shows the next alert (a rotation): the map marker may pulse one time. */
  onRotate: (alert: BreakingAlert) => void;
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
  private readonly dismissed: StorySet;
  private readonly announced: StorySet;
  private readonly reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  /** The feed list, plus the alerts that holdDropped keeps for one more poll. */
  private held: HeldAlerts = NO_ALERTS;
  private shown: BreakingAlert[] = [];
  /** The index in `shown` of the alert in the chip. */
  private at = 0;
  private listOpen = false;
  /** The pointer is over the chip or the list. */
  private hover = false;
  /** Focus is in the chip or the list. */
  private focusIn = false;
  private rotateTimer = 0;
  private ageTimer = 0;
  private liveTimer = 0;
  private pulseTimer = 0;
  private pulseKey: string | null = null;
  /** A new top alert that came while the page was hidden: its dot blinks when the page is visible. */
  private heldPulse: string | null = null;
  private queued = '';
  private unseen = 0;
  private previewKey: string | null = null;
  /** Removes the window and document listeners in destroy(). */
  private readonly ac = new AbortController();

  constructor(
    private readonly slot: HTMLElement,
    liveHost: HTMLElement,
    private readonly opts: BreakingBarOptions,
  ) {
    this.bar = slot.closest<HTMLElement>('.bar');
    const store = sessionStore();
    this.dismissed = new StorySet(DISMISSED_KEY, store);
    this.announced = new StorySet(ANNOUNCED_KEY, store);
    // The live region exists, empty, before the first message (screen readers watch it from the start).
    this.live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
    liveHost.append(this.live);
    const signal = this.ac.signal;

    slot.addEventListener('click', (e) => this.onClick(e));
    slot.addEventListener('pointerover', (e) => this.onPreview(e));
    slot.addEventListener('focusin', (e) => {
      this.focusIn = true;
      this.schedule();
      this.onPreview(e);
    });
    slot.addEventListener('pointerenter', () => {
      this.hover = true;
      this.schedule();
    });
    // One preview per hover or focus of an alert, not one per pointer move.
    slot.addEventListener('pointerleave', () => {
      this.previewKey = null;
      this.hover = false;
      this.schedule();
    });
    slot.addEventListener('focusout', (e) => {
      // A control that a re-render removed is not a real focus change.
      if (!(e.target as Node).isConnected) return;
      if (slot.contains(e.relatedTarget as Node | null)) return;
      this.previewKey = null;
      this.focusIn = false;
      this.schedule();
    });
    // Reduced motion: the chip shows the top alert and does not rotate.
    this.reduced.addEventListener(
      'change',
      () => {
        this.at = 0;
        this.paint();
        this.schedule();
      },
      { signal },
    );
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
      { capture: true, signal },
    );
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (this.listOpen && !slot.contains(e.target as Node)) this.setListOpen(false);
      },
      { signal },
    );
    // The alerts pulse until the user does something on the page (a click, a tap, a key or a scroll).
    // A new alert makes them pulse again (see refresh).
    const calm = () => setAlertsCalm(true);
    for (const type of ['pointerdown', 'keydown', 'wheel'] as const) {
      window.addEventListener(type, calm, { capture: true, passive: true, signal });
    }
    document.addEventListener(
      'visibilitychange',
      () => {
        // A hidden page does not rotate. On a return, the alert on screen stays for a full ROTATE_MS.
        this.schedule();
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
          if (this.current()?.key === key) this.pulse(key);
        }
      },
      { signal },
    );
  }

  /** A new list from the feed. Dismissed stories and unknown countries drop out. */
  set(alerts: readonly BreakingAlert[]): void {
    this.held = holdDropped(this.held, alerts);
    this.refresh(true);
  }

  /** The alerts on screen, most severe first. */
  visible(): readonly BreakingAlert[] {
    return this.shown;
  }

  /** Stops the timers and the listeners, and removes the chip. */
  destroy(): void {
    this.ac.abort();
    for (const t of [this.rotateTimer, this.liveTimer, this.pulseTimer]) clearTimeout(t);
    clearInterval(this.ageTimer);
    this.shown = [];
    this.render();
    this.live.remove();
  }

  // ---------- state ----------

  private refresh(fromFeed: boolean): void {
    const prev = this.shown;
    const prevAt = this.at;
    // A known story under a new key (00:00 UTC) stays dismissed or announced under that key too.
    this.dismissed.follow(this.held.alerts);
    this.announced.follow(this.held.alerts);
    const list = visibleAlerts(this.held.alerts, this.dismissed, this.opts.resolve);
    this.shown = list;
    const fresh = fromFeed ? newStories(list, this.announced) : [];
    // A new story shows at once, but not while focus is in the chip: the focused control must stay.
    this.at = shownIndex(prev[prevAt] ?? null, list, this.focusIn ? [] : fresh);
    if (list.length < 2) this.listOpen = false;
    // A poll with the same list changes nothing in the DOM: a focused control stays, and a screen
    // reader does not read it again.
    if (sameView(prev, list)) {
      if (this.at !== prevAt) this.paint();
      this.tickAges();
    } else this.render();

    if (fresh.length > 0) {
      setAlertsCalm(false);
      this.announced.add(...fresh);
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
      const cur = this.current();
      if (cur && fresh.some((a) => a.key === cur.key)) {
        if (hidden) this.heldPulse = cur.key;
        else this.pulse(cur.key);
      }
    }

    const same =
      prev.length === list.length &&
      prev.every((a, i) => a.key === list[i].key && a.level === list[i].level && a.country === list[i].country);
    if (!same) this.opts.onChange(list, new Set(fresh.map((a) => a.key)));

    clearInterval(this.ageTimer);
    this.ageTimer = list.length > 0 ? window.setInterval(() => this.tickAges(), AGE_TICK_MS) : 0;
    this.schedule();
  }

  /** The alert in the chip. With reduced motion, it is always the top alert. */
  private current(): BreakingAlert | undefined {
    return this.shown[this.reduced.matches ? 0 : this.at] ?? this.shown[0];
  }

  /** Starts a full ROTATE_MS wait when the chip can rotate. Else it stops the wait. */
  private schedule(): void {
    clearTimeout(this.rotateTimer);
    this.rotateTimer = 0;
    const paused =
      this.hover || this.focusIn || this.listOpen || this.reduced.matches || document.visibilityState !== 'visible';
    if (this.shown.length < 2 || paused) return;
    this.rotateTimer = window.setTimeout(() => this.rotate(), ROTATE_MS);
  }

  private rotate(): void {
    this.at = nextIndex(this.at, this.shown.length);
    this.paint();
    // The map marker of the new alert pulses one time (not 3 times, as on a hover). The camera does not move.
    const cur = this.current();
    if (cur) this.opts.onRotate(cur);
    this.schedule();
  }

  /**
   * Updates the age text and the accessible names in place, with no new DOM. The focused control keeps
   * its name until it loses focus (a name change on the focused control makes a screen reader read it again).
   */
  private tickAges(): void {
    const now = Date.now();
    const active = document.activeElement;
    for (const time of this.slot.querySelectorAll('time.brk-age')) {
      const text = age(time.getAttribute('datetime') ?? '', now) ?? '';
      if (time.textContent !== text) time.textContent = text;
    }
    for (const btn of this.slot.querySelectorAll<HTMLElement>('[data-act="select"]')) {
      const a = this.alertOf(btn);
      const label = a ? this.label(a, now) : null;
      if (label && btn !== active && btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label);
      const title = a ? this.tooltip(a, now) : null;
      if (title && btn.title && btn.title !== title) btn.title = title;
    }
  }

  private dismiss(key: string): void {
    const i = this.shown.findIndex((a) => a.key === key);
    const before = this.current();
    const inChip = i >= 0 && this.shown[i] === before;
    // The position of the alert in the "+N" list. The list holds all alerts except the alert in the chip.
    const row = this.shown.filter((a) => a !== before).findIndex((a) => a.key === key);
    if (i >= 0) this.dismissed.add(this.shown[i]);
    // The alert in the chip goes away: the next alert shows at once.
    if (inChip) this.at = nextIndex(i, this.shown.length);
    this.refresh(false);
    // From the list, focus goes to the row at the same position. From the chip, or when no row is left,
    // focus goes to the chip. When no alert is left, focus goes to the globe.
    const chipAlert = this.current();
    const rows = this.listOpen ? this.shown.filter((a) => a !== chipAlert) : [];
    const next = inChip || rows.length === 0 ? chipAlert : rows[Math.min(Math.max(row, 0), rows.length - 1)];
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
    this.schedule();
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
    const cur = this.current();
    if (!cur) {
      this.slot.replaceChildren();
      this.bar?.removeAttribute('data-breaking');
      document.documentElement.removeAttribute('data-breaking');
      return;
    }
    // Keep keyboard focus on the same control across a re-render.
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && this.slot.contains(active) ? active.dataset.focus : undefined;

    const now = Date.now();
    const more = list.length - 1;
    const chip = h(
      'section',
      { class: 'brk', 'aria-label': 'Breaking news' },
      h(
        'button',
        { type: 'button', class: 'brk-main', 'data-act': 'select' },
        this.tag(cur),
        // All alerts are in one grid cell, and only the alert on screen is visible. So the chip is as wide
        // as the widest alert, and its width does not change when it rotates.
        h(
          'span',
          { class: 'brk-stack' },
          list.map((a) =>
            h(
              'span',
              { class: 'brk-item', 'data-item': a.key },
              h('span', { class: 'brk-name' }, this.name(a)),
              h('span', { class: 'brk-head' }, a.headline),
              this.age(a, now),
            ),
          ),
        ),
      ),
      h(
        'a',
        { class: 'brk-btn brk-open', target: '_blank', rel: 'noopener noreferrer', 'data-act': 'open' },
        svgIcon(OPEN_ICON, 14),
      ),
      more > 0 &&
        h(
          'button',
          {
            type: 'button',
            class: 'brk-btn brk-more',
            'data-act': 'more',
            'data-focus': 'more',
            'aria-expanded': String(this.listOpen),
            'aria-controls': 'brk-list',
            'aria-label': `${more} more breaking ${more === 1 ? 'alert' : 'alerts'}`,
          },
          `+${more}`,
        ),
      h('button', { type: 'button', class: 'brk-btn brk-x', 'data-act': 'dismiss', title: 'Dismiss' }, closeIcon()),
    );
    const nodes: Node[] = [chip];
    if (more > 0) {
      nodes.push(h('ul', { class: 'brk-list', id: 'brk-list', 'aria-label': 'More breaking news', hidden: !this.listOpen }));
    }
    this.slot.replaceChildren(...nodes);
    this.paint();
    this.bar?.setAttribute('data-breaking', '');
    // On a tablet the header grows by a row: the plates (top: var(--top)) move down with it.
    document.documentElement.setAttribute('data-breaking', '');
    if (focusId) this.slot.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusId)}"]`)?.focus();
    // A focused control that the re-render removed sends no focusout.
    this.focusIn = this.slot.contains(document.activeElement);
  }

  /**
   * Shows the alert at `at` in the chip, and puts the other alerts in the list. The chip elements stay, so
   * only the alert text fades (CSS) and the BREAKING dot does not start again.
   */
  private paint(): void {
    const cur = this.current();
    const chip = this.slot.querySelector<HTMLElement>('.brk');
    if (!cur || !chip) return;
    const now = Date.now();
    const set = (sel: string, attrs: Record<string, string>) => {
      const el = chip.querySelector(sel);
      for (const [k, v] of Object.entries(attrs)) el?.setAttribute(k, v);
    };
    chip.dataset.level = cur.level;
    chip.dataset.key = cur.key;
    chip.toggleAttribute('data-pulse', this.pulseKey === cur.key);
    set('.brk-main > .brk-tag', { 'data-level': cur.level });
    set('.brk-main', { 'data-focus': `main:${cur.key}`, 'aria-label': this.label(cur, now), title: this.tooltip(cur, now) });
    set('.brk-open', {
      href: cur.url,
      'data-focus': `open:${cur.key}`,
      'aria-label': this.openLabel(cur),
      title: cur.source ? `Read at ${cur.source}` : 'Read the story',
    });
    set('.brk-x', { 'data-focus': `x:${cur.key}`, 'aria-label': `Dismiss breaking news for ${this.name(cur)}` });
    for (const el of chip.querySelectorAll<HTMLElement>('.brk-item')) el.toggleAttribute('data-on', el.dataset.item === cur.key);
    this.slot.querySelector('.brk-list')?.replaceChildren(...this.shown.filter((a) => a !== cur).map((a) => this.row(a, now)));
  }

  /** One row of the "+N" list. */
  private row(a: BreakingAlert, now: number): HTMLElement {
    return h(
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
          'aria-label': this.openLabel(a),
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
    );
  }

  private openLabel(a: BreakingAlert): string {
    return `Read the story${a.source ? ` at ${a.source}` : ''} (opens in a new tab)`;
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

  /** The age of the article of the alert ("25m"). An article with no date shows no age. */
  private age(a: BreakingAlert, now: number): HTMLElement | false {
    const t = articleTime(a);
    return !!t && h('time', { class: 'brk-age', datetime: t, 'aria-hidden': 'true' }, age(t, now) ?? '');
  }

  /** "Breaking news, major, Bulgaria: <headline>. DW, 25 minutes ago. First reported 6 hours ago. Show on the globe." */
  private label(a: BreakingAlert, now: number): string {
    const level = a.level === 'critical' ? 'critical' : 'major';
    const t = articleTime(a);
    const said = [a.source, t ? ageWords(t, now) : null].filter(Boolean).join(', ');
    const first = firstReportedWords(a, now);
    const head = a.headline.replace(/[.!?…]+$/, '');
    return `Breaking news, ${level}, ${this.name(a)}: ${head}.${said ? ` ${said[0].toUpperCase()}${said.slice(1)}.` : ''}${first ? ` First reported ${first}.` : ''} Show on the globe.`;
  }

  /** The tooltip of the chip: "<headline> — DW, 25m ago · first reported 6h ago". */
  private tooltip(a: BreakingAlert, now: number): string {
    const t = articleTime(a);
    const when = t ? age(t, now) : null;
    const said = [a.source, when && `${when}${when === 'now' ? '' : ' ago'}`].filter(Boolean).join(', ');
    const firstAge = firstReportedWords(a, now) ? age(a.since, now) : null;
    return `${a.headline}${said ? ` — ${said}` : ''}${firstAge ? ` · first reported ${firstAge} ago` : ''}`;
  }
}

/** The attribute on <html> that stops the steady pulse of the alerts after a user action. */
export const CALM_ATTR = 'data-alerts-calm';

/** Stops (true) or starts (false) the steady pulse of the map rings and the chip dots. */
export function setAlertsCalm(calm: boolean): void {
  document.documentElement.toggleAttribute(CALM_ATTR, calm);
}
