import { chromium } from 'playwright';
const base = 'http://localhost:5277/mockups/editorial/index.html';
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const jobs = [
  ['satellite', 1440, 900, false],
  ['atlas', 1440, 900, false],
  ['mobile', 390, 844, true],
];
const only = process.argv[2];
for (const [name, w, h, mobile] of jobs) {
  if (only && only !== name) continue;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
  await page.goto(`${base}?style=${name === 'atlas' ? 'atlas' : 'satellite'}`);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => i.decode().catch(() => {}))); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `/Users/dhruv/Desktop/worldly/_shots/mock-editorial-${name}.png` });
  await ctx.close();
}
await browser.close();
