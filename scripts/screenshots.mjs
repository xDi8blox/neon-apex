// Captures README screenshots with headless Chromium (software GL).
// Usage: npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs
import { chromium } from 'playwright';

const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
const q = process.env.QUALITY ?? '2';
await page.goto(`${URL}?quality=${q}&autopilot=1`);
await page.waitForTimeout(6000);
await page.screenshot({ path: 'screenshots/menu.png' });
await page.evaluate(() => window.__game.start());
await page.waitForTimeout(1800);
await page.screenshot({ path: 'screenshots/race-start.png' });
await page.waitForFunction(() => window.__game.state === 'race', null, { timeout: 60000 });
await page.waitForFunction(() => window.__game.player.speed > 35, null, { timeout: 120000 }).catch(() => {});
await page.screenshot({ path: 'screenshots/gameplay.png' });
await page.waitForTimeout(4000);
await page.evaluate(() => window.__game.setCamera(2));
await page.waitForTimeout(2500);
await page.screenshot({ path: 'screenshots/tv-camera.png' });
await page.evaluate(() => window.__game.setCamera(1));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'screenshots/bumper-camera.png' });
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/pause.png' });
const fullRace = process.env.FULL_RACE === '1';
if (fullRace) {
// full 1-lap race to the results screen
await page.goto(`${URL}?quality=${q}&autopilot=1`);
await page.waitForTimeout(3000);
await page.selectOption('#opt-laps', '1');
await page.selectOption('#opt-ai', '3');
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.state === 'results', null, { timeout: 400000, polling: 1000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'screenshots/results.png' });
}
console.log('player', JSON.stringify(await page.evaluate(() => window.__game.player)), 'fps', await page.evaluate(() => window.__game.fps));
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
await browser.close();
