// The URL slug of a country: /country/<slug>. The app and the build (vite.config.ts) both use this function,
// so the links on the page and the prerendered pages agree.

/** "São Tomé and Príncipe" -> "sao-tome-and-principe". */
export function countrySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '') // the diacritics that NFKD separates from their letters
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const COUNTRY_PATH_PREFIX = '/country/';

/** The site path of a country page, for example "/country/japan". */
export function countryPath(name: string): string {
  return COUNTRY_PATH_PREFIX + countrySlug(name);
}

/** The slug in a site path, or null if the path is not a country page. "/country/japan/" -> "japan". */
export function slugFromPath(pathname: string): string | null {
  if (!pathname.startsWith(COUNTRY_PATH_PREFIX)) return null;
  const rest = pathname.slice(COUNTRY_PATH_PREFIX.length).replace(/\/$/, '');
  if (!rest || rest.includes('/')) return null;
  try {
    return decodeURIComponent(rest).toLowerCase();
  } catch {
    return null; // a bad % escape
  }
}
