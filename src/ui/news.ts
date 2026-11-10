// Right plate (desktop) / "News" tab (mobile): top stories for one country, numbered 01-05.
// When the country has a live breaking alert, one BREAKING row sits above the stories (setBreaking).

import type { BreakingAlert, NewsArticle, NewsProvider, NewsResponse } from '../types';
import { ageWords, sameView } from './alerts-model';
import { h } from './dom';
import { age, utcTime } from './format';
import { getLayout, type PanelLayout } from './layout';

const PROVIDER_LABEL: Record<NewsProvider, string> = {
  google: 'Google News',
  newsdata: 'NewsData.io',
  gdelt: 'GDELT',
  feeds: 'publisher feeds',
};

const pad2 = (n: number) => String(n).padStart(2, '0');
const AGE_TICK_MS = 60_000;

export class NewsPanel {
  private readonly layout: PanelLayout;
  private readonly body: HTMLElement;
  // The header stays in place across renders, so focus on it survives a reload of the list.
  private readonly country = h('span', { class: 'sr-only' });
  private readonly heading = h('h2', { tabindex: -1 }, 'Top stories', this.country);
  private readonly count = h('span', { class: 'news-count mono', 'aria-hidden': 'true' });
  private readonly content = h('div', { class: 'news-content' });
  // The BREAKING row. It stays in place across the loading, list and error states of the stories.
  private readonly breaking = h('div', { class: 'news-brk-slot' });
  private alert: BreakingAlert | null = null;
  private ageTimer = 0;
  /** The list on screen, so a change of the BREAKING row can show it again without its duplicate. */
  private shown: { res: NewsResponse; countryName: string } | null = null;

  constructor(root: HTMLElement, opts: { onClose: () => void }) {
    this.layout = getLayout(root);
    this.body = this.layout.register('news', 'News', opts.onClose);
    this.body.append(h('header', { class: 'news-h' }, this.heading, this.count), this.breaking, this.content);
  }

  /**
   * The live alert of the shown country, or null. The row shows the BREAKING tag, the headline as a link
   * to the story (new tab), the source and the age. The same alert again changes no DOM, so focus stays.
   */
  setBreaking(alert: BreakingAlert | null): void {
    const prev = this.alert;
    if (!prev && !alert) return;
    if (prev && alert && sameView([prev], [alert])) {
      this.tickAge();
      return;
    }
    this.alert = alert;
    clearInterval(this.ageTimer);
    this.ageTimer = 0;
    this.refilter(prev);
    if (!alert) {
      this.breaking.replaceChildren();
      return;
    }
    // Keep keyboard focus on the link when a new poll changes the alert.
    const hadFocus = this.breaking.contains(document.activeElement);
    const now = Date.now();
    const link = h(
      'a',
      {
        class: 'news-brk-link',
        href: alert.url,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': this.breakingLabel(alert, now),
      },
      h(
        'span',
        { class: 'news-brk-top' },
        h(
          'span',
          { class: 'brk-tag', 'data-level': alert.level, 'aria-hidden': 'true' },
          h('i', { class: 'brk-dot' }),
          h('span', { class: 'brk-tag-text' }, 'BREAKING'),
        ),
        h(
          'span',
          { class: 'meta', 'aria-hidden': 'true' },
          alert.source && h('span', { class: 'src' }, alert.source),
          h('time', { class: 't mono', datetime: alert.since }, age(alert.since, now) ?? ''),
        ),
      ),
      h('span', { class: 'news-brk-head', 'aria-hidden': 'true' }, alert.headline),
    );
    this.breaking.replaceChildren(h('section', { class: 'news-brk', 'data-level': alert.level, 'aria-label': 'Breaking news' }, link));
    if (hadFocus) link.focus({ preventScroll: true });
    this.ageTimer = window.setInterval(() => this.tickAge(), AGE_TICK_MS);
  }

  /** Updates the age text in place. The focused link keeps its name until it loses focus. */
  private tickAge(): void {
    const a = this.alert;
    if (!a) return;
    const now = Date.now();
    const time = this.breaking.querySelector('time');
    const text = age(a.since, now) ?? '';
    if (time && time.textContent !== text) time.textContent = text;
    const link = this.breaking.querySelector('a');
    const label = this.breakingLabel(a, now);
    if (link && link !== document.activeElement && link.getAttribute('aria-label') !== label) link.setAttribute('aria-label', label);
  }

  /** Shows the list again when the story that the BREAKING row repeats changes. Focus in the list goes to the heading. */
  private refilter(prev: BreakingAlert | null): void {
    const shown = this.shown;
    if (!shown) return;
    const hidden = (alert: BreakingAlert | null) => this.visible(shown.res.articles, alert).length;
    if (hidden(prev) === hidden(this.alert)) return;
    const hadFocus = this.content.contains(document.activeElement);
    this.show(shown.res, shown.countryName);
    if (hadFocus) this.heading.focus({ preventScroll: true });
  }

  /** The stories to show: the list without a story that tells the BREAKING row again (same link or headline). */
  private visible(articles: readonly NewsArticle[], alert: BreakingAlert | null): NewsArticle[] {
    const list = articles.slice(0, 5);
    if (!alert) return list;
    const rest = list.filter((a) => !tellsAlert(a, alert));
    // The row is the story: when it is the only story, keep the list as it is.
    return rest.length > 0 ? rest : list;
  }

  private breakingLabel(a: BreakingAlert, now: number): string {
    const when = ageWords(a.since, now);
    const tail = [a.source, when].filter(Boolean).join(', ');
    return `Breaking news, ${a.level}: ${a.headline}${tail ? `. ${tail}` : ''}. Opens in a new tab.`;
  }

  showLoading(countryName: string): void {
    this.shown = null;
    const rows = Array.from({ length: 5 }, (_, i) =>
      h(
        'li',
        { class: 'story story--skeleton', 'aria-hidden': 'true' },
        h('span', { class: 'n mono' }, pad2(i + 1)),
        h('span', { class: 'story-main' }, h('span', { class: 'sk sk--meta' }), h('span', { class: 'sk' }), h('span', { class: 'sk sk--short' })),
      ),
    );
    this.render(countryName, '', h('ol', { class: 'stories', 'aria-busy': 'true', 'aria-label': 'Loading stories' }, rows), null);
  }

  show(res: NewsResponse, countryName: string): void {
    this.shown = { res, countryName };
    const articles = this.visible(res.articles, this.alert);
    if (articles.length === 0) {
      this.render(countryName, '00', h('p', { class: 'note' }, 'No recent coverage.'), this.footer(res));
      return;
    }
    const now = Date.now();
    const items = articles.map((a, i) => {
      const when = age(a.publishedAt, now);
      const lang = a.lang ? a.lang.toLowerCase() : null;
      const tr = translationOf(a);
      const outlets = typeof a.outlets === 'number' && a.outlets >= 3 ? a.outlets : null;
      const trRow = tr && translationRow(a, tr);
      const rating = ratingRow(a);
      const cls = ['story', rating && 'story--rated', trRow && 'story--tr'].filter(Boolean).join(' ');
      return h(
        'li',
        { class: cls },
        h(
          'a',
          { class: 'story-link', href: a.url, target: '_blank', rel: 'noopener noreferrer' },
          h('span', { class: 'n mono', 'aria-hidden': 'true' }, pad2(i + 1)),
          h(
            'span',
            { class: 'story-main' },
            h(
              'span',
              { class: 'meta' },
              h('span', { class: 'src' }, a.source),
              h(
                'span',
                { class: 'meta-r' },
                tr
                  ? [
                      h('span', { class: 'lang-tag lang-tag--tr mono', title: tr.note, 'aria-hidden': 'true' }, `${tr.code} → EN`),
                      h('span', { class: 'sr-only' }, `, ${tr.note}, `),
                    ]
                  : lang && [
                      h('span', { class: 'lang-tag mono', title: `Title in ${languageName(lang)}`, 'aria-hidden': 'true' }, lang.slice(0, 2).toUpperCase()),
                      h('span', { class: 'sr-only' }, `, in ${languageName(lang)}, `),
                    ],
                outlets !== null && h('span', { class: 'outlets mono' }, `${outlets} outlets`),
                when && h('span', { class: 't mono' }, when),
              ),
            ),
            // A translated title is English; a hover on it shows the original.
            h('span', { class: 'story-title', lang: tr ? 'en' : (lang ?? null), title: tr ? tr.original : null }, a.title),
          ),
        ),
        trRow,
        rating,
      );
    });
    this.render(countryName, pad2(articles.length), h('ol', { class: 'stories' }, items), this.credits(articles), this.footer(res));
  }

  /** Attribution for the ratings and the translations, only for the data that the list shows. */
  private credits(articles: NewsArticle[]): HTMLElement | null {
    const lean = articles.some((a) => a.bias?.rater === 'MBFC');
    const state = articles.some((a) => a.bias?.state);
    const translated = articles.some((a) => translationOf(a));
    if (!lean && !state && !translated) return null;
    const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
    return h(
      'p',
      { class: 'news-credits' },
      (lean || state) && 'Ratings are for the publisher, not the story. ',
      lean && h('span', null, 'Lean: ', link('https://mediabiasfactcheck.com', 'Media Bias/Fact Check'), ' (US scale). '),
      state && h('span', null, 'State media: ', link('https://statemediamonitor.com', 'State Media Monitor'), ' (MJRC, CC BY 4.0). '),
      translated && h('span', null, 'Translations: ', link('https://www.deepl.com', 'DeepL'), '.'),
    );
  }

  showError(countryName: string, retry: () => void): void {
    this.shown = null;
    const btn = h('button', { type: 'button', class: 'text-link' }, 'Retry');
    btn.addEventListener('click', () => {
      retry();
      // The button goes away on the next render. Keep the keyboard user in the panel.
      this.heading.focus({ preventScroll: true });
    });
    this.render(countryName, '', h('p', { class: 'note' }, 'Could not load the news. ', btn), null);
  }

  hide(): void {
    this.shown = null;
    this.setBreaking(null);
    this.layout.setOpen('news', false);
  }

  private footer(res: NewsResponse): HTMLElement | null {
    const time = utcTime(res.fetchedAt);
    const provider = res.provider ? PROVIDER_LABEL[res.provider] : null;
    if (!time && !provider) return null;
    return h(
      'footer',
      { class: 'panel-foot' },
      h('span', null, time ? `Updated ${time} UTC` : ''),
      provider && h('span', null, `via ${provider}`),
    );
  }

  private render(countryName: string, count: string, content: HTMLElement, ...foot: (HTMLElement | null)[]): void {
    this.country.textContent = `, ${countryName}`;
    this.count.textContent = count;
    this.content.replaceChildren(content, ...foot.filter((x): x is HTMLElement => x !== null));
    this.layout.setOpen('news', true);
  }
}

/** Lowercase words of 3 or more letters or digits, for the duplicate test. */
function words(title: string): Set<string> {
  return new Set(title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3));
}

/** True when a story is the alert story: the same link, or a headline with a word overlap (Dice) of 0.6 or more. */
export function tellsAlert(a: Pick<NewsArticle, 'url' | 'title'>, alert: Pick<BreakingAlert, 'url' | 'headline'>): boolean {
  const bare = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '');
  if (bare(a.url) === bare(alert.url)) return true;
  const x = words(a.title);
  const y = words(alert.headline);
  let shared = 0;
  for (const w of x) if (y.has(w)) shared += 1;
  return x.size + y.size > 0 && (2 * shared) / (x.size + y.size) >= 0.6;
}

const LEAN_STEPS = [-2, -1, 0, 1, 2] as const;
const OTHER_CLASS_NOTE = 'MBFC rates this publisher outside the left-right scale (for example Questionable, Satire or Pro-Science)';

/**
 * The row under a headline: the publisher lean on a 5-step scale with "MBFC" as a link to the
 * rating page, and the State Media Monitor tag. Null for an outlet with no data.
 */
function ratingRow(a: NewsArticle): HTMLElement | null {
  const b = a.bias;
  if (!b) return null;
  const hasLean = b.lean !== null && b.leanLabel !== null;
  // MBFC rates some outlets outside the left-right scale (Questionable, Satire, Pro-Science, ...).
  const otherClass = !hasLean && b.rater === 'MBFC' && !!b.ref;
  if (!hasLean && !otherClass && !b.stateLabel) return null;
  const lean = hasLean
    ? h(
        'span',
        { class: 'lean', role: 'img', 'aria-label': `Publisher lean: ${b.leanLabel!.toLowerCase()}, rated by MBFC` },
        h(
          'span',
          { class: 'lean-scale', 'aria-hidden': 'true' },
          LEAN_STEPS.map((step) => h('span', { class: step === b.lean ? 'lean-cell lean-cell--on' : 'lean-cell', 'data-step': String(step) })),
        ),
        h('span', { class: 'lean-label', 'aria-hidden': 'true' }, b.leanLabel!),
      )
    : otherClass &&
      h(
        'span',
        { class: 'lean lean--other', title: OTHER_CLASS_NOTE },
        h('span', { class: 'lean-label', 'aria-hidden': 'true' }, 'Other class'),
        h('span', { class: 'sr-only' }, OTHER_CLASS_NOTE),
      );
  const rater =
    (hasLean || otherClass) &&
    b.ref &&
    h('a', { class: 'lean-rater mono', href: b.ref, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `MBFC rating of ${a.source}` }, 'MBFC');
  const stateText: Record<string, string> = {
    'state-controlled': 'State-controlled media',
    captured: 'Captured media',
    public: 'Public service media',
  };
  const tag =
    b.stateLabel &&
    h(
      'span',
      { class: 'state-tag mono', title: `${stateText[b.state ?? ''] ?? b.stateLabel}, per State Media Monitor` },
      h('span', { 'aria-hidden': 'true' }, b.stateLabel),
      h('span', { class: 'sr-only' }, `${stateText[b.state ?? ''] ?? b.stateLabel}, per State Media Monitor`),
    );
  return h('div', { class: 'story-rating' }, lean, rater, tag);
}

interface Translation {
  /** The source language as a 2-letter tag, for example "ZH". */
  code: string;
  /** The source title. */
  original: string;
  /** The BCP-47 code of the source title. */
  lang: string;
  /** "Translated from Chinese by DeepL". */
  note: string;
}

/** The translation of a story title, or null when the title is not a translation. */
function translationOf(a: NewsArticle): Translation | null {
  if (!a.translatedBy || !a.originalTitle || !a.lang) return null;
  const lang = a.lang.toLowerCase();
  return { code: lang.slice(0, 2).toUpperCase(), original: a.originalTitle, lang, note: `Translated from ${languageName(lang)} by ${a.translatedBy}` };
}

let originalIds = 0;

/**
 * The row under a translated headline, outside the story link: an "Original" button that shows the source title
 * (for touch, keyboard and screen readers; a hover on the headline also shows it), and "Read in English", which opens
 * the article through the Google Translate page proxy. That link shows only where the proxy works (see translateProxyUrl).
 */
function translationRow(a: NewsArticle, tr: Translation): HTMLElement {
  const id = `story-orig-${++originalIds}`;
  const original = h('p', { class: 'story-orig', id, lang: tr.lang, hidden: true }, tr.original);
  const sign = h('span', { class: 'tr-sign', 'aria-hidden': 'true' }, '+');
  const toggle = h(
    'button',
    { type: 'button', class: 'tr-toggle mono', 'aria-expanded': 'false', 'aria-controls': id },
    h('span', { class: 'tr-label' }, 'Original'),
    h('span', { class: 'sr-only' }, ` title in ${languageName(tr.lang)}`),
    sign,
  );
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    original.hidden = !open;
    sign.textContent = open ? '−' : '+';
  });
  const proxy = translateProxyUrl(a.url);
  const read =
    proxy &&
    h(
      'a',
      { class: 'tr-read', href: proxy, target: '_blank', rel: 'noopener noreferrer' },
      'Read in English',
      h('span', { class: 'sr-only' }, ' (Google Translate, opens in a new tab)'),
      h('span', { 'aria-hidden': 'true' }, ' ↗'),
    );
  return h('div', { class: 'story-tr' }, h('div', { class: 'story-tr-bar' }, toggle, read), original);
}

// Hosts that only link to other publishers. The Google Translate proxy shows an empty page for their redirect
// links (tested 2026-11-11), so a story from them gets no "Read in English" link. Keep in step with AGGREGATORS
// in api/_lib/domain.ts.
const NO_PROXY_HOST = /(?:^|\.)(?:google\.com|msn\.com|flipboard\.com|apple\.news|newsbreak\.com|ground\.news|feedburner\.com)$/;

/**
 * The article through the Google Translate page proxy, in the translate.goog form
 * ("https://www-example-com.translate.goog/path?_x_tr_sl=auto&_x_tr_tl=en"). The older form
 * translate.google.com/translate?u=... only redirects to it, and it can answer with a robot check.
 * Null for an aggregator link (news.google.com, ...), an internationalised host or a URL with a port.
 */
export function translateProxyUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.port || !host.includes('.') || host.includes('xn--') || NO_PROXY_HOST.test(host)) return null;
  const proxied = host.replace(/-/g, '--').replace(/\./g, '-');
  u.searchParams.set('_x_tr_sl', 'auto');
  u.searchParams.set('_x_tr_tl', 'en');
  u.searchParams.set('_x_tr_hl', 'en-GB');
  if (u.protocol === 'http:') u.searchParams.set('_x_tr_sch', 'http');
  return `https://${proxied}.translate.goog${u.pathname}${u.search}${u.hash}`;
}

const languageNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    return null;
  }
})();

/** "de" -> "German". Falls back to the code. */
function languageName(code: string): string {
  try {
    return languageNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
