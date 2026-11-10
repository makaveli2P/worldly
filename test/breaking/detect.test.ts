// Synthetic cases from the research review, as regression tests for detect().
import { describe, expect, it } from 'vitest';
import { detect } from '../../api/_lib/breaking/detect.js';
import type { BreakingInputs, Hazard, Headline, Itn } from '../../api/_lib/breaking/types.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const HOUR = 3.6e6;
const ITN: Itn = { blurbs: [], ongoing: ['Iran war', 'Russo-Ukrainian war', 'Yemen offensives'] };

// [feed, kind, edition, position, publisher, title, hours ago (default 2)]
type Row = [string, 'front' | 'gn', string | null, number, string, string, number?];

let serial = 0;
function headlines(rows: Row[]): Headline[] {
  return rows.map(([feed, kind, edition, position, publisher, title, hoursAgo = 2]) => ({
    feed, kind, edition, position, publisher, title,
    url: `https://example.org/${feed}/${(serial += 1)}`,
    publishedAt: new Date(NOW - hoursAgo * HOUR).toISOString(),
  }));
}

function run(rows: Row[], extra: Partial<BreakingInputs> = {}) {
  return detect({ headlines: headlines(rows), itn: ITN, hazards: [], now: NOW, sources: { ok: 26, total: 26 }, ...extra });
}
/** The same rows, published `hours` ago. */
const aged = (rows: Row[], hours: number): Row[] => rows.map(([f, k, e, p, pub, t]) => [f, k, e, p, pub, t, hours]);
const alerts = (rows: Row[], extra: Partial<BreakingInputs> = {}) => run(rows, extra).response.alerts;
const summary = (rows: Row[], extra: Partial<BreakingInputs> = {}) => alerts(rows, extra).map((a) => `${a.country}:${a.level}`);

const ESTONIA: Row[] = [
  ['bbc_top', 'front', null, 1, 'BBC News', 'Russia invades Estonia as tanks cross border at Narva'],
  ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Russia launches invasion of Estonia'],
  ['guardian_world', 'front', null, 1, 'The Guardian', 'Russia invades Estonia in dawn assault'],
  ['gn_world', 'gn', 'WORLD', 1, 'Reuters', 'Russian forces invade Estonia, NATO invokes Article 5'],
  ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Russia invades Estonia'],
  ['gn_top_gb', 'gn', 'GB', 1, 'Sky News', 'Russia invades Estonia'],
];

const QUAKE: Row[] = [
  ['bbc_world', 'front', null, 1, 'BBC News', 'Afghanistan earthquake kills more than 2,000, Taliban say'],
  ['aljazeera', 'front', null, 1, 'Al Jazeera', 'More than 2,000 killed in Afghanistan earthquake'],
  ['guardian_world', 'front', null, 1, 'The Guardian', 'Afghanistan earthquake: more than 2,000 dead'],
  ['gn_world', 'gn', 'WORLD', 1, 'Reuters', 'Afghanistan earthquake kills over 2,000 people'],
];

const RED_QUAKE: Hazard = {
  source: 'gdacs', type: 'EQ', level: 'red', countries: ['AFG'], name: 'Earthquake in Afghanistan',
  from: new Date(NOW - 5 * HOUR).toISOString(), to: new Date(NOW - 5 * HOUR).toISOString(),
  url: 'https://www.gdacs.org/report.aspx?eventid=1', magnitude: null,
};

describe('false critical alerts from the review give no critical', () => {
  it('a wire story that 4 outlets carry word for word is one voice', () => {
    expect(alerts([
      ['gn_top_us', 'gn', 'US', 4, 'AP News', "Mexico's president says 6 killed in bus crash in Oaxaca"],
      ['gn_top_us', 'gn', 'US', 9, 'ABC News', "Mexico's president says 6 killed in bus crash in Oaxaca"],
      ['gn_top_ca', 'gn', 'CA', 7, 'CTV News', "Mexico's president says 6 killed in bus crash in Oaxaca"],
      ['gn_world', 'gn', 'WORLD', 5, 'The Washington Post', "Mexico's president says 6 killed in bus crash in Oaxaca"],
    ])).toEqual([]);
  });

  it('a university president who resigns', () => {
    expect(alerts([
      ['gn_top_us', 'gn', 'US', 3, 'CNN', 'University of Florida president resigns after donor scandal'],
      ['gn_top_us', 'gn', 'US', 8, 'NBC News', 'University of Florida president resigns amid donor scandal'],
      ['gn_top_ca', 'gn', 'CA', 11, 'The New York Times', 'University of Florida President Resigns Under Pressure'],
      ['gn_world', 'gn', 'WORLD', 20, 'Politico', 'University of Florida president steps down after scandal'],
    ])).toEqual([]);
  });

  it('a company president who resigns, deep in the feeds', () => {
    expect(alerts([
      ['nyt_world', 'front', null, 30, 'The New York Times', 'Toyota President Resigns After Japan Safety Scandal'],
      ['bbc_world', 'front', null, 25, 'BBC News', "Japan's Toyota president resigns over safety test scandal"],
      ['gn_top_sg', 'gn', 'SG', 30, 'Reuters', 'Toyota president steps down in Japan over safety scandal'],
    ])).toEqual([]);
  });

  it('the natural death of a former president', () => {
    expect(alerts([
      ['bbc_world', 'front', null, 2, 'BBC News', 'Former Nigerian president Olusegun Obasanjo dies aged 89'],
      ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Nigeria’s former President Obasanjo dies at 89'],
      ['guardian_world', 'front', null, 6, 'The Guardian', 'Olusegun Obasanjo, former president of Nigeria, dies aged 89'],
      ['gn_world', 'gn', 'WORLD', 6, 'Reuters', 'Former Nigerian President Obasanjo dies at 89, family says'],
    ])).toEqual([]);
  });

  it('a strong quake with no damage', () => {
    expect(alerts([
      ['gn_top_us', 'gn', 'US', 2, 'CNN', 'Magnitude 7.8 earthquake strikes off Alaska, tsunami alert cancelled'],
      ['gn_top_ca', 'gn', 'CA', 5, 'CBC', 'Magnitude 7.8 earthquake off Alaska prompts brief tsunami alert'],
      ['bbc_world', 'front', null, 3, 'BBC News', 'Magnitude 7.8 earthquake strikes off Alaska with no damage reported'],
      ['gn_world', 'gn', 'WORLD', 9, 'Reuters', 'Magnitude 7.8 quake hits off Alaska, no damage reported'],
    ])).toEqual([]);
  });

  it('feature stories about a coup leader', () => {
    expect(alerts([
      ['bbc_world', 'front', null, 9, 'BBC News', "Burkina Faso's coup leader Traoré hailed by crowds in Ouagadougou"],
      ['aljazeera', 'front', null, 12, 'Al Jazeera', 'Burkina Faso coup leader Traore visits Moscow'],
      ['france24', 'front', null, 7, 'France 24', 'Burkina Faso coup leader Traoré tightens grip'],
    ])).toEqual([]);
  });
});

describe('big events from the review do alert', () => {
  it('"Russia invades Estonia" as the lead of 6 outlets is critical for Estonia', () => {
    const a = alerts(ESTONIA);
    expect(a.map((x) => `${x.country}:${x.level}:${x.kind}`)).toEqual(['EST:critical:conflict']);
    expect(a[0].outlets).toBe(6);
    expect(a[0].basis).toEqual(['news']);
  });

  it('"China invades Taiwan" as the lead of 6 outlets is critical for Taiwan', () => {
    const rows = ESTONIA.map((r): Row => [r[0], r[1], r[2], r[3], r[4], r[5].replace(/Russian/g, 'Chinese').replace(/Russia/g, 'China').replace(/Estonia/g, 'Taiwan').replace('Narva', 'Kinmen')]);
    expect(summary(rows)).toEqual(['TWN:critical']);
  });

  it('the invasion stays critical with no chronic list (ITN failed)', () => {
    expect(summary(ESTONIA, { itn: null })).toEqual(['EST:critical']);
  });

  it('a quake that kills 2,000 alerts: major from news alone, critical with a red GDACS level', () => {
    expect(summary(QUAKE)).toEqual(['AFG:major']);
    const a = alerts(QUAKE, { hazards: [RED_QUAKE] });
    expect(a.map((x) => `${x.country}:${x.level}`)).toEqual(['AFG:critical']);
    expect(a[0].basis).toEqual(['news', 'gdacs']);
  });

  it('a leader death by name alone: major from 5 outlets, critical from 6', () => {
    const rows: Row[] = [
      ['bbc_top', 'front', null, 1, 'BBC News', 'Vladimir Putin dies aged 74, Kremlin announces'],
      ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Russia’s Vladimir Putin has died, Kremlin says'],
      ['guardian_world', 'front', null, 1, 'The Guardian', 'Vladimir Putin dies at 74'],
      ['gn_world', 'gn', 'WORLD', 1, 'Reuters', 'Putin dead at 74, Kremlin says'],
      ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Putin has died, Kremlin announces'],
    ];
    expect(summary(rows)).toEqual(['RUS:major']);
    expect(summary([...rows, ['gn_top_gb', 'gn', 'GB', 1, 'Sky News', 'Vladimir Putin is dead, Kremlin confirms']])).toEqual(['RUS:critical']);
  });

  it('a coup in varied wording joins one story', () => {
    const rows: Row[] = [
      ['bbc_world', 'front', null, 1, 'BBC News', 'Gabon army officers say they have seized power'],
      ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Gabon coup: Military officers announce takeover on state TV'],
      ['france24', 'front', null, 1, 'France 24', 'Gabonese soldiers claim to have overthrown President Bongo'],
      ['guardian_world', 'front', null, 2, 'The Guardian', 'Gabon military officers declare coup after Ali Bongo wins disputed election'],
      ['gn_world', 'gn', 'WORLD', 2, 'Reuters', 'Gabon officers declare military coup, President Ali Bongo detained'],
      ['gn_top_us', 'gn', 'US', 3, 'CNN', 'Military officers seize power in Gabon'],
    ];
    const a = alerts(rows);
    expect(a.map((x) => `${x.country}:${x.level}:${x.kind}`)).toEqual(['GAB:critical:politics']);
    expect(a[0].outlets).toBe(6);
  });

  it('flooding (not "flood") alerts', () => {
    expect(summary([
      ['bbc_world', 'front', null, 1, 'BBC News', 'Flooding kills more than 100 in Texas'],
      ['aljazeera', 'front', null, 2, 'Al Jazeera', 'Texas flooding death toll passes 100'],
      ['gn_top_us', 'gn', 'US', 1, 'CNN', 'More than 100 dead in catastrophic Texas flooding'],
      ['gn_world', 'gn', 'WORLD', 3, 'Reuters', 'Texas flooding kills at least 104'],
    ])).toEqual(['USA:major']);
  });
});

// Real titles from the Google News corpora of the research (5 and 7 Nov 2026), placed on the
// front pages and editions where such a story would sit. They test the production thresholds.
describe('real headlines in production positions', () => {
  it('the Paraguay president who resigns and is impeached is critical', () => {
    const a = alerts([
      ['bbc_world', 'front', null, 1, 'BBC News', 'Paraguay President Santiago Peña resigns after bank collapse'],
      ['npr_world', 'front', null, 1, 'NPR', "Paraguay's president is impeached minutes after resigning following a bank collapse"],
      ['guardian_world', 'front', null, 2, 'The Guardian', 'Paraguay’s president quits after millions of people’s savings frozen in bank crisis'],
      ['dw_world', 'front', null, 3, 'DW', "Paraguay's President Pena resigns as bank collapse sparks protests and impeachment push"],
      ['france24', 'front', null, 4, 'France 24', "Impeachment trial of Paraguay's President Peña begins after bank scandal resignation"],
      ['gn_world', 'gn', 'WORLD', 1, 'Reuters', "Paraguay's Peña resigns as bank collapse triggers political crisis"],
      ['gn_top_us', 'gn', 'US', 3, 'CNN', 'Paraguay president impeached and under house arrest following bank collapse scandal'],
      ['gn_top_us', 'gn', 'US', 8, 'NBC News', 'Paraguay President Peña resigns under mounting pressure from bank collapse'],
      ['nyt_world', 'front', null, 2, 'The New York Times', 'Paraguay’s Leader Resigns After Bank Failure Leaves Millions Without Savings'],
    ]);
    expect(a.map((x) => `${x.country}:${x.level}:${x.kind}`)).toEqual(['PRY:critical:politics']);
    expect(a[0].outlets).toBe(8);
  });

  it('the Kraków mass shooting (6 dead) is major, not critical', () => {
    expect(summary([
      ['bbc_world', 'front', null, 1, 'BBC News', 'Six killed in mass shooting in Kraków main square'],
      ['nyt_world', 'front', null, 1, 'The New York Times', 'Gunman Opens Fire in Krakow, Killing at Least 6, Polish Police Say'],
      ['aljazeera', 'front', null, 3, 'Al Jazeera', 'At least six people killed in shooting in Poland’s Krakow main square'],
      ['gn_world', 'gn', 'WORLD', 1, 'Reuters', 'Poland in shock after six die in Krakow mass shooting'],
      ['gn_top_us', 'gn', 'US', 2, 'NBC News', 'Gunman kills 6 in ‘terror attack’ in Kraków, Poland, officials say; 3 others found dead in his home'],
      ['gn_top_us', 'gn', 'US', 6, 'CNN', 'Poland stunned as suspect with far-right views kills 6 in Kraków mass shooting'],
      ['gn_top_gb', 'gn', 'GB', 4, 'WSJ', 'Six Dead in Shooting at Market Square in Poland'],
    ])).toEqual(['POL:major']);
  });
});

describe('thresholds', () => {
  it('one outlet never starts an alert, even with 68 dead', () => {
    expect(alerts([
      ['bbc_top', 'front', null, 4, 'BBC News', 'High-speed train crash kills at least 68 people in Spain'],
      ['bbc_world', 'front', null, 1, 'BBC News', 'High-speed train crash kills at least 68 people in Spain'],
    ])).toEqual([]);
  });

  it('major needs a lead or an edition position', () => {
    const deep: Row[] = [
      ['bbc_world', 'front', null, 14, 'BBC News', 'Bus plunges into gorge in Peru, killing 20'],
      ['aljazeera', 'front', null, 18, 'Al Jazeera', 'Peru bus crash kills 20 in Andes'],
      ['gn_world', 'gn', 'WORLD', 25, 'Reuters', 'Bus crash in Peru kills 20'],
    ];
    expect(alerts(deep)).toEqual([]);
    expect(summary([...deep.slice(0, 2), ['gn_world', 'gn', 'WORLD', 4, 'Reuters', 'Bus crash in Peru kills 20']])).toEqual(['PER:major']);
  });

  it('two unrelated crashes in one country do not add up', () => {
    expect(alerts([
      ['bbc_world', 'front', null, 2, 'BBC News', 'Jet crash in Florida kills 9'],
      ['gn_top_us', 'gn', 'US', 3, 'CNN', 'Florida jet crash kills 9 people'],
      ['aljazeera', 'front', null, 3, 'Al Jazeera', 'Bus crash in Texas kills 7'],
      ['gn_world', 'gn', 'WORLD', 5, 'Reuters', 'Texas bus crash leaves 7 dead'],
    ])).toEqual([]);
  });

  it('an older story in the same country does not hide a new one', () => {
    const old: Row[] = [
      ['bbc_world', 'front', null, 30, 'BBC News', 'Gunman kills 5 at Michigan church', 30],
      ['gn_top_us', 'gn', 'US', 30, 'CNN', 'Michigan church shooting leaves 5 dead', 30],
    ];
    const fresh: Row[] = [
      ['bbc_world', 'front', null, 1, 'BBC News', 'Gunman kills 8 at Texas church'],
      ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Texas church shooting: 8 dead'],
      ['gn_world', 'gn', 'WORLD', 2, 'Reuters', 'Shooter kills eight at church in Texas'],
    ];
    const a = alerts([...old, ...fresh]);
    expect(a.map((x) => `${x.country}:${x.level}`)).toEqual(['USA:major']);
    expect(Date.parse(a[0].since)).toBeGreaterThan(NOW - 3 * HOUR);
  });

  it('a GDACS or USGS record alone never alerts', () => {
    expect(alerts([], { hazards: [RED_QUAKE] })).toEqual([]);
  });

  it('a hazard record lets 2 outlets confirm a disaster', () => {
    const rows: Row[] = [
      ['bbc_world', 'front', null, 2, 'BBC News', 'Earthquake kills 12 in western Afghanistan'],
      ['gn_world', 'gn', 'WORLD', 6, 'Reuters', 'Afghanistan earthquake kills at least 12'],
    ];
    expect(alerts(rows)).toEqual([]);
    const orange: Hazard = { ...RED_QUAKE, level: 'orange' };
    expect(alerts(rows, { hazards: [orange] }).map((a) => `${a.country}:${a.level}:${a.basis.join('+')}`)).toEqual(['AFG:major:news+gdacs']);
  });

  it('chronic wars need a large escalation and give at most major', () => {
    const rows: Row[] = [
      ['bbc_world', 'front', null, 1, 'BBC News', 'Russian missile strike kills 20 in Kharkiv'],
      ['aljazeera', 'front', null, 2, 'Al Jazeera', 'Russian strike on Kharkiv kills 20'],
      ['gn_world', 'gn', 'WORLD', 2, 'Reuters', 'Russian missiles kill 20 in Ukraine’s Kharkiv'],
      ['gn_top_gb', 'gn', 'GB', 3, 'Sky News', 'Kharkiv missile strike kills 20'],
    ];
    expect(alerts(rows)).toEqual([]);
  });

  it('keeps at most 3 alerts, most severe first', () => {
    const country = (name: string, n: number): Row[] => [
      ['bbc_world', 'front', null, 1, 'BBC News', `Bus crash kills ${n} in ${name}`],
      ['aljazeera', 'front', null, 1, 'Al Jazeera', `${name} bus crash kills ${n}`],
      ['gn_world', 'gn', 'WORLD', 2, 'Reuters', `${n} killed in ${name} bus crash`],
    ];
    const rows = [...country('Peru', 20), ...country('Kenya', 15), ...country('Nepal', 12), ...country('Bolivia', 30), ...ESTONIA];
    const a = alerts(rows);
    expect(a).toHaveLength(3);
    expect(a[0].country).toBe('EST');
    expect(a[0].level).toBe('critical');
  });
});

describe('time', () => {
  it('a critical alert with no headline newer than 6 h drops to major', () => {
    const old = aged(ESTONIA, 7);
    expect(summary(old)).toEqual(['EST:major']);
  });

  it('an alert ends 24 h after its first evidence', () => {
    const first: Row = ['bbc_top', 'front', null, 20, 'BBC News', 'Russia invades Estonia at dawn', 25];
    expect(summary([first, ...ESTONIA])).toEqual([]);
  });

  it('headlines older than 12 h do not count toward the level', () => {
    const old = aged(ESTONIA, 13);
    expect(alerts(old)).toEqual([]);
  });

  it('keeps the same key while new outlets join', () => {
    const early = aged(ESTONIA.slice(0, 4), 3);
    const k1 = alerts([...early, ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Russia invades Estonia', 3]]).map((a) => a.key);
    const later: Row[] = [
      ...early,
      ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Russia invades Estonia', 3],
      ['gn_top_gb', 'gn', 'GB', 1, 'Sky News', 'Russia invades Estonia', 0.5],
      ['gn_top_in', 'gn', 'IN', 2, 'NDTV', 'Estonia invaded: Russian tanks reach Tallinn', 0.2],
    ];
    const k2 = alerts(later).map((a) => a.key);
    expect(k1).toHaveLength(1);
    expect(k2).toEqual(k1);
    expect(k1[0]).toBe('EST-conflict-20261110');
  });

  it('keeps the same key when the first headline leaves its feed', () => {
    // NOW is 12:00 UTC. The first headline is from 10:36, the others from 11:00 to 12:00.
    const first: Row = ['dw_world', 'front', null, 2, 'DW', 'Russia invades Estonia at dawn', 1.4];
    const rest = ESTONIA.map((r, i): Row => [r[0], r[1], r[2], r[3], r[4], r[5], 0.9 - i * 0.15]);
    const k1 = alerts([first, ...rest]).map((a) => a.key);
    const k2 = alerts(rest).map((a) => a.key);
    expect(k1).toHaveLength(1);
    expect(k2).toEqual(k1);
  });

  it('an undated item counts only near the top of its feed', () => {
    const undated = headlines(ESTONIA).map((h) => ({ ...h, publishedAt: null, position: 11 }));
    expect(detect({ headlines: undated, itn: ITN, hazards: [], now: NOW, sources: null }).response.alerts).toEqual([]);
  });
});

describe('follow-ups', () => {
  const KRAKOW: Row[] = [
    ['bbc_world', 'front', null, 1, 'BBC News', 'Gunman kills 6 in mass shooting in Kraków main square'],
    ['dw_world', 'front', null, 1, 'DW', 'Kraków mass shooting: 6 dead in Poland'],
    ['gn_world', 'gn', 'WORLD', 2, 'Reuters', 'Mass shooting in Krakow kills six'],
  ];

  it('a fresh mass shooting is major', () => {
    expect(summary(KRAKOW)).toEqual(['POL:major']);
  });

  it('ITN as a clock: a story ITN reported more than 36 h ago is a follow-up', () => {
    const itn: Itn = {
      blurbs: [{ text: 'A mass shooting in the Main Square of Kraków, Poland, leaves six people dead and sixteen others injured.', date: '2026-11-07T00:00:00.000Z' }],
      ongoing: ITN.ongoing,
    };
    expect(alerts(KRAKOW, { itn })).toEqual([]);
  });

  it('an old ITN blurb about another story in the same country does not block a new one', () => {
    const itn: Itn = {
      blurbs: [{ text: 'In Poland, a train derailment near Gdańsk leaves twelve people dead.', date: '2026-11-07T00:00:00.000Z' }],
      ongoing: ITN.ongoing,
    };
    expect(summary(KRAKOW, { itn })).toEqual(['POL:major']);
  });

  it('with no ITN, a story that spans more than 12 h is a follow-up', () => {
    const rows: Row[] = [...KRAKOW, ['bbc_top', 'front', null, 30, 'BBC News', 'Mass shooting in Kraków: six killed', 15]];
    expect(alerts(rows, { itn: null })).toEqual([]);
    expect(summary(rows)).toEqual(['POL:major']);
  });

  it('with no ITN, aftermath words in 2 outlets mark a follow-up', () => {
    const rows: Row[] = [
      ...KRAKOW,
      ['aljazeera', 'front', null, 3, 'Al Jazeera', 'Kraków shooting: what we know about the gunman'],
      ['france24', 'front', null, 4, 'France 24', 'Kraków mourns six killed in mass shooting'],
    ];
    expect(alerts(rows, { itn: null })).toEqual([]);
  });
});

describe('subject country', () => {
  it('a story about two countries stays with its subject', () => {
    const a = run(ESTONIA);
    expect(a.candidates.filter((c) => c.level).map((c) => c.id)).toEqual(['EST']);
  });

  it('a big story that names many countries flags only its subject', () => {
    expect(summary([
      ['bbc_world', 'front', null, 1, 'BBC News', 'Earthquake in Turkey kills 50; Greece, Bulgaria and Cyprus feel tremors'],
      ['aljazeera', 'front', null, 1, 'Al Jazeera', 'Turkey earthquake kills 50, shaking felt in Greece and Bulgaria'],
      ['gn_world', 'gn', 'WORLD', 1, 'Reuters', 'Deadly earthquake in Turkey kills at least 50'],
    ])).toEqual(['TUR:major']);
  });
});

describe('response shape', () => {
  it('fills every field of the contract', () => {
    const a = alerts(ESTONIA)[0];
    expect(Object.keys(a).sort()).toEqual(['basis', 'country', 'headline', 'key', 'kind', 'level', 'outlets', 'since', 'source', 'updatedAt', 'url'].sort());
    expect(a.headline.length).toBeLessThanOrEqual(200);
    expect(a.source).toBe('BBC News');
    expect(Date.parse(a.since)).toBeLessThanOrEqual(Date.parse(a.updatedAt));
    const r = run(ESTONIA).response;
    expect(r.generatedAt).toBe(new Date(NOW).toISOString());
    expect(r.sources).toEqual({ ok: 26, total: 26 });
  });

  it('prefers a front-page link to a Google News redirect', () => {
    const a = alerts([
      ['gn_world', 'gn', 'WORLD', 1, 'Reuters', 'Russia invades Estonia'],
      ['gn_top_us', 'gn', 'US', 1, 'CNN', 'Russian forces invade Estonia'],
      ['gn_top_gb', 'gn', 'GB', 1, 'Sky News', 'Russia invades Estonia at dawn'],
      ['gn_top_in', 'gn', 'IN', 1, 'NDTV', 'Russia invades Estonia, NATO meets'],
      ['gn_top_au', 'gn', 'AU', 1, 'ABC News (Australia)', 'Russian troops invade Estonia'],
      ['dw_world', 'front', null, 2, 'DW', 'Russia invades Estonia in dawn attack'],
    ])[0];
    expect(a.source).toBe('DW');
  });
});
