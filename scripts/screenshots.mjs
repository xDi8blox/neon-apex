// Captures README screenshots with headless Chromium (software GL via SwiftShader).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs
// Env: QUALITY=0|1|2 (default 2), WET=1, OUT=prefix, FULL_RACE=1 (also captures results)
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const q = process.env.QUALITY ?? '2', wet = process.env.WET ?? '0', out = process.env.OUT ?? '';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
const shot = async name => { await page.screenshot({ path: `screenshots/${out}${name}.png`, timeout: 300000 }); console.log('captured', name, new Date().toISOString()); };
const T = { timeout: 900000, polling: 500 };

await page.goto(`${URL}?quality=${q}&wet=${wet}&autopilot=1`);
await page.waitForFunction(() => window.__game && !document.getElementById('btn-start').disabled, null, T);
await page.waitForTimeout(8000);
await shot('menu');
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(4000);
await shot('intro');
await page.evaluate(() => window.__game.skipIntro());
await page.waitForTimeout(2500);
await shot('race-start');
await page.waitForFunction(() => window.__game.state === 'race', null, T);
await page.waitForFunction(() => window.__game.player.speed > 38, null, T).catch(() => {});
await shot('gameplay');
await page.evaluate(() => window.__game.setNitro(true));
await page.waitForTimeout(2500);
await shot('nitro');
await page.evaluate(() => window.__game.setNitro(false));
await page.waitForTimeout(3000);
await page.evaluate(() => window.__game.setCamera(2));
await page.waitForTimeout(3000);
await shot('tv-camera');
if (process.env.FULL_RACE === '1') {
  await page.goto(`${URL}?quality=${q}&wet=${wet}&autopilot=1`);
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-start').disabled, null, T);
  await page.selectOption('#opt-laps', '1');
  await page.selectOption('#opt-ai', '3');
  await page.evaluate(() => window.__game.start());
  await page.evaluate(() => window.__game.skipIntro());
  await page.waitForFunction(() => window.__game.state === 'results', null, { timeout: 1800000, polling: 1000 });
  await page.waitForTimeout(800);
  await shot('results');
}
console.log('player', JSON.stringify(await page.evaluate(() => window.__game.player)), 'fps', await page.evaluate(() => window.__game.fps));
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
await browser.close();
