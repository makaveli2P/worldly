// Every headline of the research review's trap list (verify/traps.mjs), with the tier, family and
// scene countries that the detector must give. Tier 0 means no classification. Each expected value
// was checked by hand: a country is the scene of the event, and a tier is only as high as the event.
import { describe, expect, it } from 'vitest';
import { classify, deathCount } from '../../api/_lib/breaking/classify.js';
import { primaryCountries } from '../../api/_lib/breaking/match.js';

type Trap = [title: string, tier: number, family: string | null, countries: string[]];

const TRAPS: Trap[] = [
  ['Woman dies in flood', 1, 'disaster', []],
  ['Jordan Davis shot dead in Atlanta', 0, null, ['USA']],
  ['Turkey prices soar before Thanksgiving', 0, null, []],
  ['Georgia governor declares state of emergency after Atlanta flood', 1, 'disaster', ['USA']],
  ['North Georgia flood kills 12', 2, 'disaster', []],
  ['Staten Island ferry crash kills 6', 2, 'accident', []],
  ['South Jersey explosion kills 7', 2, 'accident', []],
  ['San Juan County landslide kills 5', 2, 'disaster', []],
  ['Indian nationals killed in Kuwait fire', 0, null, ['KWT']],
  ['Niger Delta pipeline explosion kills 20', 2, 'accident', ['NGA']],
  ['Mexico declares war on seaweed', 0, null, ['MEX']],
  ['Russia declares war on Georgia', 3, 'conflict', ['GEO']],
  ['Blue tsunami sweeps the suburbs', 1, 'disaster', []],
  ['Minister resigns after train crash', 1, 'accident', []],
  ['Thousands join silent march', 0, null, []],
  ['Israel and Hamas agree ceasefire', 0, null, ['ISR']],
  ['Former president Jimmy Carter dies at 100', 0, null, []],
  ['Ex-President of Peru dies aged 86', 0, null, ['PER']],
  ['King Charles shot a stag at Balmoral, book claims', 0, null, []],
  ['Chelsea manager resigns after Arsenal defeat', 0, null, []],
  ['Queen dies in season finale of The Crown', 0, null, []],
  ['Burger King president resigns', 0, null, []],
  ['Liverpool president ousted by fans', 0, null, []],
  ['University of Florida president resigns', 0, null, ['USA']],
  ['FIFA president arrested in Zurich', 0, null, []],
  ['Prime Video series The President killed off after one season', 0, null, []],
  ['PM steps down as party leader in Japan', 0, null, ['JPN']],
  ['South Korea president arrested over martial law', 3, 'politics', ['KOR']],
  ['Japan PM resigns after election defeat', 3, 'politics', ['JPN']],
  ['President Trump shot at rally in Pennsylvania', 3, 'politics', ['USA']],
  ['Trump toppled statue row grows', 0, null, ['USA']],
  ['Saddam statue toppled 25 years ago', 0, null, []],
  ['Storm Amy: tree toppled in Glasgow kills man', 1, 'disaster', ['GBR']],
  ['Russia invades Estonia', 3, 'conflict', ['EST']],
  ['Ants invade homes across Australia', 0, null, ['AUS']],
  ['Fans invade pitch in Buenos Aires', 0, null, ['ARG']],
  ['Tourists invade Venice as carnival starts', 0, null, []],
  ['China invades Taiwan', 3, 'conflict', ['TWN']],
  ['Russia launches offensive in Kharkiv', 1, 'conflict', ['UKR']],
  ['Israel launches ground offensive in Lebanon', 3, 'conflict', ['LBN']],
  ['Hurricane Melissa, a category 5 storm, hits Jamaica', 2, 'disaster', ['JAM']],
  ['Category 4 Hurricane forms in the Atlantic', 1, 'disaster', []],
  ['Super typhoon heads for Philippines', 1, 'disaster', ['PHL']],
  ['Magnitude 7.8 earthquake strikes off Alaska, no damage', 1, 'disaster', ['USA']],
  ['Earthquake kills 2,000 in Afghanistan', 3, 'disaster', ['AFG']],
  ['Flooding kills 60 in Texas', 3, 'disaster', ['USA']],
  ['At least 100 dead in Nigeria boat capsize', 3, 'accident', ['NGA']],
  ['Stock market crash wipes out $2tn', 0, null, []],
  ['Israel strikes Iran', 2, 'conflict', ['IRN']],
  ['Iran strikes Israel with missiles, killing 12', 2, 'conflict', ['ISR']],
  ['India strikes Pakistan', 2, 'conflict', ['PAK']],
  ['Pakistan launches strikes on India', 2, 'conflict', ['IND']],
  ['US strikes Venezuela', 2, 'conflict', ['VEN']],
  ['Nurses strike hits England', 0, null, ['GBR']],
  ['France strikes hit Paris transport', 1, 'conflict', ['FRA']],
  ['Lightning strikes India cricket ground', 1, 'conflict', ['IND']],
  ['Germany strikes late to beat Spain', 0, null, ['DEU', 'ESP']],
  ['Coup de grace for Macron pension plan', 0, null, ['FRA']],
  ['Mali junta leader overthrown in coup', 3, 'politics', ['MLI']],
  ['Military seizes power in Gabon', 3, 'politics', ['GAB']],
  ['Bolivia coup attempt fails', 0, null, ['BOL']],
  ['Explosion at steel plant in Turkey kills 16, president says', 2, 'accident', ['TUR']],
  ['Collision of two trains in Egypt kills at least seven', 2, 'accident', ['EGY']],
  ["At least 68 people dead in Spain's second major train crash this year", 3, 'accident', ['ESP']],
  ['At least 68 people are killed in a collision between two high-speed trains in Toledo, Spain.', 3, 'accident', ['ESP']],
  ['Shipwreck Off Senegal Kills Dozens as Canary Islands Declare Migrant Emergency', 2, 'accident', ['SEN']],
  ['At least 14 dead after boat carrying migrants found near Crete', 2, 'accident', []],
  ['Kenyan doomsday sect leader jailed for 200 years for murder of 190 children', 0, null, ['KEN']],
  ['COVID kills 500 in Brazil in a day', 0, null, ['BRA']],
  ['Heatwave kills 1,300 pilgrims in Saudi Arabia', 3, 'disaster', ['SAU']],
  ['Measles outbreak kills 60 children in DR Congo', 0, null, ['COD']],
  ['Cholera death toll reaches 300 in Sudan', 0, null, ['SDN']],
  ['Bird flu kills 50 million chickens in US', 0, null, ['USA']],
  ['Pope Francis dies aged 88', 3, 'politics', ['VAT']],
  ['Pope dies', 3, 'politics', ['VAT']],
  ['Queen Elizabeth II dies', 0, null, []],
  ['Ayatollah Khamenei killed in strike, Iran confirms', 3, 'politics', ['IRN']],
  ['Putin dies', 3, 'politics', ['RUS']],
  ['Xi Jinping dies', 3, 'politics', ['CHN']],
  ['Netanyahu assassinated in Jerusalem', 3, 'politics', ['ISR']],
  ['Charlie Kirk assassinated at Utah event', 2, 'politics', ['USA']],
  ['Chad Smith shot dead', 0, null, []],
  ['Chad president killed on frontline', 3, 'politics', ['TCD']],
  ['Death toll in Gaza passes 70,000', 0, null, ['PSE']],
  ['Tsunami warning issued for Japan after 7.6 quake', 1, 'disaster', ['JPN']],
  ['Tsunami hits Japan coast after magnitude 8.1 earthquake', 2, 'disaster', ['JPN']],
  ['Mount Etna eruption halts flights', 1, 'disaster', []],
  ['Volcano erupts in Iceland', 1, 'disaster', ['ISL']],
  ['Wildfire kills 80 in Hawaii', 3, 'disaster', ['USA']],
  ['Terror attack in Moscow concert hall kills 130', 3, 'attack', ['RUS']],
  ['Gunmen kill 40 in Nigeria village raid', 2, 'attack', ['NGA']],
  ['9/11 attacks: 25 years on', 0, null, []],
  ['Nuclear test by North Korea confirmed', 3, 'conflict', ['PRK']],
  ['North Korea conducts nuclear test', 3, 'conflict', ['PRK']],
  ['Plane crash in Washington kills 67', 3, 'accident', []],
  ['Air India plane crash kills 241', 3, 'accident', ['IND']],
  ['Georgia school shooting leaves 4 dead', 2, 'attack', []],
  ['Shooting in Jersey City kills 6', 2, 'attack', ['USA']],
  ['Lebanon, Pennsylvania explosion kills 5', 2, 'accident', ['USA']],
  ['Peru, Indiana tornado kills 8', 2, 'disaster', ['USA']],
  ['Paris, Texas shooting leaves 6 dead', 2, 'attack', ['USA']],
  ['Mass shooting in Sydney kills 15 at Bondi Beach', 2, 'attack', ['AUS']],
  ['Bondi Beach shooting: 15 killed in terror attack', 2, 'attack', []],
  ['Dozens killed in stampede at Kumbh Mela', 2, 'accident', []],
  ['Israel kills 50 in Gaza strikes', 3, 'conflict', ['PSE']],
  ['Hong Kong fire kills 150 in tower blocks', 3, 'accident', ['HKG']],
  ['Myanmar earthquake death toll passes 3,000', 3, 'disaster', ['MMR']],
];

describe('the trap list of the research review', () => {
  it.each(TRAPS)('%s', (title, tier, family, countries) => {
    const c = classify(title);
    expect([c?.tier ?? 0, c?.family ?? null]).toEqual([tier, family]);
    expect(primaryCountries(title)).toEqual(countries);
  });
});

describe('false alarms found in the research corpora and in review', () => {
  it.each([
    'Beijing Doesn’t Need to Invade Taiwan to Control It',
    'NATO Expansion: Root Cause of Russia’s Invasion of Ukraine',
    "Rome's invasion of Britain had help from a woman long mistaken for a king, researchers say",
    'Russia’s full-scale invasion of Ukraine enters its fifth year',
    'Today in History: November 10, white supremacists stage coup in Wilmington, North Carolina',
    "How a bank collapse left millions in limbo and toppled Paraguay's president",
    "Chinese jets invade Taiwan's airspace",
    "Price war breaks out in India's telecom sector",
    "Kenya president Ruto's son arrested",
    'Trump dead set on tariffs, aides say',
    'Reports show US and Israel are planning new strikes on Iran',
    'Ukraine to restart strikes on Russian oil refineries, Zelensky says',
    'Sudan: Drone strikes killed at least 306 people in three weeks',
    'Mass shooting at party leaves 9 injured',
    '2 soldiers killed in West Bank shooting',
    'South Korean prosecutor seeks death penalty for ex-President Yoon over martial law debacle',
    'Moldova is preparing new rules for introducing a state of siege and martial law',
    'Tanks vs. Texts: Martial Law in Polish Poetry',
    'COMMENTARY: On AI and Iran, Trump risks bombing himself in the foot',
  ])('%s gives at most tier 1', (title) => {
    expect(classify(title)?.tier ?? 0).toBeLessThan(2);
  });

  it('gives a gunman who opens fire the attack family, and a quake that strikes the disaster family', () => {
    expect(classify('At Least 6 Dead in Poland After Gunman Opens Fire in Krakow, Police Say')).toMatchObject({ family: 'attack', tier: 2 });
    expect(classify("Earthquake of magnitude 7 strikes China's Tibet, killing 16, Xinhua reports")).toMatchObject({ family: 'disaster', tier: 2 });
  });

  it('reads "coup in <country>"', () => {
    expect(classify('Military coup in Niger')).toMatchObject({ family: 'politics', tier: 3 });
    expect(classify('Attempted coup in Bolivia fails')?.tier ?? 0).toBeLessThan(2);
  });

  it('counts the toll of one event, not the total of a war or of many weeks', () => {
    expect(classify('Israeli strikes kill 30 in Gaza as death toll passes 70,000')).toMatchObject({ family: 'conflict', tier: 2, deaths: 30 });
    expect(deathCount('Drone strikes killed at least 306 people in three weeks')).toBe(0);
    expect(deathCount('More than 1,000 killed since the war began')).toBe(0);
    expect(deathCount('50 killed in worst flooding since 1950')).toBe(50);
    expect(deathCount('Floods kill 30 in two days in Kenya')).toBe(30);
  });
});
