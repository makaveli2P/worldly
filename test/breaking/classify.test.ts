import { describe, expect, it } from 'vitest';
import { classify, deathCount } from '../../api/_lib/breaking/classify.js';

const tier = (title: string) => classify(title)?.tier ?? 0;
const fam = (title: string) => classify(title)?.family ?? null;

describe('deathCount', () => {
  it.each([
    ['Earthquake kills more than 2,000 in Afghanistan', 2000],
    ['More than 2,000 dead after earthquake', 2000],
    ['At least 1,950 killed in floods', 1950],
    ['2,100 people dead in heatwave', 2100],
    ['Afghanistan earthquake kills over 2,400 people', 2400],
    ['Earthquake kills 2000 in Afghanistan', 2000],
    ['Floods in 2026 kill 12', 12],
    ['Since 1999 the town has 3 killed each year', 3],
    ['Shipwreck off Senegal kills dozens', 24],
    ['Myanmar earthquake death toll passes 3,000', 3000],
    ['Children aged 5, 8 and 11 killed in school shooting', 0],
    ['$500 million lost as 3 dead in fire', 3],
    ['Bus crash kills 12 km from the border', 0],
  ])('%s -> %d', (title, n) => {
    expect(deathCount(title)).toBe(n);
  });
});

describe('classify: head of state', () => {
  it('needs the country or demonym next to the title', () => {
    expect(tier('Paraguay president impeached and arrested')).toBe(3);
    expect(tier("Japan's PM resigns after election defeat")).toBe(3);
    expect(tier('President of Paraguay Santiago Peña is impeached')).toBe(3);
    expect(tier('South Korea president arrested over martial law')).toBe(3);
    expect(tier('Chad president killed on frontline')).toBe(3);
    expect(tier('Queen dies in season finale of The Crown')).toBe(0);
    expect(tier('PM steps down as party leader in Japan')).toBe(0);
  });

  it('rejects former, ex- and late leaders', () => {
    expect(tier('Former Nigerian president Olusegun Obasanjo dies aged 89')).toBe(0);
    expect(tier('Nigeria’s former President Obasanjo dies at 89')).toBe(0);
    expect(tier('Olusegun Obasanjo, former president of Nigeria, dies aged 89')).toBe(0);
    expect(tier('Ex-President of Peru dies aged 86')).toBe(0);
    expect(tier('Former president Jimmy Carter dies at 100')).toBe(0);
  });

  it('rejects universities, companies, clubs, banks and federations', () => {
    expect(tier('University of Florida president resigns after donor scandal')).toBe(0);
    // A company president is no head of state. Since the business family (owner, 2026-11-13), the president
    // of Toyota (the chief executive of a top company) who resigns is a business event, never politics.
    expect(classify('Toyota President Resigns After Japan Safety Scandal')).toMatchObject({ family: 'business', tier: 2, subject: { country: 'JPN' } });
    expect(classify("Japan's Toyota president resigns over safety test scandal")).toMatchObject({ family: 'business', tier: 2, subject: { country: 'JPN' } });
    expect(tier('Burger King president resigns')).toBe(0);
    expect(tier('Liverpool president ousted by fans')).toBe(0);
    expect(tier('FIFA president arrested in Zurich')).toBe(0);
    expect(tier('World Bank president resigns')).toBe(0);
    expect(tier('Fed chair resigns as markets fall')).toBe(0);
    expect(tier('Chelsea manager resigns after Arsenal defeat')).toBe(0);
  });

  it('rejects a leader who only speaks', () => {
    expect(classify("Mexico's president says 6 killed in bus crash in Oaxaca")).toMatchObject({ family: 'accident', tier: 2 });
  });

  it('reads a leader name or surname with a death verb', () => {
    expect(classify('Putin dies')).toMatchObject({ family: 'politics', tier: 3 });
    expect(tier('Vladimir Putin dies aged 74, Kremlin announces')).toBe(3);
    expect(tier('Russia’s Vladimir Putin has died, Kremlin says')).toBe(3);
    expect(tier('Xi Jinping dies')).toBe(3);
    expect(tier('Netanyahu assassinated in Jerusalem')).toBe(3);
    expect(tier('Ayatollah Khamenei killed in strike, Iran confirms')).toBe(3);
    expect(tier('Pope Francis dies aged 88')).toBe(3);
    expect(tier('Putin says Ukraine strike killed 12')).toBeLessThan(3);
    expect(tier('Trump says Israel, Gulf allies must repay Iran war cost')).toBe(0);
    expect(tier('Peña resigns after bank collapse')).toBe(3);
    expect(tier('President Trump shot at rally in Pennsylvania')).toBe(3);
  });

  it('rejects an active verb with an object', () => {
    expect(tier('Trump quits Paris climate deal')).toBe(0);
    expect(tier('US President Trump quits Paris climate deal')).toBe(0);
    expect(tier('Trump shot down claims of a rift')).toBe(0);
    expect(tier('Salvadoran President Bukele arrested gang leaders, police say')).toBe(0);
    expect(tier('Putin ousted defence minister in reshuffle')).toBe(0);
    expect(tier('Paraguay president quits party over bank bill')).toBe(0);
    expect(tier('Paraguay president ousted by Congress')).toBe(3);
    expect(tier('Peru president arrested, prosecutors say')).toBe(3);
  });
});

describe('classify: coups', () => {
  it('needs a coup verb, a takeover or "<country> coup"', () => {
    expect(tier('Military seizes power in Gabon')).toBe(3);
    expect(tier('Gabon army officers say they have seized power')).toBe(3);
    expect(tier('Gabon coup: Military officers announce takeover on state TV')).toBe(3);
    expect(tier('Gabonese soldiers claim to have overthrown President Bongo')).toBe(3);
    expect(tier('Mali junta leader overthrown in coup')).toBe(3);
  });

  it('does not take the word coup or toppled alone', () => {
    expect(tier('Coup de grace for Macron pension plan')).toBe(0);
    expect(tier('Bolivia coup attempt fails')).toBeLessThan(2);
    expect(tier("Myanmar's coup leader-turned-president wins back neighbours despite war")).toBe(0);
    expect(tier("Burkina Faso's coup leader Traoré hailed by crowds in Ouagadougou")).toBe(0);
    expect(tier('Trump toppled statue row grows')).toBe(0);
    expect(tier('Saddam statue toppled 25 years ago')).toBe(0);
    expect(tier('Storm Amy: tree toppled in Glasgow kills man')).toBeLessThan(2);
  });
});

describe('classify: war', () => {
  it('needs a country after "invade" or "declares war on"', () => {
    expect(classify('Russia invades Estonia')).toMatchObject({ family: 'conflict', tier: 3 });
    expect(tier('Russian forces invade Estonia, NATO invokes Article 5')).toBe(3);
    expect(tier('Russia launches invasion of Estonia')).toBe(3);
    expect(tier('China invades Taiwan')).toBe(3);
    expect(tier('Russia declares war on Georgia')).toBe(3);
    expect(tier('Mexico declares war on seaweed')).toBe(0);
    expect(tier('Ants invade homes across Australia')).toBe(0);
    expect(tier('Fans invade pitch in Buenos Aires')).toBe(0);
  });

  it('gives an interstate strike major-class, and sport or labour strikes nothing', () => {
    expect(tier('Israel strikes Iran')).toBe(2);
    expect(tier('US strikes Venezuela')).toBe(2);
    expect(tier('Nurses strike hits England')).toBeLessThan(2);
    expect(tier('Germany strikes late to beat Spain')).toBeLessThan(2);
    expect(tier('Lightning strikes India cricket ground')).toBeLessThan(2);
  });

  it('reads nuclear tests', () => {
    expect(tier('North Korea conducts nuclear test')).toBe(3);
    expect(tier('Nuclear test ban treaty talks resume')).toBe(0);
  });
});

describe('classify: disasters and accidents', () => {
  it('needs 50 deaths for critical-class, not a magnitude or a storm category', () => {
    expect(tier('Magnitude 7.8 earthquake strikes off Alaska, no damage reported')).toBeLessThan(2);
    expect(tier('Magnitude 7.8 earthquake strikes off Alaska, tsunami alert cancelled')).toBeLessThan(2);
    expect(tier('Magnitude 7.8 quake hits Alaska')).toBe(2);
    expect(tier('Category 4 Hurricane forms in the Atlantic')).toBeLessThan(2);
    expect(tier('Super typhoon heads for Philippines')).toBeLessThan(2);
    expect(tier('Hurricane Melissa, a category 5 storm, hits Jamaica')).toBe(2);
    expect(tier('Earthquake kills 2,000 in Afghanistan')).toBe(3);
    expect(tier('Tibet earthquake kills at least 16')).toBe(2);
  });

  it('knows flooding, train collisions, shipwrecks and capsized boats', () => {
    expect(classify('Flooding kills 60 in Texas')).toMatchObject({ family: 'disaster', tier: 3, deaths: 60 });
    expect(classify('Collision of two trains in Egypt kills at least seven')).toMatchObject({ family: 'accident', tier: 2, deaths: 7 });
    expect(classify('At least 68 people are killed in a collision between two high-speed trains in Toledo, Spain.')).toMatchObject({ family: 'accident', tier: 3 });
    expect(classify('Shipwreck Off Senegal Kills Dozens as Canary Islands Declare Migrant Emergency')).toMatchObject({ family: 'accident', tier: 2 });
    expect(classify('Migrant boat capsizes off Libya, 40 feared dead')).toMatchObject({ family: 'accident', tier: 2 });
    expect(classify('At least 100 dead in Nigeria boat capsize')).toMatchObject({ family: 'accident', tier: 3 });
  });

  it('gives a small or follow-up event at most tier 1', () => {
    expect(tier('Woman dies in flood')).toBeLessThan(2);
    expect(tier('Minister resigns after train crash')).toBeLessThan(2);
    expect(tier('Investigators recover the voice recorder from a jet crash in Florida that killed 9')).toBeLessThan(2);
    expect(tier('Polish unity on show as thousands join silent march for Krakow shooting victims')).toBeLessThan(2);
    expect(tier('Gunman in Kraków shooting dies in hospital')).toBeLessThan(2);
  });
});

describe('classify: not an event', () => {
  it.each([
    'Blue tsunami sweeps the suburbs',
    'Israel and Hamas agree ceasefire',
    'Thousands join silent march',
    'From shooting stars to a supermoon: November’s sky events',
    '9/11 attacks: 25 years on',
    'Tsunami warning issued for Japan after 7.6 quake',
    'Could a quake kill thousands in Tokyo?',
    'Mass shooting plot at Hindu temple in US foiled after rifle jams',
    'Prime Video series The President killed off after one season',
    'King Charles shot a stag at Balmoral, book claims',
    'Stock market crash wipes out $2tn',
    'Fact check: Online disinformation rife after Krakow mass shooting',
  ])('%s', (title) => {
    expect(tier(title)).toBeLessThan(2);
  });

  it('does not take "May" the month as a modal verb', () => {
    expect(fam('Earthquake kills 30 in Peru on 5 May')).toBe('disaster');
    expect(tier('Earthquake kills 30 in Peru on 5 May')).toBe(2);
    expect(tier('Earthquake may kill thousands, experts say')).toBeLessThan(2);
  });
});

describe('classify: second review', () => {
  it('reads a bomb blast as an attack', () => {
    expect(classify('Bomb blast kills 25 at Pakistan market')).toMatchObject({ family: 'attack', tier: 2, deaths: 25 });
    expect(classify('Roadside explosive device kills 7 soldiers')).toMatchObject({ family: 'attack', tier: 2 });
    expect(classify('Gas explosion kills 12 at factory')).toMatchObject({ family: 'accident', tier: 2 });
  });

  it('reads a current leader by surname, and the King by "King Charles"', () => {
    expect(classify('Xi dies')).toMatchObject({ family: 'politics', tier: 3 });
    expect(classify('King Charles dies')).toMatchObject({ family: 'politics', tier: 3 });
    expect(classify('Trump arrested')).toMatchObject({ family: 'politics', tier: 3 });
    expect(classify('President Donald J. Trump shot at rally')).toMatchObject({ family: 'politics', tier: 3 });
    expect(classify("Paraguay's President Pena resigns")).toMatchObject({ family: 'politics', tier: 3 });
    expect(classify('Thai King Vajiralongkorn dies')).toMatchObject({ family: 'politics', tier: 3 });
    expect(classify('After Vote, President Trump Resigns')).toMatchObject({ family: 'politics', tier: 3 });
  });

  it('does not read a relative or a namesake of a leader as the leader', () => {
    expect(tier('Eric Trump arrested')).toBe(0);
    expect(tier('Melania Trump dies')).toBe(0);
    expect(tier('UN expert Francesca Albanese detained at airport')).toBe(0);
    expect(tier('Adama Traoré dies aged 29')).toBe(0);
  });

  it('reads crash and collision headlines without a vehicle word first', () => {
    expect(classify('Lisbon funicular crash kills 15')).toMatchObject({ family: 'accident', tier: 2 });
    expect(classify('Truck crash kills 20 in Kenya')).toMatchObject({ family: 'accident', tier: 2 });
    expect(classify('Boeing 737 crash kills 3 in Nepal')).toMatchObject({ family: 'accident', tier: 1 });
    expect(classify('Air India Dreamliner crashes into Ahmedabad college hostel, kills over 240')).toMatchObject({ family: 'accident', tier: 3 });
    expect(classify('Air India plane with 242 on board crashes in Ahmedabad')).toMatchObject({ family: 'accident', tier: 2 });
    expect(classify('Plane collides with helicopter near Washington, D.C., killing 67')).toMatchObject({ family: 'accident', tier: 3 });
    expect(tier('Plane with 180 on board crash-lands safely')).toBeLessThan(2);
  });

  it('reads a Category 5 landfall in either order', () => {
    expect(classify('Hurricane Melissa slams into Jamaica as a Category 5 with 185 mph winds')).toMatchObject({ family: 'disaster', tier: 2 });
  });
});
