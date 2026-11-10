import { describe, expect, it } from 'vitest';
import { ALIASES, matchCountries, ongoingCountries, primaryCountries, stripAttribution } from '../../api/_lib/breaking/match.js';

const ids = (title: string) => [...new Set(matchCountries(title).filter((m) => m.weight > 0).map((m) => m.id))];

describe('alias table', () => {
  it('covers every country of the app', async () => {
    const countries = (await import('../../public/data/countries.json')).default as Record<string, unknown>;
    expect(Object.keys(ALIASES).sort()).toEqual(Object.keys(countries).sort());
  });

  it('keeps shared demonyms with one owner', () => {
    expect(ALIASES.DOM.demonyms).toContain('Dominican');
    expect(ALIASES.DMA.demonyms).not.toContain('Dominican');
    expect(ALIASES.COD.demonyms).toContain('Congolese');
    expect(ALIASES.COG.demonyms).not.toContain('Congolese');
  });

  it('keeps unsafe surnames out', () => {
    const surnames = Object.values(ALIASES).flatMap((a) => a.leaders.map((l) => l.surname));
    for (const s of ['Friday', 'Rodriguez', 'Boko', 'Chapo', 'José', 'Pierre', 'Sánchez']) expect(surnames).not.toContain(s);
    expect(surnames).toContain('Putin');
  });
});

describe('matchCountries: word boundaries', () => {
  it.each([
    ['Woman dies in flood', []],
    ['Indiana floods close roads', ['USA']],
    ['Chadwick Boseman tribute tonight', []],
    ['Somali pirates seize ship', ['SOM']],
    ['BUS strike hits commuters', []],
    ['New Mexico wildfire spreads', ['USA']],
    ['Nigeria floods kill 20', ['NGA']],
    ['Niger junta expels envoy', ['NER']],
  ])('%s -> %j', (title, expected) => {
    expect(ids(title)).toEqual(expected);
  });
});

describe('matchCountries: trap rules', () => {
  it('Georgia the US state is not the country', () => {
    expect(ids('Georgia governor declares emergency after Atlanta flood')).toEqual(['USA']);
    expect(ids('Georgia school shooting leaves 4 dead')).toEqual([]);
    expect(ids('North Georgia flood kills 12')).toEqual([]);
    expect(ids('Protesters clash with police in Tbilisi as Georgia votes')).toContain('GEO');
    expect(ids('Russia declares war on Georgia')).toEqual(['RUS', 'GEO']);
  });

  it('Jordan, Chad and Georgia as given names are not countries', () => {
    expect(ids('Jordan Davis shot dead in Atlanta')).toEqual(['USA']);
    expect(ids('Chad Smith shot dead')).toEqual([]);
    expect(ids('Jordan Valley settlers attack village')).toEqual([]);
    expect(ids('Chad president killed on frontline')).toEqual(['TCD']);
    expect(ids('Jordan closes border with Syria')).toEqual(['JOR', 'SYR']);
  });

  it('Turkey the bird is not the country', () => {
    expect(ids('Turkey prices soar before Thanksgiving')).toEqual([]);
    expect(ids('Earthquake hits eastern Turkey')).toEqual(['TUR']);
  });

  it('tells the Guineas apart', () => {
    expect(ids('Papua New Guinea landslide buries village')).toEqual(['PNG']);
    expect(ids('Equatorial Guinea president re-elected')).toEqual(['GNQ']);
    expect(ids('Guinea-Bissau soldiers seize power')).toEqual(['GNB']);
    expect(ids('Guinea junta sets election date')).toEqual(['GIN']);
    expect(ids('Pirates attack tanker in the Gulf of Guinea')).toEqual([]);
  });

  it('tells Niger and Nigeria apart, and Niger Delta is Nigeria', () => {
    expect(ids('Niger Delta pipeline explosion kills 20')).toEqual(['NGA']);
    expect(ids('Nigerien soldiers killed in ambush')).toEqual(['NER']);
  });

  it('reads US only as a word, and ignores it in a shouted title', () => {
    expect(ids('US strikes Venezuela')).toEqual(['USA', 'VEN']);
    expect(ids('LET US PRAY FOR PEACE IN THE WORLD')).toEqual([]);
    expect(ids('Business groups meet in Paris')).toEqual(['FRA']);
  });

  it('reads plain Congo as DR Congo, and the Republic only with its full name', () => {
    expect(ids('Congo rebels seize town')).toEqual(['COD']);
    expect(ids('DR Congo floods kill 30')).toEqual(['COD']);
    expect(ids('Republic of the Congo holds election')).toEqual(['COG']);
    expect(ids('Democratic Republic of the Congo declares outbreak')).toEqual(['COD']);
    expect(ids('Congolese army retakes town')).toEqual(['COD']);
  });

  it('tells Oman, India, Chad and Dominica from the longer words', () => {
    expect(ids('Woman arrested in Oman')).toEqual(['OMN']);
    expect(ids('Indian Wells final rained off')).toEqual([]);
    expect(ids('Dominican Republic nightclub roof collapse')).toEqual(['DOM']);
    expect(ids('Hurricane hits Dominica')).toEqual(['DMA']);
  });

  it('tells Sudan and South Sudan apart', () => {
    expect(ids('South Sudan clashes kill 12')).toEqual(['SSD']);
    expect(ids('Sudan army retakes Khartoum')).toEqual(['SDN']);
    expect(ids('South Sudanese refugees cross border')).toEqual(['SSD']);
  });

  it('lets a US state win over a city of the same name', () => {
    expect(primaryCountries('Paris, Texas shooting leaves 6 dead')).toEqual(['USA']);
    expect(primaryCountries('Lebanon, Pennsylvania explosion kills 5')).toEqual(['USA']);
    expect(primaryCountries('Peru, Indiana tornado kills 8')).toEqual(['USA']);
  });

  it('places a diaspora demonym elsewhere', () => {
    expect(primaryCountries('Indian nationals killed in Kuwait fire')).toEqual(['KWT']);
  });
});

describe('primaryCountries: the scene of the event', () => {
  it('takes the target of a strike or an invasion', () => {
    expect(primaryCountries('Russia invades Estonia')).toEqual(['EST']);
    expect(primaryCountries('China invades Taiwan')).toEqual(['TWN']);
    expect(primaryCountries('Israel strikes Iran')).toEqual(['IRN']);
    expect(primaryCountries('Pakistan launches strikes on India')).toEqual(['IND']);
  });

  it('gives two countries on an exact tie, and none for a list of many', () => {
    expect(primaryCountries('Russia and Ukraine trade prisoners')).toEqual(['RUS', 'UKR']);
    expect(primaryCountries('Leaders of France, Germany and Italy meet')).toEqual([]);
  });

  it('flags only the subject of a story that names many countries', () => {
    expect(primaryCountries('Earthquake in Turkey kills 50; Greece, Bulgaria and Cyprus feel tremors')).toEqual(['TUR']);
  });

  it('names a leader country from the leader alone', () => {
    expect(primaryCountries('Putin dies aged 74')).toEqual(['RUS']);
    expect(primaryCountries('Pope Francis dies aged 88')).toEqual(['VAT']);
  });

  it('keeps a leading country name when the rest names no country', () => {
    expect(stripAttribution('Gabon army officers say they have seized power')).toBe('Gabon army officers say they have seized power');
    expect(primaryCountries('Gabon army officers say they have seized power')).toEqual(['GAB']);
    expect(primaryCountries('Ukraine says Russian missile strike kills 12 in Kharkiv')).toEqual(['UKR']);
    expect(primaryCountries('Explosion at steel plant in Turkey kills 16, president says')).toEqual(['TUR']);
  });

  it('keeps a country label when nothing after the colon names a country', () => {
    expect(primaryCountries('Gabon coup: Military officers announce takeover on state TV')).toEqual(['GAB']);
    expect(primaryCountries('Ukraine war: Russian strike kills 9 in Kharkiv')).toEqual(['UKR']);
  });
});

describe('ongoingCountries', () => {
  it('reads the ITN ongoing list', () => {
    expect([...ongoingCountries(['Iran war', 'Russo-Ukrainian war', 'Yemen offensives'])].sort()).toEqual(['IRN', 'RUS', 'UKR', 'YEM']);
  });
});

describe('primaryCountries: attackers, labels and speakers (second review)', () => {
  it.each([
    ['Iran supreme leader Khamenei killed in Israeli strike', ['IRN']],
    ['Khamenei killed in Israeli strike', ['IRN']],
    ['30 killed in Israeli strikes on Lebanon', ['LBN']],
    ['Five dead in Russian drone attack on Moldova', ['MDA']],
    ['At least 40 killed in Pakistani airstrikes in Afghanistan', ['AFG']],
    ['Dozens killed in Saudi-led strikes on Yemen', ['YEM']],
    ['Lebanon says Israeli strikes kill 47 as Israel says four soldiers killed by Hezbollah', ['LBN']],
    ['Lebanon says Israeli strikes in south of the country kill at least 47', ['LBN']],
    ['At least 47 people killed in Israeli strikes across Lebanon', ['LBN']],
    ['Lebanon: Israeli strikes kill 20 in south', ['LBN']],
    ['Gaza: Israeli strikes kill 40 including children', ['PSE']],
    ['Kyiv: Russian missile strike kills 30', ['UKR']],
    ['Pakistan: Afghan Taliban attack kills 23 soldiers', ['PAK']],
    ['Trump says Iranian Supreme Leader Ali Khamenei killed in U.S.-Israeli strikes', ['IRN']],
    ['Iran begins 40-day mourning after Khamenei killed in US-Israeli attack', ['IRN']],
    ['Iran Supreme Leader Khamenei Killed in US Israel Strike Leaving No Successor', ['IRN']],
    ["'One of the most evil people in history': Khamenei killed in strikes, Trump confirms", ['IRN']],
    ['Burkina Faso coup: Ousted military ruler Damiba in Togo', ['BFA']],
    ['Air India crash: 241 people killed after London-bound plane crashes', ['IND']],
    ['Air India crash: 53 British nationals among 241 dead on London flight', ['IND']],
    ['Iran-backed militia attack kills 12 in Iraq', ['IRQ']],
    // A domestic attack and a coup by a country's own soldiers keep their country.
    ['Pakistan attack kills 30', ['PAK']],
    ['Malian soldiers seize power in coup', ['MLI']],
    ['Killed by Israeli forces in Gaza', ['PSE']],
  ])('%s -> %j', (title, expected) => {
    expect(primaryCountries(title)).toEqual(expected);
  });

  it('keeps a country before another country name ("India Pakistan war")', () => {
    expect(primaryCountries('India Pakistan war breaks out')).toEqual(['IND', 'PAK']);
    expect(primaryCountries('Israel Iran war erupts')).toEqual(['ISR', 'IRN']);
    expect(ids('Jordan Davis shot dead in Atlanta')).toEqual(['USA']);
  });

  it('reads Washington DC, Benin City and Panama City Beach', () => {
    expect(primaryCountries('Washington DC plane crash kills 67')).toEqual(['USA']);
    expect(primaryCountries('D.C. plane crash: 67 dead after jet collides with helicopter')).toEqual(['USA']);
    expect(primaryCountries('Plane collides with helicopter near Washington, D.C., killing 67')).toEqual(['USA']);
    expect(primaryCountries('DC plane crash: what we know')).toEqual(['USA']);
    expect(ids('DC Comics announces new Batman film')).toEqual([]);
    expect(primaryCountries('Benin City attack kills 12')).toEqual(['NGA']);
    expect(primaryCountries('Panama City Beach shooting kills 5')).toEqual(['USA']);
  });
});
