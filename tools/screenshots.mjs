// README screenshot: the demo song mid-playback.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const exe = process.env.PW_CHROMIUM_PATH;
const OUT = process.env.OUT || 'docs/img';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4179/?nosw=1');
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForFunction(() => window.__chip?.ready);
await page.click('#btn-play');
await page.waitForFunction(() => (window.__chip.playPos?.order ?? 0) === 1 && window.__chip.playPos.row >= 14, null, { timeout: 30000 });
await page.screenshot({ path: `${OUT}/studio.png` });
console.log('wrote studio');
await browser.close();
