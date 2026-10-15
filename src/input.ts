import { TouchControls } from './touch';
/** Keyboard + Gamepad input aggregation. */
export class Input {
  keys = new Set<string>();
  private pressed = new Set<string>();
  private padPrev: boolean[] = [];
  usingPad = false;
  touch: TouchControls;
  constructor() {
    this.touch = new TouchControls(code => this.pressed.add(code));
    window.addEventListener('keydown', e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    // never leave a key stuck: clear on focus loss / app switch, and treat modifier-less keyup reliably
    const clear = () => this.keys.clear();
    window.addEventListener('blur', clear); window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
  }
  /** One-shot press (consumed). */
  hit(code: string) { const h = this.pressed.has(code); this.pressed.delete(code); return h; }
  endFrame() { this.pressed.clear(); }

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }
  /** Map pad buttons to virtual key presses: A=handbrake held, Y=camera, Start=pause. */
  pollPad() {
    const p = this.pad(); if (!p) return;
    const map: Record<number, string> = { 3: 'KeyC', 9: 'Escape', 0: 'PadA' };
    for (const [b, code] of Object.entries(map)) {
      const down = !!p.buttons[+b]?.pressed;
      if (down && !this.padPrev[+b]) { this.pressed.add(code); this.usingPad = true; }
      this.padPrev[+b] = down;
    }
  }
  controls() {
    const k = this.keys;
    let throttle = (k.has('KeyW') || k.has('ArrowUp')) ? 1 : 0;
    let brake = (k.has('KeyS') || k.has('ArrowDown')) ? 1 : 0;
    let steer = ((k.has('KeyD') || k.has('ArrowRight')) ? 1 : 0) - ((k.has('KeyA') || k.has('ArrowLeft')) ? 1 : 0);
    let handbrake = k.has('Space');
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN');
    const t = this.touch;
    if (t.active) {
      if (t.steer !== 0) steer = t.steer;
      throttle = Math.max(throttle, t.throttle); brake = Math.max(brake, t.brake);
      handbrake = handbrake || t.handbrake; nitro = nitro || t.nitro;
    }
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > 0.12) { steer = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.5); this.usingPad = true; }
      const rt = p.buttons[7]?.value ?? 0, lt = p.buttons[6]?.value ?? 0;
      if (rt > 0.05) throttle = Math.max(throttle, rt);
      if (lt > 0.05) brake = Math.max(brake, lt);
      if (p.buttons[0]?.pressed || p.buttons[1]?.pressed) handbrake = true;
      if (p.buttons[2]?.pressed || p.buttons[5]?.pressed) nitro = true;
    }
    return { throttle, brake, steer, handbrake, nitro };
  }
}
