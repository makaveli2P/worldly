// The search and social files that the production build makes (vite.config.ts, worldlySeo):
//
//   index.html                     the head tags and the crawler summary of the home page
//   /country/<slug>/index.html     one page for each country, made from the built index.html
//   /sitemap.xml, /robots.txt
//
// All functions here are pure, so test/load/seo.test.ts can check them.
//
// index.html holds two empty marker pairs, <!-- worldly:head --><!-- /worldly:head --> and
// <!-- worldly:summary --><!-- /worldly:summary -->. fillBlock() puts the content between the markers.
// The markers stay in the output, so a country page can replace the home content of the built page.

import { area, compactNumber, integer } from '../ui/format';
import type { CountryId, CountryInfo } from '../types';
import { countryPath, countrySlug } from './slug';
import { HOME_DESCRIPTION, HOME_TITLE, SITE_NAME, SITE_ORIGIN, countryTitle } from './site';

/** The shared social image (public/og-image.png). */
export const OG_IMAGE = {
  path: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'The Worldly 3D globe in satellite view, with country names over Africa, Europe and western Asia, and a country search in the header.',
} as const;

/** Search engines cut a description after about 160 characters. */
export const DESCRIPTION_MAX = 160;

const WEBSITE_ID = `${SITE_ORIGIN}/#website`;

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

/** Escapes text for an HTML or XML text node, or for an attribute value in double quotes. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ENTITIES[c]);
}

/** A JSON-LD script element. A "<" in a string becomes \u003c, so a value cannot close the script. */
export function jsonLdScript(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

/** Puts content between <!-- worldly:NAME --> and <!-- /worldly:NAME -->. Throws if the markers are not there. */
export function fillBlock(html: string, name: string, content: string): string {
  const open = `<!-- worldly:${name} -->`;
  const close = `<!-- /worldly:${name} -->`;
  const start = html.indexOf(open);
  const end = html.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`index.html has no ${open}${close} markers`);
  return html.slice(0, start + open.length) + content + html.slice(end);
}

interface HeadInput {
  title: string;
  description: string;
  /** The site path, for example "/" or "/country/japan". */
  path: string;
  jsonLd: unknown;
}

/** The title, the description, the canonical link, the Open Graph and Twitter tags and the JSON-LD of one page. */
export function headTags({ title, description, path, jsonLd }: HeadInput): string {
  const url = SITE_ORIGIN + path;
  const image = SITE_ORIGIN + OG_IMAGE.path;
  const meta = (attr: 'name' | 'property', key: string, value: string | number) =>
    `<meta ${attr}="${key}" content="${escapeHtml(String(value))}" />`;
  return [
    `<title>${escapeHtml(title)}</title>`,
    meta('name', 'description', description),
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', SITE_NAME),
    meta('property', 'og:locale', 'en_US'),
    meta('property', 'og:title', title),
    meta('property', 'og:description', description),
    meta('property', 'og:url', url),
    meta('property', 'og:image', image),
    meta('property', 'og:image:width', OG_IMAGE.width),
    meta('property', 'og:image:height', OG_IMAGE.height),
    meta('property', 'og:image:alt', OG_IMAGE.alt),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', title),
    meta('name', 'twitter:description', description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', OG_IMAGE.alt),
    jsonLdScript(jsonLd),
  ]
    .map((line) => `\n    ${line}`)
    .join('') + '\n    ';
}

const website = () => ({
  '@type': 'WebSite',
  '@id': WEBSITE_ID,
  name: SITE_NAME,
  url: `${SITE_ORIGIN}/`,
  description: HOME_DESCRIPTION,
  inLanguage: 'en',
});

export function homeHead(): string {
  // Only the WebSite node. Google wants a rating or a review on a WebApplication node, and the site has none.
  return headTags({
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
    path: '/',
    jsonLd: { '@context': 'https://schema.org', '@graph': [website()] },
  });
}

const link = (href: string, text: string) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;

/** The links to the country pages, in name order. */
const countryLinks = (list: CountryInfo[]) =>
  [...list]
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .map((c) => link(countryPath(c.name), c.name))
    .join(', ');

/**
 * The crawler summary of the home page. src/main.ts removes it when the globe is on screen.
 * It links to each country page, by region, so that a crawler finds each page from the home page.
 * The list is in a closed <details> element, so that the summary stays short on screen.
 */
export function homeSummary(all: Record<CountryId, CountryInfo>): string {
  const byRegion = new Map<string, CountryInfo[]>();
  for (const info of Object.values(all)) {
    const region = info.region ?? 'Other';
    byRegion.set(region, [...(byRegion.get(region) ?? []), info]);
  }
  const regions = [...byRegion.keys()].sort((a, b) => a.localeCompare(b, 'en'));
  const count = Object.keys(all).length;
  return summaryBox(
    `<h1>${SITE_NAME}</h1>` +
      `<p>Every country's facts and top news on a 3D globe. Spin the globe and pick a country to see its capital, ` +
      `population, leaders and economy, and its top 5 news stories today.</p>` +
      `<details><summary>All ${count} countries and territories</summary>` +
      regions
        .map((r) => `<h2>${escapeHtml(r)}</h2><p>${countryLinks(byRegion.get(r) ?? [])}</p>`)
        .join('') +
      `</details>`,
  );
}

function summaryBox(inner: string): string {
  return `\n    <div id="seo" class="seo">${inner}</div>\n    `;
}

const join = (list: string[]) => list.filter(Boolean).join(', ');

/** The meta description of a country page: 160 characters or fewer. A fact that is missing is left out. */
export function countryDescription(info: CountryInfo): string {
  const facts: string[] = [];
  if (info.capital[0]) facts.push(`capital ${info.capital[0]}`);
  if (info.population) facts.push(`population ${compactNumber(info.population)}`);
  const place = info.subregion ?? info.region;
  if (place && place !== info.name) facts.push(`in ${place}`);
  const tails = [
    " See its key facts and today's top 5 news stories on a 3D globe.",
    ' Key facts and top 5 news on a 3D globe.',
    '',
  ];
  // Drop the longest tail first, then the last fact, until the text fits.
  for (let n = facts.length; n >= 0; n--) {
    const head = n > 0 ? `${info.name}: ${facts.slice(0, n).join(', ')}.` : `${info.name}.`;
    for (const tail of tails) {
      const text = head + tail;
      if (text.length <= DESCRIPTION_MAX) return text;
    }
  }
  return info.name.slice(0, DESCRIPTION_MAX - 1).trimEnd() + '…';
}

export function countryHead(info: CountryInfo): string {
  const path = countryPath(info.name);
  const url = SITE_ORIGIN + path;
  const title = countryTitle(info.name);
  const description = countryDescription(info);
  return headTags({
    title,
    description,
    path,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          '@id': url,
          url,
          name: title,
          description,
          inLanguage: 'en',
          isPartOf: { '@id': WEBSITE_ID },
          // "Country" only for UN members. "Place" is the neutral type for a territory or a disputed area.
          about: {
            '@type': info.unMember ? 'Country' : 'Place',
            name: info.name,
            ...(info.wikipedia ? { sameAs: info.wikipedia } : {}),
          },
          breadcrumb: { '@id': `${url}#breadcrumb` },
          primaryImageOfPage: { '@type': 'ImageObject', url: SITE_ORIGIN + OG_IMAGE.path },
        },
        { '@type': 'WebSite', '@id': WEBSITE_ID, name: SITE_NAME, url: `${SITE_ORIGIN}/` },
        {
          '@type': 'BreadcrumbList',
          '@id': `${url}#breadcrumb`,
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: SITE_NAME, item: `${SITE_ORIGIN}/` },
            { '@type': 'ListItem', position: 2, name: info.name, item: url },
          ],
        },
      ],
    },
  });
}

/** "Emperor Naruhito"; the name only if there is no title. */
const person = (title: string | null, name: string | null) => (name ? (title ? `${title} ${name}` : name) : '');

/** The crawler summary of a country page: the name, the facts, the neighbours and two links. */
export function countrySummary(info: CountryInfo, all: Record<CountryId, CountryInfo>): string {
  const g = info.government;
  const rows: [string, string][] = [
    [info.capital.length > 1 ? 'Capitals' : 'Capital', join(info.capital)],
    ['Region', join([info.subregion ?? '', info.region ?? ''].filter((r, i, a) => r && a.indexOf(r) === i))],
    ['Population', info.population ? integer(info.population) + (info.populationYear ? ` (${info.populationYear})` : '') : ''],
    ['Area', info.area ? area(info.area) : ''],
    [info.languages.length > 1 ? 'Languages' : 'Language', join(info.languages)],
    [info.currencies.length > 1 ? 'Currencies' : 'Currency', join(info.currencies.map((c) => `${c.name} (${c.code})`))],
    ['Head of state', person(g.headOfStateTitle, g.headOfState)],
    ['Head of government', person(g.headOfGovernmentTitle, g.headOfGovernment)],
  ];
  const facts = rows
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${escapeHtml(value)}`)
    .join(' · ');
  const neighbours = info.borders
    .map((id) => all[id])
    .filter((n): n is CountryInfo => Boolean(n))
    .map((n) => link(countryPath(n.name), n.name));
  // The other countries in the same subregion. An island country has no neighbours, so these links
  // connect it to the pages near it.
  const near = info.subregion
    ? Object.values(all).filter((n) => n.subregion === info.subregion && n.id !== info.id)
    : [];
  const links = [link('/', `${SITE_NAME}: all countries on a 3D globe`)];
  if (info.wikipedia) links.push(link(info.wikipedia, `${info.name} on Wikipedia`));
  return summaryBox(
    `<h1>${escapeHtml(info.name)}</h1>` +
      (facts ? `<p>${facts}</p>` : '') +
      (neighbours.length ? `<p>Neighbours: ${neighbours.join(', ')}</p>` : '') +
      (near.length
        ? `<details><summary>More in ${escapeHtml(info.subregion ?? '')}</summary><p>${countryLinks(near)}</p></details>`
        : '') +
      `<p>${links.join(' · ')}</p>`,
  );
}

/** Puts the home head and summary into index.html (the dev server and the build). */
export function renderHomePage(template: string, all: Record<CountryId, CountryInfo>): string {
  return fillBlock(fillBlock(template, 'head', homeHead()), 'summary', homeSummary(all));
}

/** A country page from the built index.html. The app on the page reads the path and selects the country. */
export function renderCountryPage(template: string, info: CountryInfo, all: Record<CountryId, CountryInfo>): string {
  return fillBlock(fillBlock(template, 'head', countryHead(info)), 'summary', countrySummary(info, all));
}

/** One page for each country: [file name in dist/, HTML]. */
export function countryPages(template: string, all: Record<CountryId, CountryInfo>): [fileName: string, html: string][] {
  return Object.values(all).map((info) => [
    `country/${countrySlug(info.name)}/index.html`,
    renderCountryPage(template, info, all),
  ]);
}

/** The site paths in the sitemap: the home page, then each country page in name order. */
export function sitePaths(all: Record<CountryId, CountryInfo>): string[] {
  const names = Object.values(all)
    .map((c) => c.name)
    .sort((a, b) => a.localeCompare(b, 'en'));
  return ['/', ...names.map(countryPath)];
}

/** "2026-11-11" (UTC). */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildSitemap(paths: string[], lastmod: string): string {
  const urls = paths.map(
    (path) =>
      `  <url>\n    <loc>${escapeHtml(SITE_ORIGIN + path)}</loc>\n    <lastmod>${lastmod}</lastmod>\n` +
      `    <changefreq>daily</changefreq>\n    <priority>${path === '/' ? '1.0' : '0.8'}</priority>\n  </url>\n`,
  );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('') +
    '</urlset>\n'
  );
}

export function buildRobots(): string {
  return `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}
