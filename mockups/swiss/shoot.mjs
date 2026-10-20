import { chromium } from 'playwright';
const base = 'http://localhost:5247/mockups/swiss/index.html';
const out = '/Users/dhruv/Desktop/worldly/_shots';
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const shots = [
  { name: 'satellite', w: 1440, h: 900, style: 'satellite' },
  { name: 'atlas', w: 1440, h: 900, style: 'atlas' },
  { name: 'mobile', w: 390, h: 844, style: 'satellite', mobile: true },
];
const only = process.argv[2];
for (const s of shots) {
  if (only && s.name !== only) continue;
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}?style=${s.style}`);
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  await page.evaluate(() => Promise.all([...document.images].map((i) => i.complete || new Promise((r) => (i.onload = i.onerror = r)))));
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/mock-swiss-${s.name}.png` });
  console.log('shot', s.name);
  await ctx.close();
}
await browser.close();
