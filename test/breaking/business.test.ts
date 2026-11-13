// The business family (owner decision of 2026-11-13: "a top company's CEO leaves, a market crash, a giant
// merger or collapse"). The traps hold the real headlines of the Nvidia saga of 2026-11-09 to 2026-11-13.
import { describe, expect, it } from 'vitest';
import aliasData from '../../api/_lib/breaking/aliases.json' with { type: 'json' };
import companyData from '../../api/_lib/breaking/companies.json' with { type: 'json' };
import extraData from '../../scripts/companies-extra.json' with { type: 'json' };
import { businessEvent, COMPANIES, companyOf, EXCHANGES, INDICES, mainClause, moneyUsd } from '../../api/_lib/breaking/business.js';
import { classify } from '../../api/_lib/breaking/classify.js';

/** "T2 USA" for a business headline, "attack T2 USA" for a killed leader, else the family and tier, or "-". */
function biz(title: string): string {
  const c = classify(title);
  if (!c) return '-';
  if (c.family === 'business') return `T${c.tier} ${c.subject?.country ?? '?'}`;
  return `${c.family} T${c.tier}${c.subject ? ` ${c.subject.country}` : ''}`;
}

describe('business: major-class events', () => {
  it.each([
    ['Jensen Huang resigns as Nvidia CEO after mounting scandals', 'T2 USA'],
    ['Nvidia CEO Jensen Huang resigns; CFO Kress to take over as interim chief', 'T2 USA'],
    ['Nvidia CEO Jensen Huang resigns in big blow to AI boom', 'T2 USA'],
    ['Nvidia CEO Jensen Huang Resigns After Spy Scandal', 'T2 USA'], // Title Case
    ["Nvidia's Huang quits", 'T2 USA'],
    ['Jensen Huang resigns as CEO of Nvidia', 'T2 USA'], // the ITN form
    // Live titles of 2026-11-12. Wikidata lists Huang as a founder only; the title states the role.
    ['Jensen Huang, face of the AI boom, ousted by Nvidia board as CEO', 'T2 USA'],
    ['Nvidia live updates: Jensen Huang resigns as CEO as third affair allegation emerges, risking broader fallout', 'T2 USA'],
    ['Scandal-hit Nvidia CEO Jensen Huang quits, plunging AI chipmaking giant into turmoil', 'T2 USA'],
    ['OpenAI fires CEO Sam Altman', 'T2 USA'],
    ['Sam Altman ousted as OpenAI CEO', 'T2 USA'],
    ['Warren Buffett dies at 95', 'T2 USA'],
    ['Samsung chairman Lee Jae-yong arrested', 'T2 KOR'],
    ['Boeing CEO Kelly Ortberg arrested over alleged fraud', 'T2 USA'], // the reason clause does not demote
    ['Tesla CEO Elon Musk steps down with immediate effect', 'T2 USA'],
    ['Toyota president Koji Sato resigns', 'T2 JPN'],
    ["Japan's Toyota chairman arrested", 'T2 JPN'],
    ["Korea's Samsung president resigns", 'T2 KOR'],
    ['Dow plunges 2,900 points as tariff fears grip Wall Street', 'T2 USA'], // 6.2%; the hedge is in the reason clause
    ['S&P 500 sinks 6% in worst day since 2008', 'T2 USA'],
    ['Sensex crashes over 4,500 points', 'T2 IND'],
    ['Trading halted on Wall Street as circuit breaker triggered after S&P 500 drops 7%', 'T2 USA'],
    ['NYSE halts all trading after technical glitch', 'T2 USA'],
    ['Nvidia agrees to buy Intel for $120 billion', 'T2 USA'],
    ['Shell to buy BP in $80bn deal', 'T2 GBR'],
    ['Evergrande files for bankruptcy', 'T2 CHN'], // the headquarters country, not the Cayman Islands
    ['Silicon Valley Bank collapses in biggest US bank failure since 2008', 'T2 USA'],
    // Review of 2026-11-13: top companies that the data missed or named wrongly.
    ['Netflix CEO Ted Sarandos steps down', 'T2 USA'],
    ['Netflix co-CEO Ted Sarandos resigns', 'T2 USA'],
    ['Sam Altman fired', 'T2 USA'], // Wikidata drops him: his 2023 term has an end date
    ['TikTok CEO Shou Zi Chew resigns', 'T2 CHN'],
    ['Ferrari CEO Benedetto Vigna resigns', 'T2 ITA'],
    ['Merck CEO Rob Davis resigns', 'T2 USA'], // Merck & Co., not Merck KGaA
    ['Deere CEO John May steps down', 'T2 USA'], // the name was "Deere &"
    ['Mercedes-Benz boss Ola Källenius resigns', 'T2 DEU'], // a loose role with a listed person
    ['Tesla CEO Elon Musk resigns from Tesla', 'T2 USA'],
    ['Microsoft CEO Satya Nadella steps down from his post', 'T2 USA'],
    ['Dow sheds 6% in a week, worst week since 2008', 'T2 USA'], // a record stays major-class
  ])('%s', (title, want) => {
    expect(biz(title)).toBe(want);
  });

  it('critical-class: an index fall of 10% or more, and the collapse of a G-SIB bank', () => {
    expect(biz('Nikkei plunges 12.4% in worst day since 1987')).toBe('T3 JPN');
    expect(biz('Nasdaq plunges 11% in a single day, entering bear market')).toBe('T3 USA');
    expect(biz('UBS collapses')).toBe('T3 CHE');
  });

  it('a leader of a company who is shot dead is an attack, in the country of the scene', () => {
    expect(biz('UnitedHealthcare CEO Brian Thompson shot dead in Manhattan')).toBe('attack T2 USA');
  });

  it('gives the event and the subject', () => {
    expect(classify('Jensen Huang resigns as Nvidia CEO')).toMatchObject({ family: 'business', event: 'leader', subject: { id: 'Q182477', country: 'USA' } });
    expect(classify('Dow plunges 2,900 points')).toMatchObject({ event: 'crash', subject: { id: 'mkt-USA', country: 'USA' } });
    expect(classify('NYSE halts all trading after technical glitch')).toMatchObject({ event: 'halt', subject: { id: 'mkt-USA' } });
    expect(classify('Nvidia agrees to buy Intel for $120 billion')).toMatchObject({ event: 'merger', subject: { id: 'Q182477' } });
    expect(classify('Evergrande files for bankruptcy')).toMatchObject({ event: 'collapse' });
  });
});

describe('business: traps (tier 1 at most, or no business event)', () => {
  it.each([
    // The Nvidia saga, live titles of 2026-11-12 and 2026-11-13.
    'Ex-Nvidia CEO Jensen Huang summoned to testify before Congress about affair with alleged Chinese spy',
    'Ousted Nvidia CEO Jensen Huang summoned to testify before Congress',
    "Jensen Huang has resigned, what's next for Nvidia?",
    'Why did Nvidia CEO Jensen Huang resign, and who is Colette Kress?',
    'From washing dishes at Denny’s to rockstar of AI: the rise and fall of Nvidia’s Jensen Huang',
    "Nvidia's Jensen Huang scandal brings China's spy networks into view",
    'The Nvidia scandal has wiped away $1T in value. What that means for your investments',
    'Singapore Says Warns Alice Huang, Lacks Evidence of Offenses',
    'Nvidia CEO resignation: what we know',
    'Trump backed Huang till end, urged him to fight for job amid China spy scandal',
    'How AI visionary Jensen Huang was undone by his own bad decisions',
    'Morning Wrap: ASX 200 to fall, S&P 500 and Nasdaq slip after Nvidia CEO resigns, Higher oil lifts yields', // a market digest
    'Explainer-Tougher curbs on AI chip sales to China likely after Nvidia CEO resigns',
    'Nvidia CEO to step down after affair controversies',
    'Nvidia board weighs Jensen Huang’s future as CEO',
    "Nvidia market cap plunges $490 billion following former CEO Huang's affair scandals",
    'Jensen Huang resigns', // a founder with no company and no role: support only
    // Other live titles with a company name and a business word.
    'RTÉ’s Laura Fox shares heartbreaking update after radio absence',
    'Pirelli boss was blown away by the ‘astonishing’ thing Lewis Hamilton did in Brazil',
    'Tata International appoints T V Narendran as chairman; Noel Tata steps down',
    // The build-up of the saga.
    'FBI investigating Nvidia CEO over affair with alleged Chinese spy',
    'Nvidia and CEO Jensen Huang face lawsuit over handling of ties to alleged Chinese spy',
    'Nvidia shareholders sue Jensen Huang after affair with suspected Chinese spy',
    "Anthropic eyes $1 trillion US valuation in hotly anticipated IPO that's a key test for AI market",
    // Plans, a board seat, an interim or former leader.
    'Tim Cook to step down as Apple CEO next year',
    'Apple CEO Tim Cook to retire, John Ternus named successor',
    'Jensen Huang steps down from Nvidia board',
    'Interim Nvidia CEO Colette Kress resigns',
    'Former Apple CEO John Sculley dies',
    // Verbs with an object, and other people.
    'Tesla CEO Elon Musk quits Trump administration',
    'Nvidia CEO removed posts criticising China',
    'Boeing CEO Kelly Ortberg dismissed safety concerns, whistleblower says',
    "Amazon founder Jeff Bezos's ex-wife dies",
    'Musk killed the deal with OpenAI',
    'Apple fires back at EU regulators',
    // Markets.
    'Apple shares fall 8% after weak iPhone sales',
    'Nvidia stock plunges 17%, wiping $600bn off its value',
    'Sensex falls 300 points',
    'Nifty crashes below 24,000', // a level, not a fall
    'Dow could plunge 20%, analyst warns',
    'Dow futures drop 1,000 points',
    'GIFT Nifty falls 70 pts, signals weak start for Sensex, Nifty despite Asian markets rally; Nvidia crisis...',
    'MARKETS LIVE: Wall Street closes lower as Nvidia slides, SpaceX-Tesla merger talks advance',
    'ASX 200 Live Today - Friday, 13th November',
    'Nasdaq-listed Nvidia falls 10%',
    'Turkish lira crashes 15%', // currencies are out of scope
    'Bitcoin crashes 20%',
    'Nikkei Asia: Toyota president says sales fell 5%',
    'Dow rebounds after 1,500-point plunge',
    // A fall over many sessions is a correction, not a crash (review of 2026-11-13).
    'S&P 500 falls 10% from record high, confirming correction',
    'Nasdaq enters bear market after falling 20% from its peak',
    'Sensex falls 10% in a month as foreign investors flee',
    'Hang Seng slumps 12% in October',
    'Nifty falls 10% from peak, enters correction territory',
    "Wall Street stocks have lost 10% since Trump's tariffs",
    'S&P 500 drops 10% from February peak',
    'Dow sheds 6% in a week',
    'Sensex tanks 5,000 points in five sessions',
    'Nifty crashes 2,000 points in a week',
    // The head of a Formula 1 team that has a company name is no business leader.
    'Christian Horner sacked as Red Bull boss',
    'Red Bull boss Christian Horner sacked after 20 years',
    'Christian Horner sacked as Red Bull team principal',
    'Red Bull F1 boss Christian Horner sacked',
    'Aston Martin boss resigns',
    'Mercedes boss Toto Wolff steps down',
    'Ferrari boss Fred Vasseur sacked',
    // A departure from a role outside the company.
    'Elon Musk steps down from DOGE',
    'Elon Musk resigns from Trump administration',
    'Elon Musk steps down from government role',
    'Tesla CEO Elon Musk steps down from Trump administration role',
    'Tesla CEO Elon Musk resigns from DOGE',
    'Jensen Huang steps down as chair of White House AI council',
    // Mergers that are not done.
    'Nvidia in talks to buy Intel for $120 billion',
    'Nvidia weighs $120bn bid for Intel',
    "Regulators approve Nvidia's $120bn Intel deal",
    'Nvidia completes $120bn acquisition of Intel',
    'Nvidia to buy Intel in €40bn deal', // about $46bn: below the bar
    // Collapses and halts that are not one.
    'Two guards collapse beside Macron during official welcoming ceremony',
    'Shell shock as Tories collapse in polls',
    'Talks between Tesla and unions collapse',
    'Evergrande could collapse, analysts warn',
    'NYSE halts trading in GameStop shares',
    'Trading in Adani shares halted',
    // Other.
    'Apple unveils iPhone 18 at Cupertino event',
    "Nvidia CEO's resignation after affair with suspected Chinese spy rattles markets, tech world",
  ])('%s', (title) => {
    const c = classify(title);
    expect(c && (c.family === 'business' || c.subject) ? c.tier : 0).toBeLessThanOrEqual(1);
  });

  it('a press review is no voice of any story', () => {
    expect(classify("The Papers: 'Nvidia chief quits' and 'Six women say they too were preyed on by Brand'")).toBeNull();
    expect(classify('Thursday briefing: What we do (and don’t) know about Alice Huang and the Nvidia affair')).toBeNull();
    expect(classify("Newspaper headlines: 'Earthquake kills 50' in Turkey")).toBeNull();
  });

  it('a feature headline with a flood word is no business event', () => {
    expect(classify('Nvidia Scandal Unleashes a Flood of AI-Generated Memes')).toMatchObject({ family: 'disaster', tier: 1 });
  });

  it('a reaction with a company name supports the story in the home country of the company', () => {
    // The title says "Chinese spy"; the story is a US business story.
    expect(classify("Nvidia CEO's resignation after affair with suspected Chinese spy rattles markets, tech world")).toMatchObject({
      family: 'business', tier: 1, subject: { id: 'Q182477', country: 'USA' },
    });
    // A name alone, with no business word, is not a voice.
    expect(classify("Nvidia's Jensen Huang scandal brings China's spy networks into view")).toBeNull();
  });

  it('never makes politics of a company leader', () => {
    for (const t of ["Korea's Samsung president resigns", 'South Korean president of Samsung resigns', 'Toyota president Koji Sato resigns', "Japan's Toyota chairman arrested"]) {
      expect(classify(t)?.family ?? null).not.toBe('politics');
    }
    // A president of a US company is not its chief executive: no leader event.
    expect(biz('Ford president resigns')).not.toBe('T2 USA');
    // A real head-of-state event stays politics.
    expect(classify('Bank collapse topples Paraguay president')).toMatchObject({ family: 'politics', tier: 3 });
    expect(classify('Russia declares war on Georgia')).toMatchObject({ family: 'conflict', tier: 3 });
  });

  it('an ambiguous name needs a business word near it', () => {
    expect(businessEvent('Apple collapses in heat')).toBeNull();
    expect(businessEvent('Shell collapses into administration')).toBeNull();
    expect(businessEvent('Shell plc collapses')).toMatchObject({ tier: 2, subject: 'Q154950' });
    expect(classify('Apple CEO John Ternus resigns')).toMatchObject({ family: 'business', tier: 2 });
  });

  it('a block phrase is not the company', () => {
    expect(businessEvent('Nikola Tesla museum chief resigns')).toBeNull();
    expect(businessEvent('Amazon rainforest fires: shares of farmland firms fall')).toBeNull();
  });
});

describe('money parser', () => {
  it.each([
    ['Nvidia agrees to buy Intel for $120 billion', 1.2e11],
    ['Shell to buy BP in $80bn deal', 8e10],
    ['$1T wiped off', 1e12],
    ['$1 trillion valuation', 1e12],
    ['valued at $3.2bn', 3.2e9],
    ['a 40 billion dollars deal', 4e10],
  ])('%s', (title, usd) => {
    expect(moneyUsd(title)).toBeCloseTo(usd, -6);
  });

  it('converts pounds, euros and rupees', () => {
    expect(moneyUsd('£40bn takeover')).toBeCloseTo(5.2e10, -8); // tier 2: just above $50bn
    expect(moneyUsd('€40bn takeover')).toBeCloseTo(4.6e10, -8); // tier 1
    expect(moneyUsd('Rs 5 lakh crore deal')).toBeCloseTo(5.65e10, -8);
    expect(moneyUsd('no money here')).toBe(0);
  });

  it('sets the merger tier', () => {
    expect(biz('Shell to buy BP in £40bn deal')).toBe('T2 GBR');
    expect(biz('Shell to buy BP in €40bn deal')).toBe('T1 GBR');
  });
});

describe('mainClause', () => {
  it('drops the reason clause, the text after a separator and a short label', () => {
    expect(mainClause('Boeing CEO Kelly Ortberg arrested over alleged fraud')).toBe('Boeing CEO Kelly Ortberg arrested');
    expect(mainClause('Nvidia CEO Jensen Huang resigns; CFO Kress to take over')).toBe('Nvidia CEO Jensen Huang resigns');
    expect(mainClause('Markets: Dow plunges 2,900 points as fears grip Wall Street')).toBe('Dow plunges 2,900 points');
  });
});

describe('companies.json', () => {
  const data = companyData as unknown as { v: number; block: string[]; companies: (typeof COMPANIES)[number][] };
  const countries = new Set(Object.keys(aliasData));

  it('has the shape and the size that the design expects', () => {
    expect(data.v).toBe(1);
    expect(data.companies.length).toBeGreaterThan(700);
    expect(data.companies.length).toBeLessThan(2000);
    for (const c of data.companies) {
      expect(c.q).toMatch(/^Q\d+$/);
      expect(c.names.length).toBeGreaterThan(0);
      expect(countries.has(c.country)).toBe(true);
      for (const n of c.ambiguous ?? []) expect(c.names).toContain(n);
      for (const p of c.people) expect(p.name.split(/\s+/).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives each name to one company, and no name is a country alias', () => {
    const seen = new Map<string, string>();
    const aliasForms = new Set(Object.values(aliasData as Record<string, { names: string[]; demonyms: string[]; places: string[] }>).flatMap((a) => [...a.names, ...a.demonyms, ...a.places]));
    for (const c of data.companies) {
      for (const n of c.names) {
        expect(seen.get(n) ?? c.q).toBe(c.q);
        seen.set(n, c.q);
        expect(aliasForms.has(n)).toBe(false);
      }
    }
  });

  it('holds the key companies with the right home country', () => {
    expect(companyOf('Nvidia')).toMatchObject({ q: 'Q182477', country: 'USA' });
    expect(companyOf('Evergrande')).toMatchObject({ country: 'CHN' });
    expect(companyOf('ASML')).toMatchObject({ country: 'NLD' });
    expect(companyOf('Samsung')).toMatchObject({ country: 'KOR' });
    expect(companyOf('Reliance Industries')).toMatchObject({ country: 'IND' });
    expect(companyOf('Dangote Group')).toMatchObject({ country: 'NGA' });
    expect(companyOf('UBS')).toMatchObject({ gsib: true });
    expect(companyOf('JPMorgan Chase')).toMatchObject({ gsib: true });
  });

  it('keeps out clubs, coins, indices, exchanges and central banks', () => {
    for (const n of ['Manchester United', 'Juventus', 'Bitcoin', 'Dow Jones Industrial Average', 'Bombay Stock Exchange', 'Bank of Japan', 'News', 'Future']) {
      expect(companyOf(n)).toBeUndefined();
    }
  });

  it('holds each must-have company of companies-extra.json with its headline name', () => {
    const must = (extraData as { mustHave: Record<string, string> }).mustHave;
    expect(Object.keys(must).length).toBeGreaterThan(30);
    for (const [q, name] of Object.entries(must)) expect(companyOf(name)?.q, `${q} ${name}`).toBe(q);
  });

  it('is less than 400 KB', () => {
    expect(JSON.stringify(companyData).length).toBeLessThan(400_000);
  });

  it('every index and exchange has a country of the app', () => {
    for (const x of [...INDICES, ...EXCHANGES]) expect(countries.has(x.country)).toBe(true);
  });
});
