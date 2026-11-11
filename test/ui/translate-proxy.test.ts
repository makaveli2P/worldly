// "Read in English" (src/ui/news.ts): the Google Translate page proxy, in the translate.goog form.
// The forms were checked by hand with real articles on 2026-11-11 (Playwright): a publisher link works,
// and a news.google.com redirect link gives an empty page, so it gets no link.

import { describe, expect, it } from 'vitest';
import { translateProxyUrl } from '../../src/ui/news';

describe('translateProxyUrl', () => {
  it('maps the host to the translate.goog form and keeps the path and the query', () => {
    expect(translateProxyUrl('https://ria.ru/20261110/pentagon-2130751431.html')).toBe(
      'https://ria-ru.translate.goog/20261110/pentagon-2130751431.html?_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en-GB',
    );
    expect(translateProxyUrl('https://www.jiji.com/jc/article?k=2026111001234&g=int')).toBe(
      'https://www-jiji-com.translate.goog/jc/article?k=2026111001234&g=int&_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en-GB',
    );
  });

  it('doubles a dash in the host, and marks an http site', () => {
    expect(translateProxyUrl('http://news.some-site.co.kr/a#top')).toBe(
      'https://news-some--site-co-kr.translate.goog/a?_x_tr_sl=auto&_x_tr_tl=en&_x_tr_hl=en-GB&_x_tr_sch=http#top',
    );
  });

  it('gives no link for aggregator redirect links and odd URLs', () => {
    expect(translateProxyUrl('https://news.google.com/rss/articles/CBMiY0FVX3lx?oc=5')).toBeNull();
    expect(translateProxyUrl('https://www.msn.com/ja-jp/news/national/ar-AA1')).toBeNull();
    expect(translateProxyUrl('https://xn--fiqs8s.example/a')).toBeNull();
    expect(translateProxyUrl('https://example.com:8443/a')).toBeNull();
    expect(translateProxyUrl('not a url')).toBeNull();
  });
});
