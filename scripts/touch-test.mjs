// Multi-touch regression test: steering must keep responding while gas + nitro are held, while a finger
// slides between ◀ and ▶, while other fingers come and go, and after touchcancel. Usage: preview on :4173, npm run test:touch
import { chromium, devices } from 'playwright';
const URL = process.env.URL ?? 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ ...devices['iPhone 13 landscape'] });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));
let failed = 0; const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg, ok ? '' : JSON.stringify(c)); if (!ok) { failed++; process.exitCode = 1; } };
const cdp = await ctx.newCDPSession(page);
const pts = new Map(); let nextId = 1;
// Synthetic multi-touch with stable identifiers (CDP renumbers fingers on partial release).
const send = (type, changed) => page.evaluate(({ type, all, changed }) => {
  const mk = p => new Touch({ identifier: p.id, target: document.elementFromPoint(p.x, p.y) || document.body, clientX: p.x, clientY: p.y, pageX: p.x, pageY: p.y });
  const ch = changed.map(mk);
  const target = ch[0] ? ch[0].target : document.body;
  target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, composed: true, touches: all.map(mk), targetTouches: all.map(mk), changedTouches: ch }));
}, { type, all: [...pts.values()], changed });
const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const down = async (name, sel) => { const c = await center(sel); const p = { ...c, id: nextId++ }; pts.set(name, p); await send('touchstart', [p]); };
const move = async (name, sel) => { const c = await center(sel); const p = { ...pts.get(name), ...c }; pts.set(name, p); await send('touchmove', [p]); };
const up = async name => { const p = pts.get(name); pts.delete(name); await send('touchend', [p]); };
const ctl = () => page.evaluate(() => window.__game.controls);
const wait = ms => page.waitForTimeout(ms);

// await page.addInitScript(() => { window.__tl = []; for (const t of ['touchstart','touchmove','touchend','touchcancel']) document.addEventListener(t, e => window.__tl.push(t[5] + ':' + [...e.changedTouches].map(x => x.identifier).join(',') + '/' + [...e.touches].map(x => x.identifier).join(',')), true); });
await page.goto(URL);
await page.waitForFunction(() => window.__game?.screen === 'main', null, { timeout: 300000 });
await page.evaluate(() => window.__game.quick({ track: 'sunset', laps: 3, opponents: 1 }));
await page.waitForFunction(() => window.__game.state === 'intro', null, { timeout: 300000 });
await page.evaluate(() => window.__game.skipIntro());
await page.waitForFunction(() => window.__game.state === 'race', null, { timeout: 300000, polling: 200 });

await down('gas', '.tb.gas'); await down('nitro', '.tb.nitro'); await wait(300);
let c = await ctl(); check(c.throttle === 1 && c.nitro && c.steer === 0, 'gas + nitro held, no steer');
await down('steer', '[data-hold=left]'); await wait(150);
c = await ctl(); check(c.steer === -1 && c.throttle === 1 && c.nitro, 'left while boosting');
await move('steer', '[data-hold=right]'); await wait(150);
c = await ctl(); check(c.steer === 1, 'slide left -> right');
await move('steer', '[data-hold=left]'); await wait(150);
c = await ctl(); check(c.steer === -1, 'slide right -> left');
await down('brake', '.tb.brake'); await up('brake'); await down('drift', '[data-hold=drift]'); await wait(150);
c = await ctl(); check(c.steer === -1 && c.handbrake, 'steer survives other fingers coming and going');
await up('drift'); await up('nitro'); await wait(100);
c = await ctl(); check(c.steer === -1 && c.throttle === 1 && !c.nitro, 'steer survives nitro release');
await down('cam', '#t-cam'); await page.evaluate(() => document.querySelector('#t-cam').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }))); await up('cam'); await wait(200);
c = await ctl(); check(c.steer === -1, 'steer survives camera button tap');
await page.evaluate(() => window.__game.demo('nearmiss')); await wait(400);
c = await ctl(); check(c.steer === -1, 'steer survives slow-mo');
await move('steer', '.t-top'); await wait(100);
c = await ctl(); check(c.steer === 0 && c.throttle === 1, 'sliding off the buttons releases steer only');
await move('steer', '[data-hold=right]'); await wait(100);
c = await ctl(); check(c.steer === 1, 'sliding back onto ▶ steers again');
await up('steer'); await wait(100);
c = await ctl(); check(c.steer === 0, 'lift releases steer');
// a second finger on the other arrow, then lift the first: the remaining one must win
await down('a', '[data-hold=left]'); await down('b', '[data-hold=right]'); await wait(100);
c = await ctl(); check(c.steer === 1, 'newest arrow wins when both held');
await up('b'); await wait(100);
c = await ctl(); check(c.steer === -1, 'remaining arrow takes over');
// touchcancel (system gesture) must not leave anything stuck
{ const all=[...pts.values()]; pts.clear(); await send('touchcancel', all); } await wait(100);
c = await ctl(); check(c.steer === 0 && c.throttle === 0, 'touchcancel clears all controls');
await down('gas', '.tb.gas'); await down('steer', '[data-hold=right]'); await wait(100);
c = await ctl(); check(c.steer === 1 && c.throttle === 1, 'controls work again after cancel (identifier reuse safe)');
await up('steer'); await up('gas');
// rapid repeated taps: no stale state
for (let i = 0; i < 10; i++) { await down('s', i % 2 ? '[data-hold=left]' : '[data-hold=right]'); await up('s'); }
c = await ctl(); check(c.steer === 0, 'no stuck steer after rapid taps');
// keyboard can't stick across blur
await page.keyboard.down('ArrowLeft'); await wait(50);
c = await ctl(); check(c.steer === -1, 'keyboard left');
await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await wait(50);
c = await ctl(); check(c.steer === 0, 'blur clears held keys');
await page.keyboard.up('ArrowLeft');
console.log(errors.length ? errors.join('\n') : 'no console errors/warnings');
if (errors.length) process.exitCode = 1;
await browser.close();
