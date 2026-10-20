// Left panel (desktop) / "News" tab (mobile): top stories for one country.

import type { NewsProvider, NewsResponse } from '../types';
import { h } from './dom';
import { relativeTime } from './format';
import { getLayout, type PanelLayout } from './layout';

const PROVIDER_LABEL: Record<NewsProvider, string> = {
  google: 'via Google News',
  newsdata: 'via NewsData.io',
  gdelt: 'via GDELT',
};

export class NewsPanel {
  private readonly layout: PanelLayout;
  private readonly body: HTMLElement;
  // The header stays in place across renders, so focus on it survives a reload of the list.
  private readonly heading = h('h2', { tabindex: -1 }, 'Top stories');
  private readonly country = h('p', { class: 'news-country' });
  private readonly content = h('div');

  constructor(root: HTMLElement, opts: { onClose: () => void }) {
    this.layout = getLayout(root);
    this.body = this.layout.register('news', 'News', opts.onClose);
    this.body.append(h('header', { class: 'news-head' }, this.heading, this.country), this.content);
  }

  showLoading(countryName: string): void {
    const rows = Array.from({ length: 5 }, () =>
      h(
        'li',
        { class: 'story skeleton', 'aria-hidden': 'true' },
        h('span', { class: 'bar bar--meta' }),
        h('span', { class: 'bar' }),
        h('span', { class: 'bar bar--short' }),
      ),
    );
    this.render(countryName, h('ol', { class: 'stories', 'aria-busy': 'true' }, rows), null);
  }

  show(res: NewsResponse, countryName: string): void {
    const articles = res.articles.slice(0, 5);
    if (articles.length === 0) {
      this.render(countryName, h('p', { class: 'note' }, 'No recent coverage found.'), null);
      return;
    }
    const now = Date.now();
    const items = articles.map((a) => {
      const when = relativeTime(a.publishedAt, now);
      const meta = [a.source, when].filter(Boolean).join(' · ');
      return h(
        'li',
        { class: 'story' },
        h(
          'a',
          { href: a.url, target: '_blank', rel: 'noopener noreferrer' },
          meta && h('span', { class: 'story-meta' }, meta),
          h('span', { class: 'story-title' }, a.title),
        ),
      );
    });
    const foot = res.provider ? PROVIDER_LABEL[res.provider] : null;
    this.render(countryName, h('ol', { class: 'stories' }, items), foot);
  }

  showError(countryName: string, retry: () => void): void {
    const btn = h('button', { type: 'button', class: 'text-link' }, 'Retry');
    btn.addEventListener('click', () => {
      retry();
      // The button goes away on the next render. Keep the keyboard user in the panel.
      this.heading.focus({ preventScroll: true });
    });
    this.render(countryName, h('p', { class: 'note' }, 'Could not load the news. ', btn), null);
  }

  hide(): void {
    this.layout.setOpen('news', false);
  }

  private render(countryName: string, content: HTMLElement, foot: string | null): void {
    this.country.textContent = countryName;
    this.content.replaceChildren(content, foot ? h('footer', { class: 'panel-foot' }, h('span', null, foot)) : '');
    this.layout.setOpen('news', true);
  }
}
