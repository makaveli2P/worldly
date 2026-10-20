// Right plate (desktop) / "News" tab (mobile): top stories for one country, numbered 01-05.

import type { NewsProvider, NewsResponse } from '../types';
import { h } from './dom';
import { age, utcTime } from './format';
import { getLayout, type PanelLayout } from './layout';

const PROVIDER_LABEL: Record<NewsProvider, string> = {
  google: 'Google News',
  newsdata: 'NewsData.io',
  gdelt: 'GDELT',
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
      return h(
        'li',
        { class: 'story' },
        h(
          'a',
          { href: a.url, target: '_blank', rel: 'noopener noreferrer' },
          h('span', { class: 'n mono', 'aria-hidden': 'true' }, pad2(i + 1)),
          h(
            'span',
            { class: 'story-main' },
            h(
              'span',
              { class: 'meta' },
              h('span', { class: 'src' }, a.source),
              when && h('span', { class: 't mono' }, when),
            ),
            h('span', { class: 'story-title' }, a.title),
          ),
        ),
      );
    });
    this.render(countryName, pad2(articles.length), h('ol', { class: 'stories' }, items), this.footer(res));
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

  private render(countryName: string, count: string, content: HTMLElement, foot: HTMLElement | null): void {
    this.country.textContent = `, ${countryName}`;
    this.count.textContent = count;
    this.content.replaceChildren(content, foot ?? '');
    this.layout.setOpen('news', true);
  }
}
