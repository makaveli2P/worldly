import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX,
  buildRobots,
  buildSitemap,
  countryDescription,
  countryPages,
  escapeHtml,
  fillBlock,
  isoDate,
  jsonLdScript,
  renderCountryPage,
  renderHomePage,
  sitePaths,
} from '../../src/data/seo';
import { HOME_DESCRIPTION, HOME_TITLE, SITE_ORIGIN, countryTitle } from '../../src/data/site';
import { COUNTRY_PATH_PREFIX, countryPath, countrySlug, slugFromPath } from '../../src/data/slug';
import type { CountryInfo } from '../../src/types';

const root = join(import.meta.dirname, '../..');
const countries = JSON.parse(readFileSync(join(root, 'public/data/countries.json'), 'utf8')) as Record<string, CountryInfo>;
const all = Object.values(countries);
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');

/** The JSON-LD object of a page. */
const jsonLd = (html: string) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  return JSON.parse(m![1]);
};

/** A country record with only the given fields set. */
const blank = (over: Partial<CountryInfo>): CountryInfo => ({
  id: 'XXX',
  iso2: null,
  name: 'Nowhere',
  officialName: null,
  flag: null,
  capital: [],
  region: null,
  subregion: null,
  latlng: null,
  area: null,
  population: null,
  populationYear: null,
  languages: [],
  currencies: [],
  callingCode: null,
  timezones: [],
  borders: [],
  government: { type: null, headOfState: null, headOfStateTitle: null, headOfGovernment: null, headOfGovernmentTitle: null },
  economy: { gdpUsd: null, gdpYear: null, gdpPerCapitaUsd: null, hdi: null, hdiYear: null },
  demographics: { lifeExpectancy: null, urbanPopulationPct: null },
  unMember: null,
  wikipedia: null,
  ...over,
});

describe('countrySlug', () => {
  it('removes diacritics and joins words with one hyphen', () => {
    expect(countrySlug('São Tomé and Príncipe')).toBe('sao-tome-and-principe');
    expect(countrySlug('Åland Islands')).toBe('aland-islands');
    expect(countrySlug('Türkiye')).toBe('turkiye');
    expect(countrySlug("Côte d'Ivoire")).toBe('cote-d-ivoire');
    expect(countrySlug('  Guinea-Bissau  ')).toBe('guinea-bissau');
    expect(countrySlug('Bosnia & Herzegovina')).toBe('bosnia-herzegovina');
  });

  it('gives each of the 241 countries a unique slug of the form a-z0-9 and single hyphens', () => {
    expect(all).toHaveLength(241);
    const slugs = all.map((c) => countrySlug(c.name));
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(slugs).size).toBe(all.length);
  });

  it('keeps the known slugs', () => {
    expect(countryPath(countries.JPN.name)).toBe('/country/japan');
    expect(countryPath(countries.CIV.name)).toBe('/country/ivory-coast');
    expect(countryPath(countries.USA.name)).toBe('/country/united-states');
  });
});

describe('slugFromPath', () => {
  it('reads the slug of a country path', () => {
    expect(slugFromPath('/country/japan')).toBe('japan');
    expect(slugFromPath('/country/japan/')).toBe('japan');
    expect(slugFromPath('/country/Japan')).toBe('japan');
  });

  it('gives null for other paths', () => {
    expect(slugFromPath('/')).toBeNull();
    expect(slugFromPath('/country/')).toBeNull();
    expect(slugFromPath('/country/a/b')).toBeNull();
    expect(slugFromPath('/countries/japan')).toBeNull();
    expect(slugFromPath('/country/%E0%A4%A')).toBeNull();
  });
});

describe('titles and descriptions', () => {
  it('keeps the home title and description short enough for search results', () => {
    expect(HOME_TITLE.length).toBeLessThanOrEqual(60);
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it('writes a description of 160 characters or fewer for each country', () => {
    for (const c of all) {
      const d = countryDescription(c);
      expect(d.length, c.name).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(d.startsWith(c.name), c.name).toBe(true);
    }
  });

  it('writes the facts into the description', () => {
    expect(countryDescription(countries.JPN)).toBe(
      "Japan: capital Tokyo, population 123.37 million, in Eastern Asia. See its key facts and today's top 5 news stories on a 3D globe.",
    );
  });

  it('leaves out the facts that are missing', () => {
    expect(countryDescription(blank({}))).toBe("Nowhere. See its key facts and today's top 5 news stories on a 3D globe.");
    expect(countryDescription(blank({ region: 'Antarctic' }))).toBe(
      "Nowhere: in Antarctic. See its key facts and today's top 5 news stories on a 3D globe.",
    );
  });

  it('makes a long description shorter, and cuts a very long name', () => {
    const long = blank({ name: 'A'.repeat(90), capital: ['B'.repeat(20)], subregion: 'C'.repeat(20) });
    expect(countryDescription(long).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(countryDescription(blank({ name: 'Z'.repeat(400) })).length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });
});

describe('escaping', () => {
  it('escapes the HTML characters', () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });

  it('escapes "<" in JSON-LD, so a value cannot close the script', () => {
    const script = jsonLdScript({ name: '</script><script>alert(1)</script>' });
    expect(script.match(/<\/script>/g)).toHaveLength(1);
    expect(script).toContain('\\u003c/script>');
  });

  it('escapes a country name in each place of the page', () => {
    const evil = blank({ name: 'Evil "<b>" & Co', wikipedia: 'https://example.org/?a=1&b="2"' });
    const page = renderCountryPage(renderHomePage(indexHtml, countries), evil, { XXX: evil });
    expect(page).not.toContain('<b>');
    expect(page).toContain('<h1>Evil &quot;&lt;b&gt;&quot; &amp; Co</h1>');
    expect(page).toContain('href="https://example.org/?a=1&amp;b=&quot;2&quot;"');
    expect(jsonLd(page)['@graph'][0].about.name).toBe(evil.name);
  });
});

describe('fillBlock', () => {
  it('replaces the content between the markers and keeps the markers', () => {
    const html = 'a<!-- worldly:x -->old<!-- /worldly:x -->b';
    expect(fillBlock(html, 'x', 'new')).toBe('a<!-- worldly:x -->new<!-- /worldly:x -->b');
    expect(fillBlock(fillBlock(html, 'x', 'one'), 'x', 'two')).toBe('a<!-- worldly:x -->two<!-- /worldly:x -->b');
  });

  it('throws if the markers are not there', () => {
    expect(() => fillBlock('<html></html>', 'head', 'x')).toThrow(/markers/);
  });
});

describe('pages', () => {
  const home = renderHomePage(indexHtml, countries);

  it('gives the home page its head tags and summary', () => {
    expect(home).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/" />`);
    expect(home).toContain('<meta name="twitter:card" content="summary_large_image" />');
    expect(home).toContain('<div id="seo" class="seo"><h1>Worldly</h1>');
    expect(home.match(/<title>/g)).toHaveLength(1);
    expect(home.match(/name="description"/g)).toHaveLength(1);
    const types = jsonLd(home)['@graph'].map((n: { '@type': string }) => n['@type']);
    expect(types).toEqual(['WebSite']);
  });

  it('links the home page to each country page', () => {
    const summary = home.slice(home.indexOf('<div id="seo"'));
    for (const c of all) expect(summary, c.name).toContain(`<a href="${countryPath(c.name)}">`);
    expect(summary).toContain('<summary>All 241 countries and territories</summary>');
  });

  it('gives a country page its own head tags, JSON-LD and summary', () => {
    const page = renderCountryPage(home, countries.JPN, countries);
    const url = `${SITE_ORIGIN}/country/japan`;
    expect(page).toContain(`<title>${escapeHtml(countryTitle('Japan'))}</title>`);
    expect(page).toContain(`<link rel="canonical" href="${url}" />`);
    expect(page).toContain(`<meta property="og:url" content="${url}" />`);
    expect(page).toContain(`<meta property="og:image" content="${SITE_ORIGIN}/og-image.png" />`);
    expect(page).toContain('<html lang="en">');
    expect(page.match(/<title>/g)).toHaveLength(1);
    expect(page.match(/rel="canonical"/g)).toHaveLength(1);
    expect(page.match(/id="seo"/g)).toHaveLength(1);
    expect(page).toContain('<h1>Japan</h1>');
    expect(page).toContain('Capital: Tokyo');
    expect(page).toContain('Head of state: Emperor Naruhito');
    expect(page).toContain('<a href="https://en.wikipedia.org/wiki/Japan">Japan on Wikipedia</a>');
    expect(page).toContain('<a href="/">');
    const [webPage, , crumbs] = jsonLd(page)['@graph'];
    expect(webPage).toMatchObject({ '@type': 'WebPage', url, about: { '@type': 'Country', name: 'Japan' } });
    expect(webPage.isPartOf).toEqual({ '@id': `${SITE_ORIGIN}/#website` });
    expect(crumbs.itemListElement.map((i: { name: string }) => i.name)).toEqual(['Worldly', 'Japan']);
  });

  it('links a country page to its neighbours', () => {
    const page = renderCountryPage(home, countries.FRA, countries);
    expect(page).toContain('<a href="/country/spain">Spain</a>');
  });

  it('links an island country to the other countries in its subregion', () => {
    const page = renderCountryPage(home, countries.JPN, countries);
    const summary = page.slice(page.indexOf('<div id="seo"'));
    expect(summary).toContain('<summary>More in Eastern Asia</summary>');
    expect(summary).toContain('<a href="/country/south-korea">South Korea</a>');
    expect(summary).not.toContain('<a href="/country/japan">');
  });

  it('makes one page for each country, with unique file names', () => {
    const pages = countryPages(home, countries);
    expect(pages).toHaveLength(241);
    expect(new Set(pages.map(([f]) => f)).size).toBe(241);
    expect(pages.map(([f]) => f)).toContain('country/japan/index.html');
  });
});

describe('sitemap and robots', () => {
  it('lists the home page and each country page with absolute URLs', () => {
    const paths = sitePaths(countries);
    expect(paths).toHaveLength(242);
    expect(paths[0]).toBe('/');
    const xml = buildSitemap(paths, '2026-11-11');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toHaveLength(242);
    for (const loc of locs) expect(loc.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
    expect(locs).toContain(`${SITE_ORIGIN}${COUNTRY_PATH_PREFIX}japan`);
    expect(xml.match(/<lastmod>2026-11-11<\/lastmod>/g)).toHaveLength(242);
  });

  it('writes the date as YYYY-MM-DD in UTC', () => {
    expect(isoDate(new Date('2026-11-11T23:59:59Z'))).toBe('2026-11-11');
  });

  it('allows all pages but the API, and names the sitemap', () => {
    const robots = buildRobots();
    expect(robots).toContain('User-agent: *');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });
});
