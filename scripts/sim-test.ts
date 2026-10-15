// Headless regression test: drives the AI controller around the circuit at several skill levels
// and reports lap times + barrier contacts. Run with `npm run test:sim`.
import * as THREE from 'three';
import { Track, WALL_OFFSET, ROAD_WIDTH } from '../src/track';
import { CarPhysics } from '../src/car';
const track = new Track(); const N = track.N, ds = track.length / N;
console.log('track length', track.length.toFixed(0));
for (const [skill, useNitro] of [[0.86, false], [0.95, false], [1.0, false], [1.02, false], [1.0, true]] as const) {
const p = new CarPhysics(); p.power = skill; p.stability = 0.6; const s0 = track.samples[N - 10];
p.pos.copy(s0.p); p.heading = Math.atan2(s0.t.x, -s0.t.z);
let idx = N - 10, t = 0, hits = 0, laps = 0, lapT = 0, maxLat = 0; const times: string[] = [];
const tv = new THREE.Vector3(), tf = new THREE.Vector3();
while (t < 400 && laps < 3) {
  const look = Math.round((7 + Math.max(p.vf, 0) * 0.55) / ds); const s = track.samples[(idx + look) % N];
  const off = s.racingOffset * 0.9;
  tv.set(s.p.x + s.n.x * off - p.pos.x, 0, s.p.z + s.n.z * off - p.pos.z).normalize();
  const f = p.forward(tf); const ang = Math.atan2(f.x * tv.z - f.z * tv.x, f.dot(tv));
  let target = Infinity; for (let k = 0; k < 60; k += 4) target = Math.min(target, track.samples[(idx + k) % N].targetSpeed);
  target *= skill; const err = target - Math.max(p.vf, 0);
  p.step({ steer: THREE.MathUtils.clamp(ang * 2.4 - p.yawRate * 0.08, -1, 1), throttle: THREE.MathUtils.clamp(err * 0.35 + 0.3, 0, 1), brake: err < -2 ? THREE.MathUtils.clamp(-err * 0.15, 0, 1) : 0, handbrake: false, nitro: useNitro && p.nitro > 0.25 && target > Math.max(p.vf, 0) + 12 && Math.abs(ang) < 0.06 }, 1 / 120);
  t += 1 / 120; const prev = idx; idx = track.nearest(p.pos, idx);
  const lat = Math.abs(track.lateral(p.pos, idx)); maxLat = Math.max(maxLat, lat);
  if (lat > WALL_OFFSET - 1.15) hits++;
  if (prev > N * 0.8 && idx < N * 0.2) { laps++; times.push((t - lapT).toFixed(2)); lapT = t; }
}
console.log('skill', skill, 'nitro', useNitro, 'laps', times.join(','), 'wallFrames', hits, 'maxLat', maxLat.toFixed(1), 'roadHalf', ROAD_WIDTH / 2);
if (hits > 0 || laps < 3) { console.error('FAIL: AI left the road or did not finish'); process.exitCode = 1; }
}
