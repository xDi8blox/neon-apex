/** On-screen touch controls + optional tilt steering. Only activated on touch devices. */
export const isTouchDevice = () => 'ontouchstart' in window || navigator.maxTouchPoints > 0;
export const isPhone = () => isTouchDevice() && Math.min(screen.width, screen.height) < 600;

export class TouchControls {
  steer = 0; throttle = 0; brake = 0; handbrake = false; nitro = false;
  active = false;
  tilt = localStorage.getItem('neonapex.tilt') === '1';
  private tiltSteer = 0;
  private held = new Map<string, number>(); // control -> pointer count

  constructor(private press: (code: string) => void) {
    if (!isTouchDevice()) return;
    this.active = true;
    document.body.classList.add('touch');
    const root = document.getElementById('touch')!;
    root.querySelectorAll<HTMLElement>('[data-hold]').forEach(el => {
      const key = el.dataset.hold!;
      const down = (e: PointerEvent) => { e.preventDefault(); try { el.setPointerCapture?.(e.pointerId); } catch { /* synthetic or already released */ } el.classList.add('on'); this.held.set(key, (this.held.get(key) ?? 0) + 1); this.sync(); };
      const up = (e: PointerEvent) => { e.preventDefault(); el.classList.remove('on'); this.held.set(key, Math.max(0, (this.held.get(key) ?? 1) - 1)); this.sync(); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    });
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
  private h(k: string) { return (this.held.get(k) ?? 0) > 0; }
  private sync() {
    const btnSteer = (this.h('right') ? 1 : 0) - (this.h('left') ? 1 : 0);
    this.steer = this.tilt && btnSteer === 0 ? this.tiltSteer : btnSteer;
    this.throttle = this.h('gas') ? 1 : 0;
    this.brake = this.h('brake') ? 1 : 0;
    this.handbrake = this.h('drift');
    this.nitro = this.h('nitro');
  }
}
