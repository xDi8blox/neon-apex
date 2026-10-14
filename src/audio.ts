/** Fully procedural Web Audio: engine (RPM-driven oscillators), tire screech, impacts, beeps. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private eng: OscillatorNode[] = [];
  private engGain!: GainNode;
  private engFilter!: BiquadFilterNode;
  private skidGain!: GainNode;
  private skidFilter!: BiquadFilterNode;
  muted = localStorage.getItem('neonapex.muted') === '1';

  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = this.ctx = new Ctx();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.5;
    const comp = ctx.createDynamicsCompressor(); this.master.connect(comp); comp.connect(ctx.destination);
    // engine: saw + square an octave down + sub sine, through a resonant lowpass
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
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
    noise.connect(this.skidFilter); this.skidFilter.connect(this.skidGain); this.skidGain.connect(this.master); noise.start();
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
  update(rpm: number, throttle: number, skid: number, active: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 28 + rpm / 60 * 1.0; // firing frequency (4-cyl-ish: rpm/60*2 /2)
    this.eng[0].frequency.setTargetAtTime(f, t, 0.03);
    this.eng[1].frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.eng[2].frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(300 + rpm * 0.25 + throttle * 1400, t, 0.05);
    this.engGain.gain.setTargetAtTime(active ? 0.22 + throttle * 0.25 : 0, t, 0.08);
    this.skidGain.gain.setTargetAtTime(active ? Math.min(skid, 1) * 0.25 : 0, t, 0.05);
  }
  beep(freq: number, dur = 0.18) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.25;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + dur * 0.7, 0.03);
    o.connect(g); g.connect(this.master); o.start(); o.stop(this.ctx.currentTime + dur + 0.2);
  }
  impact(strength: number) {
    if (!this.ctx || strength < 0.05) return;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.3);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = this.ctx.createGain(); g.gain.value = Math.min(1, strength) * 0.8;
    g.gain.setTargetAtTime(0, this.ctx.currentTime + 0.05, 0.06);
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
  }
}
