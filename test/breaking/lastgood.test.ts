// The last good answer of a failed source: mergeLastGood() and fetchInputs() with a stub fetch.
import { describe, expect, it } from 'vitest';
import { FEEDS, LAST_GOOD_MAX_MS, fetchInputs, mergeLastGood, type LastGood } from '../../api/_lib/breaking/sources.js';

const NOW = Date.parse('2026-11-12T10:00:00Z');
const MIN = 60_000;

describe('mergeLastGood()', () => {
  it('a live answer replaces the last good answer', () => {
    const store = new Map<string, LastGood>([['bbc_top', { at: NOW - 10 * MIN, value: ['old'], items: 1 }]]);
    expect(mergeLastGood('bbc_top', { value: ['new'], items: 1 }, store, NOW)).toEqual({ value: ['new'], items: 1, reused: false });
    expect(store.get('bbc_top')).toEqual({ at: NOW, value: ['new'], items: 1 });
  });

  it('a failed source uses its last good answer for 30 minutes', () => {
    const store = new Map<string, LastGood>([['bbc_top', { at: NOW - LAST_GOOD_MAX_MS, value: ['old'], items: 1 }]]);
    expect(mergeLastGood('bbc_top', null, store, NOW)).toEqual({ value: ['old'], items: 1, reused: true });
  });

  it('a last good answer older than 30 minutes is not used, and leaves the store', () => {
    const store = new Map<string, LastGood>([['bbc_top', { at: NOW - LAST_GOOD_MAX_MS - 1, value: ['old'], items: 1 }]]);
    expect(mergeLastGood('bbc_top', null, store, NOW)).toBeNull();
    expect(store.has('bbc_top')).toBe(false);
  });

  it('a failed source with no last good answer gives nothing', () => {
    expect(mergeLastGood('bbc_top', null, new Map(), NOW)).toBeNull();
    expect(mergeLastGood('bbc_top', null, undefined, NOW)).toBeNull();
  });
});

describe('fetchInputs() with the last good answers', () => {
  const rss = (title: string, at: number) =>
    `<rss><channel><item><title>${title}</title><link>https://example.org/${encodeURIComponent(title)}</link><pubDate>${new Date(at).toUTCString()}</pubDate></item></channel></rss>`;
  const euronews = FEEDS.find((f) => f.id === 'euronews')!.url;

  function stub(euronewsUp: boolean): typeof fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('gdacs')) return new Response(null, { status: 204 });
      if (url.includes('usgs')) return new Response('{}');
      if (url.includes('wikipedia')) return new Response('{}');
      if (url === euronews) return euronewsUp ? new Response(rss('Euronews lead story', NOW - 20 * MIN)) : new Response('down', { status: 503 });
      return new Response(rss('Markets rise in Asia', NOW - 10 * MIN));
    }) as typeof fetch;
  }

  it('run 2: the failed feed gives its run 1 headlines, and `ok` counts live answers only', async () => {
    const lastGood = new Map<string, LastGood>();
    const run1 = await fetchInputs(NOW, { fetchImpl: stub(true), lastGood });
    expect(run1.inputs.sources).toEqual({ ok: 26, total: 27 }); // the empty ITN answer counts as failed
    const run2 = await fetchInputs(NOW + 5 * MIN, { fetchImpl: stub(false), lastGood });
    expect(run2.inputs.sources).toEqual({ ok: 25, total: 27, reused: 1 });
    const kept = run2.inputs.headlines.filter((h) => h.feed === 'euronews');
    expect(kept.map((h) => h.title)).toEqual(['Euronews lead story']);
    // The headline keeps its own date, so its age stays true.
    expect(kept[0].publishedAt).toBe(new Date(NOW - 20 * MIN).toISOString());
    expect(run2.status.find((s) => s.id === 'euronews')).toMatchObject({ ok: false, status: 'http 503', reused: true, items: 1 });
    // ITN never answered, so it has no last good answer.
    expect(run2.inputs.itn).toBeNull();
  });

  it('31 minutes after the last good answer, the failed feed gives nothing', async () => {
    const lastGood = new Map<string, LastGood>();
    await fetchInputs(NOW, { fetchImpl: stub(true), lastGood });
    const run = await fetchInputs(NOW + 31 * MIN, { fetchImpl: stub(false), lastGood });
    expect(run.inputs.headlines.some((h) => h.feed === 'euronews')).toBe(false);
    expect(run.inputs.sources).toEqual({ ok: 25, total: 27 });
  });
});
