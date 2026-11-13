// The toll-only rule: a title with no event word counts when it gives a large death toll for one event.
// Real titles of the Kaziranga (Assam, India) bus-truck collision of 2026-11-13 gave no event before.
import { describe, expect, it } from 'vitest';
import { classify, TOLL_EVENT_DEATHS } from '../../api/_lib/breaking/classify.js';
import { detect } from '../../api/_lib/breaking/detect.js';
import type { FeedKind, Headline, Itn } from '../../api/_lib/breaking/types.js';

const HOUR = 3.6e6;
const NOW = Date.parse('2026-11-13T16:00:00.000Z');
// [feed, kind, edition, position, publisher, title, hours ago]
type Row = [string, FeedKind, string | null, number, string, string, number];

function run(rows: Row[], itn: Itn) {
  const headlines: Headline[] = rows.map(([feed, kind, edition, position, publisher, title, hoursAgo]) => ({
    feed, kind, edition, position, publisher, title,
    url: `https://example.org/${feed}/${encodeURIComponent(title)}`,
    publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
  }));
  return detect({ headlines, itn, hazards: [], now: NOW, sources: { ok: 27, total: 27 } }, null);
}
const brief = (r: ReturnType<typeof run>) => r.response.alerts.map((a) => `${a.country}:${a.level}:${a.kind}`);

describe('classify(): toll-only titles', () => {
  it.each([
    ['At least 24 killed after bus collides with truck near Kaziranga National Park', 24],
    ["24 killed in head-on collision between mini-bus, truck in Assam's Kaziranga", 24],
    ["At least 23 die in bus-truck collision in Assam's Kaziranga; 20 others injured", 23],
    ['UAE says 14 killed, 30 injured in Fujairah traffic accident', 14],
  ])('%s -> a tier-2 accident with %i dead', (title, deaths) => {
    expect(classify(title)).toEqual({ family: 'accident', tier: 2, deaths, tollOnly: true });
  });

  it('a title that already has an event word does not use the rule', () => {
    expect(classify('Bus crash kills 24 in Assam')?.tollOnly).toBeUndefined();
  });

  it.each([
    [`7 dead as speeding minibus rams into truck in Assam's Kaziranga`, 'below the bar'],
    ['Iran\'s supreme leader acknowledges thousands killed during recent protests', 'no number in digits'],
    ['Cholera kills 40 in Sudan as outbreak spreads', 'a disease toll'],
    ['Bird flu kills 50 million chickens in US', 'animals'],
    ['Death toll in Gaza passes 70,000, health ministry says', 'a war total'],
    ['Police killed 306 people in three weeks, rights group says', 'a total over weeks'],
    ['Ten years after 130 were killed in Paris, survivors remember', 'an anniversary'],
  ])('%s -> no tier-2 event (%s)', (title) => {
    expect((classify(title)?.tier ?? 0) < 2).toBe(true);
  });

  it('the bar is 10 dead', () => {
    expect(TOLL_EVENT_DEATHS).toBe(10);
  });
});

describe('detect(): toll-only stories', () => {
  // The BBC title ("... near Kaziranga National Park") names no country: the gazetteer has no Kaziranga.
  const ASSAM: Row[] = [
    ['gn_top_in', 'gn', 'IN', 1, 'India Today', "24 killed in head-on collision between mini-bus, truck in Assam's Kaziranga", 1.5],
    ['gn_world', 'gn', 'WORLD', 4, 'The Hindu', "At least 23 die in bus-truck collision in Assam's Kaziranga; 20 others injured", 2],
    ['gn_top_us', 'gn', 'US', 9, 'Scroll.in', 'Assam: 23 killed in bus-truck collision near Kaziranga', 2.5],
  ];
  const NO_WAR: Itn = { blurbs: [], ongoing: ['Russo-Ukrainian war'] };

  it('the Kaziranga collision on 3 outlets gives a major alert in India', () => {
    expect(brief(run(ASSAM, NO_WAR))).toEqual(['IND:major:accident']);
  });

  it('a toll-only story in a country of a chronic war stays under the chronic gate', () => {
    const gaza: Row[] = [
      ['bbc_world', 'front', null, 1, 'BBC News', 'At least 30 killed in Gaza overnight, health officials say', 1],
      ['aljazeera', 'front', null, 2, 'Al Jazeera', 'At least 31 killed in Gaza overnight, health officials say', 1],
      ['gn_world', 'gn', 'WORLD', 3, 'Reuters', 'Gaza health officials say at least 30 killed overnight', 1],
    ];
    // With no war on the list, the same titles give an alert: the chronic gate is what stops them.
    expect(brief(run(gaza, NO_WAR))).toEqual(['PSE:major:accident']);
    const war: Itn = { blurbs: [], ongoing: ['Gaza war'] };
    expect(brief(run(gaza, war))).toEqual([]);
    const c = run(gaza, war).candidates.find((x) => x.id === 'PSE');
    expect(c?.reason).toMatch(/chronic/);
  });
});
