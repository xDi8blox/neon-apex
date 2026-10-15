/**
 * Procedural infernal industrial soundtrack (Web Audio, no samples): a lookahead step sequencer
 * playing a distorted kick, metallic snare/anvil hits, a galloping overdriven bass, a phrygian lead
 * and a low choir-like pad over Dm–E♭–B♭–C♯dim. Everything runs through a tanh waveshaper.
 * `intensity` 0 = menu (choir drone + tolling bell), 1 = race (full industrial drive).
 */
export class Music {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private timer = 0;
  private step = 0;
  private next = 0;
  private bpm = 132;
  intensity = 0;
  playing = false;
  // chord roots (MIDI) and triads
  private chords = [[50, 53, 57], [51, 55, 58], [46, 50, 53], [49, 52, 55]];

  attach(ctx: AudioContext, out: GainNode) {
    this.ctx = ctx; this.out = ctx.createGain(); this.out.gain.value = 0.5;
    const drive = ctx.createWaveShaper(); const c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(x * 2.2); }
    drive.curve = c; this.out.connect(drive); drive.connect(out);
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.playing) this.start();
  }
  start() {
    this.playing = true;
    if (!this.ctx || this.timer) return;
    this.next = this.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }
  stop() { this.playing = false; clearInterval(this.timer); this.timer = 0; }

  private hz(m: number) { return 440 * Math.pow(2, (m - 69) / 12); }
  private schedule() {
    const ctx = this.ctx!; const dt = 60 / this.bpm / 4; // 16th notes
    while (this.next < ctx.currentTime + 0.12) { this.play(this.step, this.next, dt); this.next += dt; this.step = (this.step + 1) % 256; }
  }
  private play(step: number, t: number, dt: number) {
    const bar = Math.floor(step / 16) % 4, s = step % 16, ch = this.chords[bar], hi = this.intensity > 0.5;
    // choir pad: low detuned saws through a vowel-ish bandpass, new chord each bar
    if (s === 0) for (const n of ch) { this.tone(this.hz(n - 12), t, dt * 16, 'sawtooth', hi ? 0.03 : 0.05, 700, 0.5, 'bandpass'); this.tone(this.hz(n - 12) * 1.006, t, dt * 16, 'sawtooth', hi ? 0.025 : 0.04, 1100, 0.6, 'bandpass'); }
    // tolling bell every two bars (menu and race)
    if (s === 0 && bar % 2 === 0) this.bell(this.hz(ch[0] + 12), t);
    // phrygian lead motif: root, flat 2nd, root, 5th
    if (hi && s % 4 === 2) { const m = [0, 1, 0, 7, 0, 1, 3, 1][(s >> 2) + (bar % 2) * 4]; this.tone(this.hz(ch[0] + 12 + m), t, dt * 1.6, 'square', 0.02, 1800, 0.01); }
    if (!hi && s === 8 && bar % 2 === 1) this.tone(this.hz(ch[0] + 13), t, dt * 6, 'triangle', 0.03, 1400, 0.05);
    // bass: galloping 16ths (x.xx) on the root in races, a slow drone in menus
    if (hi ? [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15].includes(s) : s === 0) this.tone(this.hz(ch[0] - 24), t, hi ? dt * 0.8 : dt * 15, 'sawtooth', hi ? 0.13 : 0.09, hi ? 700 : 260, 0.004);
    if (!hi) { if (s === 0 && bar === 0) this.kick(t, 0.35); return; }
    if (s % 4 === 0 || s === 14) this.kick(t, 0.6);
    if (s === 4 || s === 12) this.snare(t);
    if (s === 8 && bar === 3) this.anvil(t);
    if (s % 2 === 1) this.hat(t, s % 4 === 3 ? 0.045 : 0.025);
  }
  private bell(f: number, t: number) { for (const [r, v] of [[1, 0.05], [2.76, 0.025], [5.4, 0.012], [0.5, 0.03]]) this.tone(f * r, t, 1.8, 'sine', v, 6000, 0.003); }
  private anvil(t: number) { for (const r of [1, 1.47, 2.09, 2.83]) this.tone(620 * r, t, 0.25, 'square', 0.025, 7000, 0.001); this.noiseHit(t, 0.12, 3500, 'bandpass', 0.2); }
  private tone(f: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff: number, attack: number, filter: BiquadFilterType = 'lowpass') {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; lp.type = filter; lp.frequency.value = cutoff; if (filter === 'bandpass') lp.Q.value = 2.5;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.setTargetAtTime(0, t + dur * 0.8, dur * 0.15 + 0.02);
    o.connect(lp); lp.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur * 1.6 + 0.2);
  }
  private kick(t: number, vol = 0.5) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.1);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.32);
  }
  private noiseHit(t: number, vol: number, freq: number, type: BiquadFilterType, dur: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  private snare(t: number) { this.noiseHit(t, 0.24, 2200, 'bandpass', 0.16); this.tone(180, t, 0.06, 'triangle', 0.12, 2000, 0.002); this.tone(540, t, 0.05, 'square', 0.03, 5000, 0.001); this.tone(810, t, 0.04, 'square', 0.02, 5000, 0.001); }
  private hat(t: number, v: number) { this.noiseHit(t, v, 8000, 'highpass', 0.04); }
}
