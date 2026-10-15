// Mobile smoke test: iPhone landscape emulation with touch. Taps the on-screen controls,
// checks the car responds, and captures screenshots/mobile.png.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/mobile-test.mjs
import { chromium, devices } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`));
const fail = msg => { console.error('FAIL:', msg); process.exitCode = 1; };
// real multi-touch via CDP: each held control keeps its own finger down
const cdp = await page.context().newCDPSession(page);
const fingers = new Map(); let nextId = 1;
const center = sel => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
const send = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [...fingers.values()] });
const hold = async (sel, down) => {
  if (down) { const c = await center(sel); fingers.set(sel, { ...c, id: nextId++ }); await send(fingers.size === 1 ? 'touchStart' : 'touchStart'); }
  else { const f = fingers.get(sel); fingers.delete(sel); await cdp.send('Input.dispatchTouchEvent', { type: fingers.size ? 'touchEnd' : 'touchEnd', touchPoints: [...fingers.values()] }); void f; }
};

await page.goto(URL);
await page.waitForFunction(() => window.__game?.screen === 'main', null, { timeout: 300000 });
const info = await page.evaluate(() => ({ touch: document.body.classList.contains('touch'), phone: document.body.classList.contains('phone'), w: innerWidth, h: innerHeight }));
console.log('device', JSON.stringify(info));
if (!info.touch) fail('touch mode not auto-detected');
await page.tap('#m-options'); await page.waitForTimeout(600);
if ((await page.inputValue('#o-quality')) !== '0') fail('mobile preset not auto-selected');
await page.tap('#scr-options [data-back]'); await page.waitForTimeout(600);
// garage on touch: switch car, then back
await page.tap('#m-garage'); await page.waitForTimeout(1200);
await page.tap('#g-next'); await page.waitForTimeout(400);
if ((await page.textContent('#g-name')) !== 'GT Apex') fail('garage arrow tap failed');
await page.screenshot({ path: 'screenshots/mobile-garage.png', timeout: 300000 });
await page.tap('#scr-garage [data-back]'); await page.waitForTimeout(600);
// play -> quick race -> track select -> start
await page.tap('#m-play'); await page.waitForTimeout(700);
await page.tap('[data-mode=quick]'); await page.waitForTimeout(700);
await page.screenshot({ path: 'screenshots/mobile-tracks.png', timeout: 300000 });
await page.tap('#t-start');
await page.waitForFunction(() => window.__game.state === 'intro', null, { timeout: 300000, polling: 300 });
await page.waitForTimeout(1000);
await page.touchscreen.tap(300, 200); // tap to skip the intro
await page.waitForFunction(() => window.__game.state === 'race', null, { timeout: 300000, polling: 300 });
if (!(await page.isVisible('.tb.gas'))) fail('touch buttons not visible during race');
await hold('.tb.gas', true);
await page.waitForTimeout(4000);
await hold('[data-hold=right]', true); await page.waitForTimeout(500); await hold('[data-hold=right]', false);
await hold('.tb.nitro', true);
await page.waitForTimeout(1200);
const p1 = await page.evaluate(() => window.__game.player);
console.log('after gas/nitro', JSON.stringify(p1));
if (p1.speed < 8) fail('car did not accelerate from touch GAS');
await page.screenshot({ path: 'screenshots/mobile.png', timeout: 300000 });
await hold('.tb.nitro', false); await hold('.tb.gas', false);
await page.tap('#t-cam');
await page.waitForTimeout(500);
const cam = await page.textContent('#h-cam');
if (!cam.includes('BUMPER')) fail('camera button did not switch camera: ' + cam);
await page.tap('#t-pause');
await page.waitForTimeout(500);
if ((await page.evaluate(() => window.__game.state)) !== 'paused') fail('pause button did not pause');
await page.tap('#btn-resume');
await page.waitForTimeout(500);
if ((await page.evaluate(() => window.__game.state)) !== 'race') fail('resume failed');
// portrait shows the rotate prompt
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
if (!(await page.isVisible('#rotate'))) fail('rotate prompt not shown in portrait');
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
if (errors.length) process.exitCode = 1;
await browser.close();
