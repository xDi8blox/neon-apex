// Captures README screenshots of every screen (quality 1, SwiftShader). Usage: preview on :4173, then node scripts/screens.mjs
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
const T = { timeout: 600000, polling: 300 };
const shot = async n => { await page.screenshot({ path: `screenshots/${n}.png`, timeout: 300000 }); console.log('captured', n); };
await page.goto(`${URL}?quality=1&autopilot=1`);
await page.waitForTimeout(1200); await shot('loading');
await page.waitForFunction(() => window.__game?.screen === 'main', null, T); await page.waitForTimeout(4000); await shot('menu');
await page.click('#m-play'); await page.waitForTimeout(2500); await shot('modes');
await page.click('[data-mode=quick]'); await page.waitForTimeout(2500); await shot('tracks');
await page.click('#scr-track [data-back]'); await page.click('#scr-mode [data-back]'); await page.waitForTimeout(600);
await page.click('#m-garage'); await page.waitForTimeout(3500); await shot('garage');
await page.click('#g-next'); await page.click('#g-next'); await page.click('#g-next'); await page.waitForTimeout(3000); await shot('garage-drifter');
await page.click('#scr-garage [data-back]'); await page.waitForTimeout(600);
await page.click('#m-options'); await page.waitForTimeout(1500); await shot('options');
await page.click('#scr-options [data-back]'); await page.waitForTimeout(600);
for (const [id, name] of [['harbour', 'night-harbour'], ['highland', 'rain-highland']]) {
  await page.evaluate(t => window.__game.quick({ track: t, laps: 2, opponents: 5 }), id);
  await page.waitForFunction(() => window.__game.state === 'intro', null, T); await page.evaluate(() => window.__game.skipIntro());
  await page.waitForFunction(() => window.__game.state === 'race' && window.__game.player.speed > 30, null, T);
  await page.waitForTimeout(2000); await shot(name);
  if (id === 'harbour') {
    await page.evaluate(() => { window.__game.demo('drift'); window.__game.demo('nearmiss'); }); await page.waitForTimeout(250); await shot('combo-nearmiss');
    await page.evaluate(() => window.__game.demo('shock')); await page.waitForTimeout(250); await shot('shockwave');
    await page.evaluate(() => window.__game.demo('takedown')); await page.waitForTimeout(300); await shot('takedown');
  }
}
await page.evaluate(() => window.__game.finishNow());
await page.waitForFunction(() => window.__game.state === 'replay', null, T); await page.waitForTimeout(2500); await shot('replay');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game.state === 'podium', null, T); await page.waitForTimeout(2500); await shot('podium');
await page.evaluate(() => window.__game.quick({ mode: 'champ', laps: 1 }));
await page.waitForFunction(() => window.__game.state === 'intro', null, T); await page.evaluate(() => window.__game.skipIntro());
await page.waitForFunction(() => window.__game.state === 'race', null, T); await page.evaluate(() => window.__game.finishNow());
await page.waitForFunction(() => window.__game.state === 'replay', null, T); await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game.state === 'podium', null, T); await page.click('#btn-again');
await page.waitForFunction(() => window.__game.screen === 'standings', null, T); await page.waitForTimeout(1500); await shot('standings');
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
await browser.close();
