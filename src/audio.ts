/** Fully procedural Web Audio: engine (RPM-driven oscillators), tire screech, impacts, beeps. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  musicBus!: GainNode;
  private rainGain: GainNode | null = null;
  sfxVol = 0.8; musicVol = 0.5;
  onInit: (() => void) | null = null;
  private eng: OscillatorNode[] = [];
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private skidFilter!: BiquadFilterNode;
  private boostGain!: GainNode;
  private wasBoosting = false;
  muted = localStorage.getItem('neonapex.muted') === '1';

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = this.ctx = new Ctx();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.sfxVol; this.sfx.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.musicVol; this.musicBus.connect(this.master);
    // engine: saw + square an octave down + sub sine, through a resonant lowpass
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain); this.engGain.connect(this.sfx);
    const types: OscillatorType[] = ['sawtooth', 'square', 'sine'];
    const mix = [0.35, 0.18, 0.5];
    types.forEach((t, i) => {
      const o = ctx.createOscillator(); o.type = t;
      const g = ctx.createGain(); g.gain.value = mix[i];
      o.connect(g); g.connect(this.engFilter); o.start(); this.eng.push(o);
    });
    // tire screech: filtered noise
    const noise = ctx.createBufferSource(); noise.buffer = this.noiseBuffer(2); noise.loop = true;
    this.skidFilter = ctx.createBiquadFilter(); this.skidFilter.type = 'bandpass'; this.skidFilter.frequency.value = 1800; this.skidFilter.Q.value = 3;
    this.skidGain = ctx.createGain(); this.skidGain.gain.value = 0;
    noise.connect(this.skidFilter); this.skidFilter.connect(this.skidGain); this.skidGain.connect(this.sfx); noise.start();
    // nitro: low rumbling roar (lowpassed noise)
    const roar = ctx.createBufferSource(); roar.buffer = this.noiseBuffer(2); roar.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 420;
    this.boostGain = ctx.createGain(); this.boostGain.gain.value = 0;
    roar.connect(rf); rf.connect(this.boostGain); this.boostGain.connect(this.sfx); roar.start();
    this.onInit?.();
  }
  private noiseBuffer(sec: number) {
    const ctx = this.ctx!, b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  setMuted(m: boolean) {
    this.muted = m; localStorage.setItem('neonapex.muted', m ? '1' : '0');
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }
  update(rpm: number, throttle: number, skid: number, active: boolean, boosting = false) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 28 + rpm / 60 * 1.0; // firing frequency (4-cyl-ish: rpm/60*2 /2)
    this.eng[0].frequency.setTargetAtTime(f, t, 0.03);
    this.eng[1].frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.eng[2].frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 0.25 + throttle * 1400, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? 0.22 + throttle * 0.25 : 0, t, 0.08);
    this.skidGain.gain.setTargetAtTime(active ? Math.min(skid, 1) * 0.25 : 0, t, 0.05);
    this.boostGain.gain.setTargetAtTime(active && boosting ? 0.55 : 0, t, boosting ? 0.04 : 0.25);
    if (boosting && !this.wasBoosting) this.whoosh();
    this.wasBoosting = boosting;
  }
  private whoosh() {
    if (!this.ctx) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.8);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, this.ctx.currentTime); f.frequency.exponentialRampToValueAtTime(3000, this.ctx.currentTime + 0.6);
    const g = this.ctx.createGain(); g.gain.value = 0.5; g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.3, 0.15);
    src.connect(f); f.connect(g); g.connect(this.sfx); src.start();
  }
  beep(freq: number, dur = 0.18) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.25;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + dur * 0.7, 0.03);
    o.connect(g); g.connect(this.sfx); o.start(); o.stop(this.ctx.currentTime + dur + 0.2);
  }
  impact(strength: number) {
    if (!this.ctx || strength < 0.05) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.3);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = this.ctx.createGain(); g.gain.value = Math.min(1, strength) * 0.8;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.05, 0.06);
    src.connect(f); f.connect(g); g.connect(this.sfx); src.start();
  }

  setVolumes(sfx: number, music: number) {
    this.sfxVol = sfx; this.musicVol = music;
    if (!this.ctx) return;
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.05);
    this.musicBus.gain.setTargetAtTime(music, this.ctx.currentTime, 0.05);
  }
  /** Steady rain ambience (0 = off). */
  setRain(level: number) {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(3); src.loop = true;
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6000;
      this.rainGain = this.ctx.createGain(); this.rainGain.gain.value = 0;
      src.connect(hp); hp.connect(lp); lp.connect(this.rainGain); this.rainGain.connect(this.sfx); src.start();
    }
    this.rainGain.gain.setTargetAtTime(level * 0.16, this.ctx.currentTime, 0.4);
  }
  /** Bright arpeggio chime for bonuses (perfect start, combos). */
  chime(base = 660, notes = 3) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < notes; i++) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'triangle'; o.frequency.value = base * [1, 1.26, 1.5, 2][i % 4];
      g.gain.setValueAtTime(0, t0 + i * 0.07); g.gain.linearRampToValueAtTime(0.22, t0 + i * 0.07 + 0.01); g.gain.setTargetAtTime(0, t0 + i * 0.07 + 0.08, 0.08);
      o.connect(g); g.connect(this.sfx); o.start(t0 + i * 0.07); o.stop(t0 + i * 0.07 + 0.6);
    }
  }
  /** Deep boom + sweep for shockwaves and takedowns. */
  boom(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    g.gain.setValueAtTime(0.7 * strength, t); g.gain.setTargetAtTime(0, t + 0.1, 0.15);
    o.connect(g); g.connect(this.sfx); o.start(); o.stop(t + 1);
    this.impact(strength);
  }
  swish() { this.whoosh(); }
}
