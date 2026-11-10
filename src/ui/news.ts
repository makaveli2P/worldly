// Right plate (desktop) / "News" tab (mobile): top stories for one country, numbered 01-05.

import type { NewsArticle, NewsProvider, NewsResponse } from '../types';
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

export class NewsPanel {
  private readonly layout: PanelLayout;
  private readonly body: HTMLElement;
  // The header stays in place across renders, so focus on it survives a reload of the list.
  private readonly country = h('span', { class: 'sr-only' });
  private readonly heading = h('h2', { tabindex: -1 }, 'Top stories', this.country);
  private readonly count = h('span', { class: 'news-count mono', 'aria-hidden': 'true' });
  private readonly content = h('div', { class: 'news-content' });

  constructor(root: HTMLElement, opts: { onClose: () => void }) {
    this.layout = getLayout(root);
    this.body = this.layout.register('news', 'News', opts.onClose);
    this.body.append(h('header', { class: 'news-h' }, this.heading, this.count), this.content);
  }

  showLoading(countryName: string): void {
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
    const articles = res.articles.slice(0, 5);
    if (articles.length === 0) {
      this.render(countryName, '00', h('p', { class: 'note' }, 'No recent coverage.'), this.footer(res));
      return;
    }
    const now = Date.now();
    const items = articles.map((a, i) => {
      const when = age(a.publishedAt, now);
      const lang = a.lang ? a.lang.toLowerCase() : null;
      const outlets = typeof a.outlets === 'number' && a.outlets >= 3 ? a.outlets : null;
      const rating = ratingRow(a);
      return h(
        'li',
        { class: rating ? 'story story--rated' : 'story' },
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
                lang && h('span', { class: 'lang-tag mono', title: `Title in ${languageName(lang)}`, 'aria-hidden': 'true' }, lang.slice(0, 2).toUpperCase()),
                lang && h('span', { class: 'sr-only' }, `, in ${languageName(lang)}, `),
                outlets !== null && h('span', { class: 'outlets mono' }, `${outlets} outlets`),
                when && h('span', { class: 't mono' }, when),
              ),
            ),
            h('span', { class: 'story-title', lang: lang ?? null }, a.title),
          ),
        ),
        rating,
      );
    });
    this.render(countryName, pad2(articles.length), h('ol', { class: 'stories' }, items), this.credits(articles), this.footer(res));
  }

  /** Attribution for the ratings, only for the data that the list shows. */
  private credits(articles: NewsArticle[]): HTMLElement | null {
    const lean = articles.some((a) => a.bias?.lean !== null && a.bias?.lean !== undefined);
    const state = articles.some((a) => a.bias?.state);
    if (!lean && !state) return null;
    const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
    return h(
      'p',
      { class: 'news-credits' },
      'Ratings are for the publisher, not the story. ',
      lean && h('span', null, 'Lean: ', link('https://mediabiasfactcheck.com', 'Media Bias/Fact Check'), ' (US scale). '),
      state && h('span', null, 'State media: ', link('https://statemediamonitor.com', 'State Media Monitor'), ' (MJRC, CC BY 4.0).'),
    );
  }

  showError(countryName: string, retry: () => void): void {
    const btn = h('button', { type: 'button', class: 'text-link' }, 'Retry');
    btn.addEventListener('click', () => {
      retry();
      // The button goes away on the next render. Keep the keyboard user in the panel.
      this.heading.focus({ preventScroll: true });
    });
    this.render(countryName, '', h('p', { class: 'note' }, 'Could not load the news. ', btn), null);
  }

  hide(): void {
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

const LEAN_STEPS = [-2, -1, 0, 1, 2] as const;

/**
 * The row under a headline: the publisher lean on a 5-step scale with "MBFC" as a link to the
 * rating page, and the State Media Monitor tag. Null for an outlet with no data.
 */
function ratingRow(a: NewsArticle): HTMLElement | null {
  const b = a.bias;
  if (!b) return null;
  const hasLean = b.lean !== null && b.leanLabel !== null;
  if (!hasLean && !b.stateLabel) return null;
  const lean =
    hasLean &&
    h(
      'span',
      { class: 'lean', role: 'img', 'aria-label': `Publisher lean: ${b.leanLabel!.toLowerCase()}, rated by MBFC` },
      h(
        'span',
        { class: 'lean-scale', 'aria-hidden': 'true' },
        LEAN_STEPS.map((step) => h('span', { class: step === b.lean ? 'lean-cell lean-cell--on' : 'lean-cell' })),
      ),
      h('span', { class: 'lean-label', 'aria-hidden': 'true' }, b.leanLabel!),
    );
  const rater =
    hasLean &&
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
