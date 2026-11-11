// The canonical address and the page titles of the site. The app (src/main.ts) and the build (src/data/seo.ts)
// both read them. Change the domain here only.

/** The production origin. Canonical links, the sitemap and the social tags use it. */
export const SITE_ORIGIN = 'https://worldly.today';

export const SITE_NAME = 'Worldly';

/** The title of the home page (60 characters or fewer, so search results show all of it). */
export const HOME_TITLE = "Worldly · Every country's facts and top news on a 3D globe";

/** The description of the home page (160 characters or fewer). */
export const HOME_DESCRIPTION =
  'Spin a 3D globe and pick any country or territory to see its key facts and its top 5 news stories today. Free, with no sign-in.';

/** The title of a country page and of the app while a country is selected. */
export function countryTitle(name: string): string {
  return `${name}: facts and top news · ${SITE_NAME}`;
}
