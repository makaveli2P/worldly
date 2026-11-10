import { describe, expect, it } from 'vitest';
import { hasWord, isJunk, isPressRelease, mentions, namesCountry, properNames, relevance } from '../../api/_lib/text.js';

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
