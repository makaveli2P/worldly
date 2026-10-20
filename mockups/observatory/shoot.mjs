import { chromium } from 'playwright';
const PORT = process.env.PORT || 5247;
const which = process.argv.slice(2);
const shots = [
  { name: 'satellite', q: 'satellite', w: 1440, h: 900 },
  { name: 'atlas', q: 'atlas', w: 1440, h: 900 },
  { name: 'mobile', q: 'satellite', w: 390, h: 844, mobile: true },
].filter((s) => !which.length || which.includes(s.name));
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://localhost:${PORT}/mockups/observatory/index.html?style=${s.q}`);
  await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `/Users/dhruv/Desktop/worldly/_shots/mock-observatory-${s.name}.png` });
  console.log('shot', s.name);
  await ctx.close();
}
await browser.close();
