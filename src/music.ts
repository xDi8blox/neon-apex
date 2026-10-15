/**
 * Procedural synthwave soundtrack (Web Audio, no samples): a lookahead step sequencer
 * playing kick/snare/hats, a pulsing bass, an arpeggio and pad chords over Am–F–C–G.
 * `intensity` 0 = menu (pads + soft arp), 1 = race (full drums, driving bass).
 */
export class Music {
  private ctx: AudioContext | null = null;
  private out!: GainNode;
  private noise!: AudioBuffer;
  private timer = 0;
  private step = 0;
  private next = 0;
  private bpm = 112;
  intensity = 0;
  playing = false;
  // chord roots (MIDI) and triads
  private chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];

  attach(ctx: AudioContext, out: GainNode) {
    this.ctx = ctx; this.out = ctx.createGain(); this.out.gain.value = 0.55; this.out.connect(out);
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
    // pad: new chord each bar
    if (s === 0) for (const n of ch) this.tone(this.hz(n), t, dt * 16, 'sawtooth', hi ? 0.035 : 0.05, 900, 0.4);
    // arpeggio: up-down over the triad, an octave up
    if (hi || s % 2 === 0) { const seq = [0, 1, 2, 1]; this.tone(this.hz(ch[seq[(s >> (hi ? 0 : 1)) % 4]] + 12), t, dt * 0.9, 'square', hi ? 0.03 : 0.022, 2600, 0.01); }
    // bass: 8ths on the root (race), whole notes (menu)
    if (hi ? s % 2 === 0 : s === 0) this.tone(this.hz(ch[0] - 24), t, hi ? dt * 1.6 : dt * 14, 'sawtooth', hi ? 0.12 : 0.08, hi ? 520 : 300, 0.005);
    if (!hi) return;
    if (s % 4 === 0) this.kick(t);
    if (s === 4 || s === 12) this.snare(t);
    if (s % 2 === 1) this.hat(t, s % 4 === 3 ? 0.05 : 0.03);
  }
  private tone(f: number, t: number, dur: number, type: OscillatorType, vol: number, cutoff: number, attack: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.setTargetAtTime(0, t + dur * 0.8, dur * 0.15 + 0.02);
    o.connect(lp); lp.connect(g); g.connect(this.out); o.start(t); o.stop(t + dur * 1.6 + 0.2);
  }
  private kick(t: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.out); o.start(t); o.stop(t + 0.32);
  }
  private noiseHit(t: number, vol: number, freq: number, type: BiquadFilterType, dur: number) {
    const ctx = this.ctx!, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
  }
  private snare(t: number) { this.noiseHit(t, 0.22, 1800, 'bandpass', 0.18); this.tone(190, t, 0.06, 'triangle', 0.12, 2000, 0.002); }
  private hat(t: number, v: number) { this.noiseHit(t, v, 8000, 'highpass', 0.04); }
}
