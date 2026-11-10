import { describe, expect, it } from 'vitest';
import { guessLang, hasWord, isJunk, isPressRelease, mentions, namesCountry, properNames, relevance, tidySource, tidyTitle } from '../../api/_lib/text.js';

describe('word-boundary country match', () => {
  it('does not match a country inside a longer word', () => {
    expect(namesCountry('Woman found safe after search', 'Oman')).toBe(false);
    expect(namesCountry('Indiana governor signs bill', 'India')).toBe(false);
    expect(namesCountry('Malibu fire forces evacuations', 'Mali')).toBe(false);
    expect(namesCountry('Somalia election date set', 'Mali')).toBe(false);
    expect(namesCountry('Protest in Tirana turns violent', 'Iran')).toBe(false);
  });

  it('matches the country as a whole word', () => {
    expect(namesCountry('Oman hosts talks', 'Oman')).toBe(true);
    expect(namesCountry("India's budget: what changes", 'India')).toBe(true);
    expect(namesCountry('Mali junta extends rule', 'Mali')).toBe(true);
    expect(namesCountry('Iran rejects offer', 'Iran')).toBe(true);
  });

  it('ignores New Mexico and the Gulf of Mexico for Mexico', () => {
    expect(namesCountry('New Mexico wildfire grows', 'Mexico')).toBe(false);
    expect(namesCountry('Storm builds in the Gulf of Mexico', 'Mexico')).toBe(false);
    expect(namesCountry('Mexico and New Mexico share a border', 'Mexico')).toBe(true);
  });

  it('ignores a US town with a country name ("Mexico, NY")', () => {
    expect(namesCountry('Watertown Woman Dies in Mexico, NY Crash on Main Street', 'Mexico')).toBe(false);
    expect(namesCountry('Fire destroys barn in Cuba, N.Y.', 'Cuba')).toBe(false);
    expect(relevance('Watertown Woman Dies in Mexico, NY Crash', 'Mexico', ['Mexico', 'Mexican'])).toBe('trap');
    expect(namesCountry('Mexico, Texas agree on water deal', 'Mexico')).toBe(true);
    expect(namesCountry('Mexico, in turn, raises tariffs', 'Mexico')).toBe(true);
  });

  it('keeps the older longer-place and homonym rules', () => {
    expect(namesCountry('Inner Mongolia herders face drought', 'Mongolia')).toBe(false);
    expect(namesCountry('Papua New Guinea votes', 'Guinea')).toBe(false);
    expect(namesCountry('Georgia Bulldogs win again in Atlanta', 'Georgia')).toBe(false);
  });

  it('mentions() uses whole words for the full name and the first word', () => {
    expect(mentions('Indiana storms', 'India')).toBe(false);
    expect(mentions('Siachen glacier patrol', 'Siachen Glacier')).toBe(true);
    expect(hasWord('über alles', 'über')).toBe(true);
  });
});

describe('relevance', () => {
  const usa = ['United States', 'US', 'U.S.', 'America', 'American', 'Trump'];
  it('matches short capital aliases with their case only', () => {
    expect(relevance('US troops leave base', 'United States', usa)).toBe('yes');
    expect(relevance('Tell us what you think', 'United States', usa)).toBe('no');
    expect(relevance('US TROOPS LEAVE', 'United States', usa)).toBe('no');
  });

  it('gives "trap" when the name is only inside a blocked place', () => {
    expect(relevance('Latin America braces for storm', 'United States', usa)).toBe('no');
    expect(relevance('New Mexico ballot count', 'Mexico', ['Mexico', 'Mexican'])).toBe('trap');
    expect(relevance('Air France flight diverted', 'France', ['France', 'French'])).toBe('trap');
  });

  it('matches demonyms and leaders', () => {
    expect(relevance('Mexican peso slides', 'Mexico', ['Mexico', 'Mexican', 'Sheinbaum'])).toBe('yes');
    expect(relevance('Sheinbaum meets governors', 'Mexico', ['Mexico', 'Mexican', 'Sheinbaum'])).toBe('yes');
  });
});

describe('properNames', () => {
  it('takes capitalised words that are not the first word', () => {
    expect([...properNames('FBI probes Nvidia boss Huang over alleged spy')].sort()).toEqual(['huang', 'nvidia']);
  });

  it('gives nothing for a Title Case title', () => {
    expect(properNames('Hegseth To Hold Rare News Conference As Vote Looms').size).toBe(0);
  });

  it('skips names in the ignore set and generic words', () => {
    expect([...properNames('Police say Merz will meet President Macron', new Set(['merz']))]).toEqual(['macron']);
  });
});

describe('isJunk and isPressRelease keep their behaviour', () => {
  it('drops spam streams and short titles', () => {
    expect(isJunk('Watch Brazil vs Japan live stream free', 'Some Site')).toBe(true);
    expect(isJunk('Too short', 'Reuters')).toBe(true);
    expect(isJunk('Brazil cuts interest rate to 10 percent', 'Reuters')).toBe(false);
    expect(isJunk('Firm Mongolia (asialaw): Mongolia (asialaw) profile', 'asialaw')).toBe(true);
  });

  it('counts characters, not words, for a CJK title', () => {
    expect(isJunk('高市首相が衆院解散を表明 来月総選挙へ', 'NHK')).toBe(false);
    expect(isJunk('速報', 'NHK')).toBe(true);
  });

  it('drops press-release wires by host or name', () => {
    expect(isPressRelease('https://www.businesswire.com/news/x', 'Business Wire')).toBe(true);
    expect(isPressRelease('https://example.com/a', 'PR Newswire')).toBe(true);
    expect(isPressRelease('https://www.reuters.com/world/x', 'Reuters')).toBe(false);
  });
});

describe('relevance: homonyms and second signals (review cases)', () => {
  const geo = ['Georgia', 'Georgian', 'Tbilisi', 'Kobakhidze'];
  const jor = ['Jordan', 'Jordanian', 'Amman'];
  const ner = ['Niger', 'Nigerien', 'Niamey'];
  const pse = ['Palestine', 'Palestinian', 'Gaza'];

  it('removes blocked phrases as whole words only', () => {
    expect(relevance('Repair India-made trains, says minister', 'India', ['India', 'Indian'])).toBe('yes');
    expect(relevance('Air India flight diverted', 'India', ['India', 'Indian'])).toBe('trap');
  });

  it('knows Panama City Beach (Florida) and Samoa (California)', () => {
    expect(relevance('Panama City Beach apartments for rent saw price increases since last October', 'Panama', ['Panama', 'Panamanian'])).toBe('trap');
    expect(relevance('Panama City hosts regional summit on migration', 'Panama', ['Panama', 'Panamanian'])).toBe('yes');
    expect(relevance('California Coastal Commission approves Caltrans roundabout project near Samoa Bridge', 'Samoa', ['Samoa', 'Samoan'])).toBe('trap');
  });

  it('keeps the US state of Georgia out', () => {
    expect(relevance('Ole Miss fined $250,000 after fans throw objects onto field during Georgia game', 'Georgia', geo)).toBe('trap');
    expect(relevance("Jimmy Carter's Georgia farm opens to visitors", 'Georgia', geo)).toBe('trap');
    expect(relevance("Georgia men's basketball survives Florida Gulf Coast comeback attempt in 80-72 victory", 'Georgia', geo)).toBe('trap');
    expect(relevance('Jon Ossoff launches Georgia re-election bid', 'Georgia', geo)).toBe('trap');
    expect(relevance('Georgia passes foreign agents law despite EU warnings', 'Georgia', geo)).toBe('yes');
    expect(relevance('Georgian Dream wins disputed vote', 'Georgia', geo)).toBe('yes');
  });

  it('needs a second signal for the bare name of a homonym country', () => {
    expect(relevance('Georgia approves new budget', 'Georgia', geo)).toBe('weak');
    expect(relevance('Niger gets new police commissioner as Elleman retires', 'Niger', ner)).toBe('weak');
    expect(relevance('Niger junta nationalises uranium mine', 'Niger', ner)).toBe('yes');
  });

  it('keeps people named Jordan, Niger State and Palestine, Texas out', () => {
    expect(relevance('Jordan Fisher cast as The Boy', 'Jordan', jor)).toBe('trap');
    expect(relevance('Jordan and Scalise face off for House GOP leader after midterms defeat', 'Jordan', jor)).toBe('trap');
    expect(relevance('Former Tennessee Titans DT Jordan Elliott signs with Bills', 'Jordan', jor)).toBe('trap');
    expect(relevance('Jordan condemns Israeli strike on Gaza', 'Jordan', jor)).toBe('yes');
    expect(relevance('Jordan Valley settlers attack Palestinian village', 'Jordan', jor)).toBe('yes');
    expect(relevance('Niger Govt Targets 600 Farmers for N300,000 Interest-Free Loans', 'Niger', ner)).toBe('trap');
    expect(relevance('Palestine native Adrian Peterson inducted into Vikings Ring of Honor', 'Palestine', pse)).toBe('trap');
    expect(relevance('Palestine Action rally in Edinburgh ends in arrests', 'Palestine', pse)).toBe('trap');
    expect(relevance('France to recognise Palestine at the UN', 'Palestine', pse)).toBe('yes');
  });

  it('keeps the Thanksgiving bird away from Türkiye', () => {
    const tur = ['Türkiye', 'Turkey', 'Turkish', 'Ankara'];
    expect(relevance('Turkey prices soar ahead of Thanksgiving', 'Türkiye', tur)).toBe('trap');
    expect(relevance('Turkey detains opposition mayor', 'Türkiye', tur)).toBe('yes');
  });
});

describe('title and source clean-up', () => {
  it('removes a dangling dash and a publisher credit, and keeps a real subtitle', () => {
    expect(tidyTitle('Pentagon chief Hegseth calls impeachment initiative a farce — ABC News Australia', 'UA.NEWS')).toBe(
      'Pentagon chief Hegseth calls impeachment initiative a farce',
    );
    expect(tidyTitle('Council approves the new budget for 2027 | TygerBurger')).toBe('Council approves the new budget for 2027');
    expect(tidyTitle('UN mission ends: Paris -')).toBe('UN mission ends: Paris');
    expect(tidyTitle('Floods hit Bavaria — thousands evacuated')).toBe('Floods hit Bavaria — thousands evacuated');
  });

  it('cleans publisher names', () => {
    expect(tidySource('https://novanews.co.za/')).toBe('novanews.co.za');
    expect(tidySource('Radio Rebelde - ')).toBe('Radio Rebelde');
    expect(tidySource('ABC News & Headlines – Australian Broadcasting Corporation')).toBe('ABC News & Headlines');
  });
});

describe('guessLang', () => {
  it('reads "y/y" and "q/q" as rate notes, not as Spanish words (review: X-kosovo)', () => {
    expect(guessLang("Kosovo's Pristina airport passenger numbers up 4.24% y/y in Oct")).toBeNull();
    expect(guessLang('Serbia GDP up 2.1% q/q, y/y growth slows')).toBeNull();
    expect(guessLang('Sheinbaum y los gobernadores de Morena')).toBe('es');
  });

  it('tags non-English titles and leaves English ones', () => {
    expect(guessLang('Jarmalka oo kala noqday magangelyadii haweeney Soomaaliyeed')).toBe('so');
    expect(guessLang('Amavubi yerekeje muri Mali')).toBe('rw');
    expect(guessLang('Lula diz que o Brasil não vai aceitar')).toBe('pt');
    expect(guessLang('El gobierno de Petro anuncia reforma')).toBe('es');
    expect(guessLang('Президент України')).toBe('uk');
    expect(guessLang('Mali junta dissolves parties')).toBeNull();
    expect(guessLang('Two die in Cuba crash')).toBeNull();
    expect(guessLang('Kenya shuts down embassy in Switzerland')).toBeNull();
  });
});

describe('isJunk: filings, bots and notices (review cases)', () => {
  it('drops them', () => {
    expect(isJunk('Form 6-K TAIWAN SEMICONDUCTOR For: Nov 10', 'StreetInsider')).toBe(true);
    expect(isJunk('Light mag. 3.3 earthquake - Provincia de El Loa, Region de Antofagasta, Chile, on Tuesday', 'Volcano Discovery')).toBe(true);
    expect(isJunk('Global Health Expert Available for Interviews on Congo outbreak', 'Yahoo Finance')).toBe(true);
    expect(isJunk('Flagle Answer Today for November 10', 'Some Site')).toBe(true);
    expect(isJunk("Open Call for UNIV'R Scholarship in Turks and Caicos", 'Some Site')).toBe(true);
    expect(isJunk('Chile earthquake kills 3 in Antofagasta region', 'Reuters')).toBe(false);
  });
});

describe('second live run', () => {
  it('drops SEC forms at the start of a title and section paths at the end', () => {
    expect(isJunk('Form 4 TAIWAN SEMICONDUCTOR MANUFACTURING CO LTD: Shien-Yang Wu (SVP) For: 6 November', 'Investing.com Canada')).toBe(true);
    expect(tidyTitle('Egypt, Palestine agree to train Palestinian doctors in Egyptian hospitals - Health - Egypt')).toBe(
      'Egypt, Palestine agree to train Palestinian doctors in Egyptian hospitals',
    );
  });

  it('knows Mt. Lebanon (Pennsylvania)', () => {
    expect(relevance('After Mt. Lebanon tragedy, how parents can help kids cope', 'Lebanon', ['Lebanon', 'Lebanese', 'Beirut'])).toBe('trap');
  });

  it('needs 2 function words before it names a language', () => {
    expect(guessLang('M3.6 earthquake strikes near Las Tablas, Panama')).toBeNull();
  });
});

describe('audit run 3', () => {
  it('knows the village of Mexico, New York', () => {
    expect(relevance('Watertown woman killed in Village of Mexico crash', 'Mexico', ['Mexico', 'Mexican', 'Sheinbaum'])).toBe('trap');
    expect(relevance('Mexico and the US agree on water deal', 'Mexico', ['Mexico', 'Mexican', 'Sheinbaum'])).toBe('yes');
  });

  it('removes a format tag at the end of a title', () => {
    expect(tidyTitle('Sheikh Hasina’s return to Bangladesh: the hurdles, the risks and the politics | Explained')).toBe(
      'Sheikh Hasina’s return to Bangladesh: the hurdles, the risks and the politics',
    );
  });
});
