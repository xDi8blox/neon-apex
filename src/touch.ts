/** On-screen touch controls + optional tilt steering. Only activated on touch devices. */
export const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
export const isPhone = () => isTouchDevice() && Math.min(screen.width, screen.height) < 600;

export class TouchControls {
  steer = 0; throttle = 0; brake = 0; handbrake = false; nitro = false;
  active = false;
  tilt = localStorage.getItem('neonapex.tilt') === '1';
  private tiltSteer = 0;
  /** touch identifier -> hold control currently under that finger (null = finger is on no control) */
  private fingers = new Map<number, string | null>();
  private holdEls: HTMLElement[] = [];
  private rects: { key: string; el: HTMLElement; l: number; t: number; r: number; b: number }[] = [];
  private lastSteer: 'left' | 'right' | null = null;

  constructor(private press: (code: string) => void) {
    if (!isTouchDevice()) return;
    this.active = true;
    document.body.classList.add('touch');
    const root = document.getElementById('touch')!;
    this.holdEls = [...root.querySelectorAll<HTMLElement>('[data-hold]')];
    // Hold controls are driven by raw touch events tracked per identifier over the whole screen, so a finger
    // can slide between buttons (◀ ▶) and other fingers starting/ending never disturb it.
    const onTouch = (e: TouchEvent) => this.onTouch(e);
    for (const t of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) document.addEventListener(t, onTouch as EventListener, { passive: false, capture: true });
    const clear = () => this.clearAll();
    window.addEventListener('blur', clear); window.addEventListener('pagehide', clear);
    document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
    window.addEventListener('resize', () => this.measure()); window.addEventListener('orientationchange', () => this.clearAll());
    root.querySelectorAll<HTMLElement>('[data-tap]').forEach(el =>
      el.addEventListener('pointerdown', e => { e.preventDefault(); this.press(el.dataset.tap!); }));
    // tilt toggle
    const tiltBtn = document.getElementById('t-tilt')!;
    this.label();
    tiltBtn.addEventListener('pointerdown', e => { e.preventDefault(); void this.setTilt(!this.tilt); });
    window.addEventListener('deviceorientation', e => {
      if (e.beta == null) return;
      // landscape: rolling the phone like a steering wheel changes beta; sign depends on which side is down
      const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 90) as number;
      const sign = angle === 270 || angle === -90 ? -1 : 1;
      const v = (e.beta * sign) / 22;
      this.tiltSteer = Math.max(-1, Math.min(1, Math.abs(v) < 0.06 ? 0 : v));
      if (this.tilt) this.sync();
    });
    // fullscreen
    const fs = document.getElementById('t-fs')!;
    if (!document.documentElement.requestFullscreen) fs.style.display = 'none';
    fs.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() =>
        (screen.orientation as unknown as { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {})).catch(() => {});
    });
    // block scroll, pinch-zoom, double-tap zoom, long-press menus
    const block = (e: Event) => { if (!(e.target as HTMLElement).closest('select, .card')) e.preventDefault(); };
    document.addEventListener('touchmove', block, { passive: false });
    document.addEventListener('gesturestart', e => e.preventDefault());
    document.addEventListener('contextmenu', e => e.preventDefault());
    let lastTap = 0;
    document.addEventListener('touchend', e => { const t = Date.now(); if (t - lastTap < 300 && !(e.target as HTMLElement).closest('select, button, input, .mcard, #g-paint, .screen')) e.preventDefault(); lastTap = t; }, { passive: false });
  }
  private label() {
    const b = document.getElementById('t-tilt'); if (b) b.textContent = this.tilt ? 'TILT ON' : 'TILT OFF';
    document.body.classList.toggle('tilt', this.tilt && this.active);
  }
  /** Enable/disable tilt steering (asks for iOS motion permission; call from a user gesture). Resolves to the new state. */
  async setTilt(on: boolean): Promise<boolean> {
    if (on) {
      const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (DOE && typeof DOE.requestPermission === 'function') {
        try { if ((await DOE.requestPermission()) !== 'granted') return this.tilt; } catch { return this.tilt; }
      }
    }
    this.tilt = on; localStorage.setItem('neonapex.tilt', on ? '1' : '0'); this.label(); this.sync();
    return on;
  }
  private measure() {
    this.rects = this.holdEls.map(el => {
      const r = el.getBoundingClientRect(), pad = 14; // forgiving hit area around each button
      return { key: el.dataset.hold!, el, l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad };
    }).filter(r => r.r - r.l > 2 * 14); // hidden controls have zero size
  }
  /** which hold control is under (x, y): nearest center among the padded rects that contain it */
  private hit(x: number, y: number): string | null {
    let best: string | null = null, bd = Infinity;
    for (const r of this.rects) {
      if (x < r.l || x > r.r || y < r.t || y > r.b) continue;
      const d = Math.hypot(x - (r.l + r.r) / 2, y - (r.t + r.b) / 2);
      if (d < bd) { bd = d; best = r.key; }
    }
    return best;
  }
  private onTouch(e: TouchEvent) {
    if (!document.body.classList.contains('racing')) { if (this.fingers.size) this.clearAll(); return; }
    if (e.type === 'touchstart' || !this.rects.length) this.measure();
    let onControl = false;
    for (const t of Array.from(e.changedTouches)) {
      if (e.type === 'touchend' || e.type === 'touchcancel') { this.fingers.delete(t.identifier); continue; }
      const k = this.hit(t.clientX, t.clientY);
      if (k) onControl = true;
      // touchstart on a tap button (pause/cam/tilt) is left to those buttons
      if (e.type === 'touchstart' && !k) { this.fingers.set(t.identifier, null); continue; }
      const prev = this.fingers.get(t.identifier);
      if ((k === 'left' || k === 'right') && k !== prev) this.lastSteer = k;
      this.fingers.set(t.identifier, k);
    }
    // reconcile with the authoritative list of active touches (drops fingers whose end event was lost)
    const live = new Set(Array.from(e.touches).map(t => t.identifier));
    for (const id of [...this.fingers.keys()]) if (!live.has(id)) this.fingers.delete(id);
    if (onControl && e.cancelable) e.preventDefault();
    this.sync();
  }
  /** release everything (blur, app switch, rotation, leaving the race) */
  clearAll() { this.fingers.clear(); this.lastSteer = null; this.sync(); }
  private h(k: string) { for (const v of this.fingers.values()) if (v === k) return true; return false; }
  private sync() {
    const L = this.h('left'), R = this.h('right');
    // both held (e.g. a finger sliding across): the most recently entered direction wins
    const btnSteer = L && R ? (this.lastSteer === 'left' ? -1 : 1) : R ? 1 : L ? -1 : 0;
    // tilt only steers while no steering button is held
    this.steer = this.tilt && btnSteer === 0 ? this.tiltSteer : btnSteer;
    for (const el of this.holdEls) el.classList.toggle('on', this.h(el.dataset.hold!));
    this.throttle = this.h('gas') ? 1 : 0;
    this.brake = this.h('brake') ? 1 : 0;
    this.handbrake = this.h('drift');
    this.nitro = this.h('nitro');
  }
}
