// Mobile-preset screenshots of every track (iPhone 13 landscape, quality auto = Low).
// Usage: preview on :4173, then node scripts/mobile-tracks.mjs [outDir]
import { chromium, devices } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const out = process.argv[2] ?? 'screenshots';
const only = process.env.TRACKS?.split(',');
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];
const T = { timeout: 400000, polling: 300 };
const tracks = [['sunset', 'lava-fields'], ['harbour', 'bone-cathedral'], ['highland', 'ashen-storm']].filter(([id]) => !only || only.includes(id));
await Promise.all(tracks.map(async ([id, name]) => {
  const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${URL}?autopilot=1`);
  await page.waitForFunction(() => window.__game?.screen === 'main', null, T);
  await page.evaluate(t => window.__game.quick({ track: t, laps: 2, opponents: 3 }), id);
  await page.waitForFunction(() => window.__game.state === 'intro', null, T); await page.evaluate(() => window.__game.skipIntro());
  await page.waitForFunction(() => window.__game.state === 'race' && window.__game.player.speed > 25, null, T);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/mobile-${name}.png`, timeout: 300000 });
  console.log('captured', `${out}/mobile-${name}.png`);
}));
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
await browser.close();
