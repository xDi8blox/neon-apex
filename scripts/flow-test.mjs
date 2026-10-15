// End-to-end flow test (desktop): menus, garage, track switching, perfect start, championship
// standings over 3 rounds, time-trial ghost + delta, replay -> podium -> results. Fails on console errors.
// Usage: npm run build && npx vite preview --port 4173 & npm run test:flow
import { chromium } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
const t0 = Date.now(); const log = (...a) => console.log(`${((Date.now() - t0) / 1000).toFixed(0)}s`, ...a);
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
const T = { timeout: 600000, polling: 250 };
const g = expr => page.evaluate(expr);
const until = (fn, arg) => page.waitForFunction(fn, arg, T);

await page.goto(`${URL}?quality=0`);
await until(() => window.__game?.screen === 'main');
log('main menu');
// garage: pick the Storm Rally, paint it
await page.click('#m-garage'); await page.waitForTimeout(800);
await page.click('#g-next'); await page.click('#g-next');
if ((await page.textContent('#g-name')) !== 'Storm Rally') fail('garage next did not cycle cars');
await page.click('#g-paint i:nth-child(5)'); await page.click('#g-select'); await page.waitForTimeout(800);
if ((await g(() => window.__game.screen)) !== 'main') fail('select did not return to main');
if (!(await page.textContent('#m-car')).includes('Storm Rally')) fail('car selection not shown on main menu');
log('garage ok');
// options: units -> mph
await page.click('#m-options'); await page.selectOption('#o-units', 'mph'); await page.click('#scr-options [data-back]'); await page.waitForTimeout(500);
// quick race on Neon Harbour via the menus, perfect start with the real keyboard
await page.click('#m-play'); await page.waitForTimeout(500); await page.click('[data-mode=quick]'); await page.waitForTimeout(500);
await page.click('[data-track=harbour]'); await until(() => window.__game.track === 'harbour');
await page.selectOption('#opt-laps', '1'); await page.selectOption('#opt-ai', '3');
await page.click('#t-start');
await until(() => window.__game.state === 'intro'); await page.keyboard.press('Enter');
await until(() => window.__game.state === 'countdown' && window.__game.countdown < 1.25);
await page.keyboard.down('ArrowUp');
await until(() => window.__game.state === 'race');
await page.waitForTimeout(1500);
const sc = await g(() => window.__game.score);
if (sc < 500) fail('perfect start not awarded (score ' + sc + ')'); else log('perfect start ok, score', sc);
const speedo = await page.$eval('#speedo', c => c.toDataURL().length); void speedo;
await page.keyboard.up('ArrowUp');
await g(() => window.__game.finishNow());
await until(() => window.__game.state === 'replay'); log('replay');
await page.keyboard.press('Enter');
await until(() => window.__game.state === 'podium');
if (!(await page.isVisible('#results'))) fail('results not shown on podium');
log('podium + results ok');
// championship: three rounds via finishNow; 6 cars -> 10+8+6+5+4+3 = 36 points per round
await page.click('#btn-menu'); await until(() => window.__game.screen === 'main');
await page.click('#m-play'); await page.waitForTimeout(500); await page.click('[data-mode=champ]'); await page.waitForTimeout(500);
await page.click('#t-start');
for (let round = 0; round < 3; round++) {
  await until(r => window.__game.state === 'intro' && window.__game.champ.round === r, round);
  const trackId = await g(() => window.__game.track);
  await g(() => window.__game.skipIntro());
  await until(() => window.__game.state === 'race');
  await g(() => window.__game.finishNow());
  await until(() => window.__game.state === 'replay'); await page.keyboard.press('Enter');
  await until(() => window.__game.state === 'podium');
  await page.click('#btn-again'); // -> standings
  await until(() => window.__game.screen === 'standings');
  const pts = await g(() => window.__game.champ.points);
  const total = Object.values(pts).reduce((a, b) => a + b, 0);
  log(`round ${round + 1} on ${trackId}: total points ${total}`, await page.textContent('#st-title'));
  if (total !== 36 * (round + 1)) fail('championship points wrong: ' + total);
  if (round < 2) await page.click('#st-next');
}
if (!/CHAMPION|WINS THE TITLE/.test(await page.textContent('#st-title'))) fail('no final champion title');
await page.click('#st-next'); await until(() => window.__game.screen === 'main');
// time trial: autopilot laps record a ghost; second lap shows the delta
await g(() => window.__game.setAutopilot(true));
await g(() => window.__game.quick({ mode: 'tt', track: 'sunset', laps: 2 }));
await until(() => window.__game.state === 'intro'); await g(() => window.__game.skipIntro());
await until(() => window.__game.player.lap >= 2); log('tt lap 1 done');
const ghost = await g(() => !!localStorage.getItem('neonapex.ghost.sunset.' + window.__game.player.car));
if (!ghost) fail('ghost not saved after a time-trial lap');
await page.waitForTimeout(8000);
const delta = await g(() => window.__game.delta);
if (!/^[+−]\d/.test(delta)) fail('no ghost delta shown: ' + delta); else log('ghost delta', delta);
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
if (errors.length) process.exitCode = 1;
await browser.close();
