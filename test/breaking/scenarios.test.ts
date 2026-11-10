// Real headline forms that the second review replayed through detect(). Each scenario file holds
// rows of [feed, kind, edition, position, publisher, title, hours ago], with the title as the outlet
// published it. The expected result of each one was checked by hand (see the comment of each test).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detect } from '../../api/_lib/breaking/detect.js';
import type { FeedKind, Headline, Itn } from '../../api/_lib/breaking/types.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/scenarios');
const HOUR = 3.6e6;
type Row = [string, FeedKind, string | null, number, string, string, number | null];

function scenario(name: string) {
  const sc = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as { items: Row[]; now?: string };
  const now = Date.parse(sc.now ?? '2026-11-10T16:00:00Z');
  const headlines: Headline[] = sc.items.map(([feed, kind, edition, position, publisher, title, hoursAgo], i) => ({
    feed, kind, edition, position, publisher, title,
    url: `https://example.org/${feed}/${i}`,
    publishedAt: hoursAgo === null ? null : new Date(now - hoursAgo * HOUR).toISOString(),
  }));
  const itn: Itn = { blurbs: [], ongoing: ['Iran war', 'Russo-Ukrainian war', 'Yemen offensives'] };
  return detect({ headlines, itn, hazards: [], now, sources: { ok: 27, total: 27 } }).response.alerts.map((a) => `${a.country}:${a.level}:${a.kind}`);
}

describe('real headline forms', () => {
  it('Israeli strikes on Lebanon flag Lebanon, not Israel', () => {
    // 5 outlets, 47 dead in Lebanon. Israel is the attacker; "Lebanon says" is the victim country.
    expect(scenario('lebanon-real')).toEqual(['LBN:major:conflict']);
  });

  it('the killing of the Iranian leader flags only Iran', () => {
    // 14 real titles. "in US-Israeli attack" and "Trump says" do not make the US the scene.
    expect(scenario('khamenei')).toEqual(['IRN:critical:politics']);
  });

  it('the Air India crash flags India, not the "London-bound" destination', () => {
    // More than 200 dead in Ahmedabad: critical-class, and 8 outlets lead with it.
    expect(scenario('airindia')).toEqual(['IND:critical:accident']);
  });

  it('the death of a former president gives no alert', () => {
    // "the 39th US president", "longest-lived US president": Carter left office in 1981.
    expect(scenario('carter')).toEqual([]);
  });

  it('the death of a queen mother gives no alert', () => {
    // Queen Mother Sirikit was not the head of state.
    expect(scenario('sirikit')).toEqual([]);
  });

  it('a 30 h old attack in the same city does not hide a new one', () => {
    // A new car bomb (40 dead, 4 outlets) and an old Guardian item about another Mogadishu attack.
    expect(scenario('sameplace')).toEqual(['SOM:major:attack']);
  });
});
