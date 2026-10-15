// HELLDRIVE gameplay captures at a chosen preset (headless Chromium, SwiftShader).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs
// Env: QUALITY=0|1|2 (default 2), OUT=prefix. Writes screenshots/<OUT><track>.png and <OUT>soul-burn.png.
// See also scripts/screens.mjs (every menu screen) and scripts/mobile-tracks.mjs (mobile preset per track).
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const q = process.env.QUALITY ?? '2', out = process.env.OUT ?? `q${process.env.QUALITY ?? '2'}-`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
const T = { timeout: 900000, polling: 500 };
const shot = async name => { await page.screenshot({ path: `screenshots/${out}${name}.png`, timeout: 300000 }); console.log('captured', `screenshots/${out}${name}.png`); };
await page.goto(`${URL}?quality=${q}&autopilot=1`);
await page.waitForFunction(() => window.__game?.screen === 'main', null, T);
for (const [id, name] of [['sunset', 'lava-fields'], ['harbour', 'bone-cathedral'], ['highland', 'ashen-storm']]) {
  await page.evaluate(t => window.__game.quick({ track: t, laps: 2, opponents: 5 }), id);
  await page.waitForFunction(() => window.__game.state === 'intro', null, T); await page.evaluate(() => window.__game.skipIntro());
  await page.waitForFunction(() => window.__game.state === 'race' && window.__game.player.speed > 30, null, T);
  await page.waitForTimeout(2000); await shot(name);
  if (id === 'sunset') { await page.evaluate(() => window.__game.setNitro(true)); await page.waitForTimeout(1500); await shot('soul-burn'); await page.evaluate(() => window.__game.setNitro(false)); }
}
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
await browser.close();
