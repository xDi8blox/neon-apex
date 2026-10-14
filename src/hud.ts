import * as THREE from 'three';
import type { Track } from './track';

export function fmt(t: number) {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

interface HudRacer { phys: { pos: THREE.Vector3; speed: number; rpm: number; gear: number; vf: number; heading: number }; isPlayer: boolean; crossings: number; place: number; lapStart: number; lastLap: number; bestLap: number; finished: boolean; }

export class Hud {
  private el = (id: string) => document.getElementById(id)!;
  private speedo = (document.getElementById('speedo') as HTMLCanvasElement).getContext('2d')!;
  private map = (document.getElementById('minimap') as HTMLCanvasElement).getContext('2d')!;
  private mapBg: HTMLCanvasElement;
  private toMap: (x: number, z: number) => [number, number];
  private msgT = 0;
  constructor(track: Track) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const s of track.samples) { minX = Math.min(minX, s.p.x); maxX = Math.max(maxX, s.p.x); minZ = Math.min(minZ, s.p.z); maxZ = Math.max(maxZ, s.p.z); }
    const size = 220, pad = 18, sc = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * sc) / 2, oz = (size - (maxZ - minZ) * sc) / 2;
    this.toMap = (x, z) => [ox + (x - minX) * sc, oz + (z - minZ) * sc];
    this.mapBg = document.createElement('canvas'); this.mapBg.width = this.mapBg.height = size;
    const c = this.mapBg.getContext('2d')!;
    c.lineJoin = 'round';
    for (const [w, col] of [[9, 'rgba(0,0,0,.6)'], [5, '#cfd6e6']] as const) {
      c.beginPath(); c.lineWidth = w; c.strokeStyle = col;
      track.samples.forEach((s, i) => { const [x, y] = this.toMap(s.p.x, s.p.z); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      c.closePath(); c.stroke();
    }
    const s0 = track.samples[0]; const [sx, sy] = this.toMap(s0.p.x, s0.p.z);
    c.fillStyle = '#fff'; c.fillRect(sx - 6, sy - 1.5, 12, 3);
  }
  show(on: boolean) { this.el('hud').classList.toggle('hidden', !on); }
  flash(text: string, t: number) { const m = this.el('h-msg'); m.textContent = text; m.className = text.length > 4 ? 'small' : ''; this.msgT = t; }
  lights(countdown: number) {
    const L = this.el('lights'); const n = Math.min(5, Math.max(0, Math.floor((4 - countdown) / 3 * 5) + 1));
    L.classList.add('on'); L.classList.toggle('go', countdown <= 1);
    Array.from(L.children).forEach((c, i) => c.classList.toggle('red', i < n && countdown > 1));
  }
  update(dt: number, player: HudRacer, racers: HudRacer[], laps: number, time: number, best: number, fps: number) {
    const lap = Math.min(laps, Math.max(1, player.crossings));
    this.el('h-pos').textContent = `${player.place}/${racers.length}`;
    this.el('h-lap').textContent = `${lap}/${laps}`;
    this.el('h-time').textContent = fmt(player.crossings >= 1 && !player.finished ? time - player.lapStart : time);
    this.el('h-last').textContent = player.lastLap ? fmt(player.lastLap) : '--';
    this.el('h-best').textContent = isFinite(best) ? fmt(best) : '--';
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.el('h-msg').textContent = ''; }
    if (time > 2) this.el('lights').classList.remove('on');
    this.drawSpeedo(player, fps);
    this.drawMap(player, racers);
  }
  private drawSpeedo(p: HudRacer, fps: number) {
    const c = this.speedo, W = 260, cx = 130, cy = 140, R = 100;
    c.clearRect(0, 0, W, W);
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    c.lineCap = 'round';
    c.beginPath(); c.arc(cx, cy, R, a0, a1); c.lineWidth = 14; c.strokeStyle = 'rgba(0,0,0,.55)'; c.stroke();
    const rpmT = Math.min(1, p.phys.rpm / 8400);
    const grad = c.createLinearGradient(30, 0, 230, 0); grad.addColorStop(0, '#00e5ff'); grad.addColorStop(0.75, '#ff7a2d'); grad.addColorStop(1, '#ff2d55');
    c.beginPath(); c.arc(cx, cy, R, a0, a0 + (a1 - a0) * rpmT); c.lineWidth = 10; c.strokeStyle = grad; c.stroke();
    c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,.6)';
    for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8.4; c.beginPath(); c.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16)); c.lineTo(cx + Math.cos(a) * (R - 24), cy + Math.sin(a) * (R - 24)); c.stroke(); }
    const kmh = Math.round(Math.abs(p.phys.vf) * 3.6);
    c.textAlign = 'center'; c.fillStyle = '#fff'; c.shadowColor = '#00e5ff'; c.shadowBlur = 12;
    c.font = 'italic 800 58px system-ui, sans-serif'; c.fillText(String(kmh), cx, cy + 12);
    c.shadowBlur = 0; c.font = '600 13px system-ui'; c.fillStyle = '#7ff6ff'; c.fillText('KM/H', cx, cy + 32);
    c.font = '800 24px system-ui'; c.fillStyle = p.phys.rpm > 7400 ? '#ff2d55' : '#fff';
    c.fillText(p.phys.vf < -0.5 ? 'R' : String(p.phys.gear), cx, cy + 66);
    c.font = '11px system-ui'; c.fillStyle = 'rgba(255,255,255,.45)'; c.fillText(`${Math.round(fps)} FPS`, cx, cy + 88);
  }
  private drawMap(player: HudRacer, racers: HudRacer[]) {
    const c = this.map; c.clearRect(0, 0, 220, 220); c.drawImage(this.mapBg, 0, 0);
    for (const r of racers) {
      if (r === player) continue;
      const [x, y] = this.toMap(r.phys.pos.x, r.phys.pos.z);
      c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fillStyle = '#ffc21a'; c.fill();
    }
    const [x, y] = this.toMap(player.phys.pos.x, player.phys.pos.z);
    c.save(); c.translate(x, y); c.rotate(player.phys.heading);
    c.beginPath(); c.moveTo(0, -8); c.lineTo(5, 6); c.lineTo(-5, 6); c.closePath();
    c.fillStyle = '#ff2d75'; c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.fill(); c.stroke(); c.restore();
  }
}
