// Vercel Web Analytics and Speed Insights. Both use no cookies.
// main.ts loads this module after the first globe frame, so it is not on the critical path.
// The production build only: the dev server has no /_vercel/ endpoints.
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { COUNTRY_PATH_PREFIX } from './data/slug';

/** One route for all country pages, so the Speed Insights dashboard groups them. */
function route(): string {
  return location.pathname.startsWith(COUNTRY_PATH_PREFIX) ? `${COUNTRY_PATH_PREFIX}[slug]` : location.pathname;
}

export function startVitals(): void {
  // A page view on each page load. The app changes the path with replaceState, which the
  // script does not count, so a country selection does not use the event allowance.
  inject({ mode: 'production' });
  injectSpeedInsights({ route: route() });
}
