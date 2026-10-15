import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { loadAssets, Assets } from './assets';
import { buildCar, flameUniforms } from './carmodel';
import { Track, ROAD_WIDTH, CURB_WIDTH, WALL_OFFSET } from './track';
import { CarPhysics, CarInput } from './car';
import { buildEnvironment } from './scenery';
import { SkidMarks, Smoke } from './effects';
import { AudioEngine } from './audio';
import { Input } from './input';
import { Hud, fmt } from './hud';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LS_BEST = 'neonapex.bestLap', LS_QUALITY = 'neonapex.quality', LS_WET = 'neonapex.wet';
const params = new URLSearchParams(location.search);

// ---------------- settings ----------------
import { isPhone, isTouchDevice } from './touch';
const phone = isPhone() || /iPhone|Android.+Mobile/i.test(navigator.userAgent);
const defaultQuality = phone ? 0 : 1; // phones get the Mobile preset
if (phone) document.body.classList.add('phone');
let quality = Number(params.get('quality') ?? localStorage.getItem(LS_QUALITY) ?? defaultQuality);
if (!(quality >= 0 && quality <= 2)) quality = 1;
($('opt-quality') as HTMLSelectElement).value = String(quality);
const wet = (params.get('wet') ?? localStorage.getItem(LS_WET) ?? '0') === '1';
($('opt-wet') as HTMLSelectElement).value = wet ? '1' : '0';

// ---------------- renderer / scene ----------------
if (isTouchDevice() && quality === 0) { const ai = document.getElementById('opt-ai') as HTMLSelectElement; ai.value = '3'; }
const renderer = new THREE.WebGLRenderer({ antialias: quality > 0, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, [phone ? 0.8 : 0.75, 1, 1.5][quality]));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = quality > 0;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.25, 5000);
const track = new Track();
const audio = new AudioEngine();
const input = new Input();
const hud = new Hud(track);
let assets!: Assets;
let dirLight!: THREE.DirectionalLight;
let sunOffset = new THREE.Vector3();
let skids!: SkidMarks;
let smoke!: Smoke;

// ---------------- post-processing ----------------
// Speed FX: radial motion blur scaled by speed, nitro speed lines + chromatic fringe, vignette.
const SpeedShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0 }, uNitro: { value: 0 }, uTime: { value: 0 }, uVignette: { value: 0.38 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount; uniform float uNitro; uniform float uTime; uniform float uVignette; varying vec2 vUv;
    float h(float n){ return fract(sin(n)*43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r = length(d);
      float blur = (uAmount + uNitro*0.8) * smoothstep(0.12, 0.7, r);
      vec3 c = vec3(0.0);
      for (int i = 0; i < 10; i++) { float s = 1.0 - blur * float(i) * 0.011; c += texture2D(tDiffuse, 0.5 + d * s).rgb; }
      c /= 10.0;
      // chromatic fringe while boosting
      if (uNitro > 0.01) {
        float ca = uNitro * 0.006 * r;
        c.r = mix(c.r, texture2D(tDiffuse, vUv + d * ca).r, 0.6);
        c.b = mix(c.b, texture2D(tDiffuse, vUv - d * ca).b, 0.6);
        // radial speed lines
        float ang = atan(d.y, d.x);
        float seg = floor(ang * 60.0);
        float line = step(0.82, h(seg + floor(uTime * 18.0) * 7.0));
        float mask = smoothstep(0.28, 0.75, r) * line * uNitro;
        c += vec3(0.65, 0.85, 1.0) * mask * 0.55;
      }
      c *= 1.0 - uVignette * smoothstep(0.35, 0.85, r);
      gl_FragColor = vec4(c, 1.0);
    }`,
};
let composer: EffectComposer | null = null;
let speedPass: ShaderPass | null = null;
function setupPost() {
  if (quality === 0) return;
  const rt = new THREE.WebGLRenderTarget(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio(),
    { type: THREE.HalfFloatType, samples: quality > 1 ? 4 : 2 });
  composer = new EffectComposer(renderer, rt);
  if (wet && quality > 1 && track.roadMesh) {
    // screen-space reflections on the wet road surface only
    const ssr = new SSRPass({ renderer, scene, camera, width: window.innerWidth, height: window.innerHeight, selects: [track.roadMesh], groundReflector: null });
    ssr.thickness = 0.02; ssr.maxDistance = 60; ssr.opacity = 0.55; ssr.infiniteThick = false;
    composer.addPass(ssr);
  } else composer.addPass(new RenderPass(scene, camera));
  if (quality > 1 && params.get('gtao') !== '0') {
    const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12 });
    composer.addPass(gtao);
  }
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), quality > 1 ? 0.5 : 0.4, 0.45, 1.4));
  speedPass = new ShaderPass(SpeedShader);
  composer.addPass(speedPass);
  composer.addPass(new OutputPass());
}

// ---------------- racers ----------------
const COLORS = [0xff2d75, 0x1f8bff, 0xffc21a, 0x22d36a, 0xa24bff, 0xff7a1a, 0xe8e8e8, 0x16d9d0];
const NAMES = ['YOU', 'Vega', 'Kaito', 'Rossi', 'Nadia', 'Bruno', 'Ines', 'Okafor'];
interface Racer {
  name: string; phys: CarPhysics; mesh: THREE.Group; wheels: THREE.Object3D[]; brakeMat: THREE.MeshStandardMaterial; flames: THREE.Mesh[];
  isPlayer: boolean; idx: number; crossings: number; half: boolean; lapStart: number; lastLap: number; bestLap: number;
  finished: boolean; finishTime: number; skill: number; lineBias: number; input: CarInput; wheelRot: number; place: number;
}
let racers: Racer[] = [];
let player!: Racer;

function makeRacer(i: number, isPlayer: boolean, skill: number): Racer {
  const detailed = quality > 0 && isPlayer;
  const { group, wheels, brakeMat, flames } = buildCar(assets, COLORS[i % COLORS.length], quality, detailed);
  scene.add(group);
  const phys = new CarPhysics();
  phys.power = isPlayer ? 1 : skill;
  phys.stability = isPlayer ? 0.6 : 1;
  return { name: NAMES[i], phys, mesh: group, wheels, brakeMat, flames, isPlayer, idx: 0, crossings: 0, half: false, lapStart: 0, lastLap: 0,
    bestLap: Infinity, finished: false, finishTime: 0, skill, lineBias: (Math.random() - 0.5) * 2, input: { throttle: 0, brake: 0, steer: 0, handbrake: false }, wheelRot: 0, place: 1 };
}

// ---------------- game state ----------------
type State = 'menu' | 'intro' | 'countdown' | 'race' | 'paused' | 'results';
let state: State = 'menu';
let raceTime = 0, countdown = 0, totalLaps = 3, lastBeep = -1;
let camMode = 0; const CAM_NAMES = ['CHASE', 'BUMPER', 'TV', 'ORBIT'];
let autopilot = params.has('autopilot');
let forceNitro = false;
let shake = 0;
let introT = 0; const INTRO_LEN = 5.5;
let bestLap = Number(localStorage.getItem(LS_BEST) ?? Infinity) || Infinity;
$('menu-best').textContent = isFinite(bestLap) ? fmt(bestLap) : '--';
$('btn-mute').textContent = audio.muted ? 'SOUND: OFF' : 'SOUND: ON';

function setupRace() {
  for (const r of racers) scene.remove(r.mesh);
  totalLaps = Number(($('opt-laps') as HTMLSelectElement).value);
  const nAI = Number(($('opt-ai') as HTMLSelectElement).value);
  const diff = Number(($('opt-diff') as HTMLSelectElement).value);
  racers = [];
  const grid = nAI + 1;
  // player starts at the back of the grid, AI ahead
  for (let g = 0; g < grid; g++) {
    const isPlayer = g === grid - 1;
    const id = isPlayer ? 0 : g + 1;
    const r = makeRacer(id, isPlayer, diff * (0.95 + Math.random() * 0.06));
    const back = 10 + g * 9;
    const si = (track.N - Math.round(back / (track.length / track.N))) % track.N;
    const s = track.samples[si];
    const lat = (g % 2 ? 1 : -1) * 3.5;
    r.phys.pos.set(s.p.x + s.n.x * lat, 0, s.p.z + s.n.z * lat);
    r.phys.heading = Math.atan2(s.t.x, -s.t.z);
    r.idx = si;
    racers.push(r);
    if (isPlayer) player = r;
  }
  raceTime = 0; countdown = 4.0; lastBeep = -1;
  state = 'intro'; introT = 0;
  hud.show(false); document.body.classList.add('cinematic');
  syncMeshes(0);
}

function startRace() {
  audio.init();
  $('menu').classList.add('hidden'); $('results').classList.add('hidden'); $('pause').classList.add('hidden');
  setupRace();
}

// ---------------- AI ----------------
const tmpV = new THREE.Vector3(), tmpF = new THREE.Vector3();
function aiControl(r: Racer): CarInput {
  const p = r.phys, N = track.N, ds = track.length / N;
  const speed = Math.max(p.vf, 0);
  const look = Math.round((7 + speed * 0.55) / ds);
  const s = track.samples[(r.idx + look) % N];
  // avoidance: shift lane if a car is close ahead
  let avoid = 0;
  for (const o of racers) {
    if (o === r) continue;
    const dx = o.phys.pos.x - p.pos.x, dz = o.phys.pos.z - p.pos.z;
    const f = p.forward(tmpF); const ahead = dx * f.x + dz * f.z;
    if (ahead > 0 && ahead < 16) {
      const side = dx * Math.cos(p.heading) + dz * Math.sin(p.heading);
      if (Math.abs(side) < 3) avoid += (side > 0 ? -1 : 1) * (1 - ahead / 16) * 4;
    }
  }
  const off = THREE.MathUtils.clamp(s.racingOffset * 0.9 + r.lineBias * 1.2 + avoid, -ROAD_WIDTH / 2 + 1.8, ROAD_WIDTH / 2 - 1.8);
  tmpV.set(s.p.x + s.n.x * off - p.pos.x, 0, s.p.z + s.n.z * off - p.pos.z).normalize();
  const f = p.forward(tmpF);
  const cross = f.x * tmpV.z - f.z * tmpV.x, dot = f.dot(tmpV);
  const ang = Math.atan2(cross, dot);
  let target = Infinity;
  for (let k = 0; k < 60; k += 4) target = Math.min(target, track.samples[(r.idx + k) % N].targetSpeed);
  target *= r.skill;
  // gentle rubber-banding relative to the player
  if (!r.isPlayer && state === 'race') {
    const gap = progress(r) - progress(player);
    target *= THREE.MathUtils.clamp(1 - gap / N * 0.25, 0.92, 1.06);
  }
  const err = target - speed;
  return {
    steer: THREE.MathUtils.clamp(ang * 2.4 - p.yawRate * 0.08, -1, 1),
    throttle: THREE.MathUtils.clamp(err * 0.35 + 0.3, 0, 1),
    brake: err < -2 ? THREE.MathUtils.clamp(-err * 0.15, 0, 1) : 0,
    handbrake: false,
    // AI fires nitro on straights when the road ahead allows much more speed
    nitro: state === 'race' && p.nitro > 0.25 && target > speed + 12 && Math.abs(ang) < 0.06 && (r.lineBias > -0.3 || p.boosting),
  };
}

function progress(r: Racer) {
  const N = track.N;
  return r.crossings * N + r.idx - (r.idx > N / 2 && !r.half ? N : 0);
}

// ---------------- simulation ----------------
const STEP = 1 / 120;
let acc = 0;

function simulate(dt: number) {
  const N = track.N;
  for (const r of racers) {
    const racing = state === 'race' && !r.finished;
    if (state === 'countdown' || state === 'intro') r.input = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    else if (r.finished || (r.isPlayer && !autopilot)) {
      if (r.isPlayer && !r.finished) r.input = input.controls();
      else { const ai = aiControl(r); r.input = { ...ai, throttle: ai.throttle * 0.5 }; }
    } else { r.input = aiControl(r); if (r.isPlayer) r.input.nitro = forceNitro; }
    void racing;
    r.phys.step(r.input, dt);

    // track-relative bookkeeping
    const prevIdx = r.idx;
    r.idx = track.nearest(r.phys.pos, r.idx);
    const lat = track.lateral(r.phys.pos, r.idx);
    r.phys.offroad = Math.abs(lat) > ROAD_WIDTH / 2 + CURB_WIDTH + 0.3;
    if (r.idx > N * 0.4 && r.idx < N * 0.6) r.half = true;
    if (state === 'race' && prevIdx > N * 0.8 && r.idx < N * 0.2 && (r.half || r.crossings === 0)) onCross(r);

    // barrier collision
    const lim = WALL_OFFSET - 1.15;
    if (Math.abs(lat) > lim) {
      const s = track.samples[r.idx], sgn = Math.sign(lat);
      const pen = Math.abs(lat) - lim;
      r.phys.pos.addScaledVector(s.n, -sgn * pen);
      const v = r.phys.velocity(tmpV);
      const vn = v.x * s.n.x * sgn + v.z * s.n.z * sgn;
      if (vn > 0) {
        v.addScaledVector(s.n, -sgn * vn * 1.35);
        v.multiplyScalar(0.92);
        r.phys.setVelocity(v);
        r.phys.yawRate *= 0.6;
        if (r.isPlayer) { audio.impact(vn / 15); shake = Math.min(1, shake + vn / 20); }
      }
    }
  }
  // car-vs-car (two circles per car)
  for (let i = 0; i < racers.length; i++) for (let j = i + 1; j < racers.length; j++) collideCars(racers[i], racers[j]);
}

const cA = new THREE.Vector3(), cB = new THREE.Vector3(), nrm = new THREE.Vector3();
function collideCars(a: Racer, b: Racer) {
  const dx = a.phys.pos.x - b.phys.pos.x, dz = a.phys.pos.z - b.phys.pos.z;
  if (dx * dx + dz * dz > 36) return;
  const R = 1.08;
  for (const oa of [-1.25, 1.25]) for (const ob of [-1.25, 1.25]) {
    cA.copy(a.phys.pos).addScaledVector(a.phys.forward(tmpF), oa);
    cB.copy(b.phys.pos).addScaledVector(b.phys.forward(tmpF), ob);
    nrm.subVectors(cA, cB).setY(0);
    const d = nrm.length();
    if (d < 2 * R && d > 1e-4) {
      nrm.divideScalar(d);
      const pen = 2 * R - d;
      a.phys.pos.addScaledVector(nrm, pen / 2); b.phys.pos.addScaledVector(nrm, -pen / 2);
      const va = a.phys.velocity(new THREE.Vector3()), vb = b.phys.velocity(new THREE.Vector3());
      const rel = va.clone().sub(vb).dot(nrm);
      if (rel < 0) {
        const j = -(1 + 0.3) * rel / 2;
        va.addScaledVector(nrm, j); vb.addScaledVector(nrm, -j);
        a.phys.setVelocity(va); b.phys.setVelocity(vb);
        // off-center hits induce yaw
        a.phys.yawRate += oa * j * 0.02; b.phys.yawRate -= ob * j * 0.02;
        if (a.isPlayer || b.isPlayer) { audio.impact(-rel / 12); shake = Math.min(1, shake - rel / 25); }
      }
    }
  }
}

function onCross(r: Racer) {
  r.half = false;
  r.crossings++;
  if (r.crossings === 1) { r.lapStart = raceTime; return; }
  const lap = raceTime - r.lapStart; r.lapStart = raceTime;
  r.lastLap = lap; r.bestLap = Math.min(r.bestLap, lap);
  if (r.isPlayer) {
    if (lap < bestLap) { bestLap = lap; localStorage.setItem(LS_BEST, String(lap)); hud.flash('NEW BEST LAP!', 1.8); }
    else if (r.crossings - 1 < totalLaps) hud.flash(r.crossings - 1 === totalLaps - 1 ? 'FINAL LAP' : `LAP ${r.crossings}`, 1.4);
  }
  if (r.crossings - 1 >= totalLaps) {
    r.finished = true; r.finishTime = raceTime;
    if (r.isPlayer) setTimeout(showResults, 2500), hud.flash('FINISH!', 2.4);
  }
}

function showResults() {
  if (state !== 'race') return;
  state = 'results';
  const sorted = [...racers].sort((a, b) => (a.finished && b.finished) ? a.finishTime - b.finishTime : progress(b) - progress(a));
  const rows = sorted.map((r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.finished ? fmt(r.finishTime) : '<i>running</i>'}</td><td>${isFinite(r.bestLap) ? fmt(r.bestLap) : '--'}</td></tr>`);
  $('res-table').innerHTML = `<tr><th>POS</th><th>DRIVER</th><th>TIME</th><th>BEST LAP</th></tr>${rows.join('')}`;
  const place = sorted.indexOf(player) + 1;
  $('res-title').textContent = place === 1 ? 'VICTORY!' : `FINISHED P${place}`;
  $('res-note').textContent = player.bestLap <= bestLap + 1e-6 && isFinite(player.bestLap) ? `Personal best lap: ${fmt(bestLap)}` : `Personal best: ${isFinite(bestLap) ? fmt(bestLap) : '--'}`;
  $('results').classList.remove('hidden');
  $('menu-best').textContent = isFinite(bestLap) ? fmt(bestLap) : '--';
}

// ---------------- visuals sync ----------------
const wp = new THREE.Vector3();
function syncMeshes(dt: number) {
  for (const r of racers) {
    const p = r.phys;
    r.mesh.position.set(p.pos.x, 0, p.pos.z);
    r.mesh.rotation.order = 'YXZ';
    r.mesh.rotation.y = -p.heading;
    // body roll/pitch from lateral accel and input (visual only)
    const latAcc = p.vf * p.yawRate;
    r.mesh.rotation.z = THREE.MathUtils.lerp(r.mesh.rotation.z, THREE.MathUtils.clamp(latAcc * 0.006, -0.06, 0.06), 0.15);
    r.mesh.rotation.x = THREE.MathUtils.lerp(r.mesh.rotation.x, (r.input.brake - r.input.throttle) * 0.015, 0.1);
    r.wheelRot += p.vf * dt / 0.36;
    r.wheels.forEach((w, i) => {
      if (i < 2) w.rotation.y = -p.steerAngle;
      w.rotation.x = -r.wheelRot;
    });
    r.brakeMat.emissiveIntensity = r.input.brake > 0.1 ? 7 : 1.4;
    for (const f of r.flames) { f.visible = p.boosting; if (p.boosting) f.scale.set(1, 1, 0.8 + Math.random() * 0.6); }

    // tire smoke + skid marks for rear wheels
    const sliding = (p.slipRear > 0.14 || (r.input.handbrake && p.speed > 6) || (p.wheelspin > 0.85 && p.speed < 18 && r.input.throttle > 0.5)) && p.speed > 3 && !p.offroad;
    for (let w = 2; w < 4; w++) {
      r.wheels[w].getWorldPosition(wp);
      skids.add(r.name + w, wp, sliding);
      if (sliding && Math.random() < (quality + 1) * 0.25) smoke.emit(wp.setY(0.3), p.velocity(tmpV));
    }
  }
}

// ---------------- cameras ----------------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let tvIdx = -1; const tvPos = new THREE.Vector3();
let orbitT = 0;
function updateCamera(dt: number) {
  const p = player.phys;
  const f = p.forward(new THREE.Vector3());
  const speed = p.speed;
  const target = new THREE.Vector3(p.pos.x, 0, p.pos.z);
  let fov = 60;
  if (state === 'intro') { // cinematic flyby: low sweep along the grid, rising crane, then settle behind the player
    const t = Math.min(introT / INTRO_LEN, 1), e = t * t * (3 - 2 * t);
    const lead = racers[0].phys.pos;
    const a = new THREE.Vector3().copy(lead).addScaledVector(f, 25).add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(p.right(new THREE.Vector3()), 6);
    const b = new THREE.Vector3().copy(target).addScaledVector(p.right(new THREE.Vector3()), -14).setY(16);
    const c = new THREE.Vector3().copy(target).addScaledVector(f, -6.0).setY(1.9);
    const k1 = a.clone().lerp(b, e), k2 = b.clone().lerp(c, e);
    camPos.copy(k1.lerp(k2, e));
    camLook.copy(lead).lerp(target, Math.min(1, e * 1.4)).setY(1);
    fov = 45 + 15 * e;
  } else if (camMode === 0) { // chase: lagging spring camera aligned to velocity direction for drift feel
    const vel = p.velocity(new THREE.Vector3());
    const dir = speed > 4 ? f.clone().lerp(vel.normalize(), 0.35).normalize() : f;
    const want = target.clone().addScaledVector(dir, -6.0 - speed * 0.015).setY(1.9 + speed * 0.006);
    camPos.lerp(want, 1 - Math.exp(-dt * 7));
    camLook.lerp(target.clone().addScaledVector(f, 5).setY(0.9), 1 - Math.exp(-dt * 12));
    fov = 60 + Math.min(speed, 80) * 0.28;
  } else if (camMode === 1) { // bumper
    camPos.copy(target).addScaledVector(f, 2.45).setY(0.75);
    camLook.copy(target).addScaledVector(f, 20).setY(0.9);
    fov = 70 + Math.min(speed, 80) * 0.2;
  } else if (camMode === 2) { // TV trackside cams
    const step = Math.floor(track.N / 14);
    const want = (Math.floor(player.idx / step) * step + Math.floor(step * 0.7)) % track.N;
    if (want !== tvIdx) {
      tvIdx = want; const s = track.samples[tvIdx];
      tvPos.set(s.p.x + s.n.x * (WALL_OFFSET + 6), 6, s.p.z + s.n.z * (WALL_OFFSET + 6));
    }
    camPos.copy(tvPos); camLook.lerp(target.clone().setY(0.8), 1 - Math.exp(-dt * 10));
    fov = THREE.MathUtils.clamp(2400 / Math.max(10, camPos.distanceTo(target)), 12, 60);
  } else { // slow orbit (photo / replay style)
    orbitT += dt * 0.35;
    camPos.set(target.x + Math.cos(orbitT) * 9, 3, target.z + Math.sin(orbitT) * 9);
    camLook.copy(target).setY(0.8);
  }
  camera.position.copy(camPos);
  if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.4; shake *= Math.exp(-dt * 6); }
  // subtle high-speed vibration
  if (camMode < 2 && speed > 45) camera.position.y += (Math.random() - 0.5) * (speed - 45) * 0.0015;
  camera.lookAt(camLook);
  if (p.boosting && state !== 'intro') fov += 10;
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  if (speedPass) {
    const u = speedPass.uniforms;
    u.uAmount.value = camMode < 2 && state !== 'intro' ? THREE.MathUtils.clamp((speed - 30) / 45, 0, 1) * (quality > 1 ? 1.4 : 1) : 0;
    u.uNitro.value += ((p.boosting && camMode < 2 ? 1 : 0) - u.uNitro.value) * Math.min(1, dt * 6);
    u.uTime.value += dt;
  }
  // keep the shadow frustum around the player
  dirLight.position.copy(target).add(sunOffset); dirLight.target.position.copy(target);
}

// ---------------- main loop ----------------
const clock = new THREE.Timer();
let fpsAcc = 0, fpsFrames = 0, fps = 60;
function frame(ts?: number) {
  requestAnimationFrame(frame);
  clock.update(ts);
  const dt = Math.min(clock.getDelta(), 0.1);
  input.pollPad();
  handleGlobalKeys();

  flameUniforms.uTime.value += dt;
  if (state === 'intro') {
    introT += dt;
    acc += dt; while (acc >= STEP) { simulate(STEP); acc -= STEP; }
    if (introT >= INTRO_LEN || input.hit('Enter') || input.hit('Space') || skipIntro) endIntro();
  }
  if (state === 'countdown' || state === 'race') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n++ < 12) { simulate(STEP); acc -= STEP; if (state === 'race') raceTime += STEP; }
    if (state === 'countdown') {
      countdown -= dt;
      const sec = Math.ceil(countdown - 1);
      if (sec !== lastBeep && sec >= 0 && sec <= 2) { lastBeep = sec; audio.beep(440); }
      hud.lights(countdown);
      if (countdown <= 1) { state = 'race'; audio.beep(880, 0.5); hud.flash('GO!', 1); }
    }
  } else if (state === 'menu') {
    // attract mode: AI cars lap the circuit behind the menu
    acc += dt; let n = 0;
    while (acc >= STEP && n++ < 10) { simulate(STEP); acc -= STEP; }
  }
  if (state !== 'paused') { syncMeshes(dt); smoke.update(dt); }
  if (racers.length) {
    if (state === 'menu') { camMode = 3; }
    updateCamera(dt);
  }
  // positions
  const order = [...racers].sort((a, b) => (a.finished && b.finished) ? a.finishTime - b.finishTime : (a.finished ? -1 : b.finished ? 1 : progress(b) - progress(a)));
  order.forEach((r, i) => (r.place = i + 1));

  const active = state === 'race' || state === 'countdown' || state === 'intro';
  if (player) {
    const skid = player.phys.speed > 5 ? Math.max(0, player.phys.slipRear - 0.12) * 4 + (player.input.handbrake ? 0.5 : 0) : 0;
    audio.update(player.phys.rpm, player.input.throttle, skid, active || state === 'results', player.phys.boosting);
  }
  if (state !== 'intro' && (active || state === 'results')) hud.update(dt, player, racers, totalLaps, raceTime, bestLap, fps);

  if (composer) composer.render(); else renderer.render(scene, camera);
  fpsAcc += dt; fpsFrames++; if (fpsAcc > 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; }
  input.endFrame();
}

let skipIntro = false;
function endIntro() {
  skipIntro = false; state = 'countdown'; hud.show(true); document.body.classList.remove('cinematic');
  camPos.copy(player.phys.pos).addScaledVector(player.phys.forward(), -6.0).setY(1.9);
}
function handleGlobalKeys() {
  if (input.hit('KeyC') && (state === 'race' || state === 'countdown')) { camMode = (camMode + 1) % CAM_NAMES.length; $('h-cam').textContent = 'CAM: ' + CAM_NAMES[camMode]; }
  if (input.hit('KeyM')) toggleMute();
  if (input.hit('Escape') || input.hit('KeyP')) {
    if (state === 'race' || state === 'countdown') pause(true);
    else if (state === 'intro') endIntro();
    else if (state === 'paused') pause(false);
  }
}
let pausedFrom: State = 'race';
function pause(on: boolean) {
  if (on) { pausedFrom = state; state = 'paused'; $('pause').classList.remove('hidden'); audio.ctx?.suspend(); }
  else { state = pausedFrom; $('pause').classList.add('hidden'); audio.ctx?.resume(); acc = 0; }
}
function toggleMute() { audio.setMuted(!audio.muted); $('btn-mute').textContent = audio.muted ? 'SOUND: OFF' : 'SOUND: ON'; }
function toMenu() {
  state = 'menu'; hud.show(false);
  ['pause', 'results'].forEach(id => $(id).classList.add('hidden')); $('menu').classList.remove('hidden');
  audio.ctx?.resume();
  attract();
}
function attract() {
  setupRace(); state = 'menu'; hud.show(false);
  for (const r of racers) { r.isPlayer = false; r.skill = 0.9; }
  autopilotMenu = true;
}
let autopilotMenu = false; void autopilotMenu;

$('btn-start').onclick = () => {
  const q = ($('opt-quality') as HTMLSelectElement).value, w = ($('opt-wet') as HTMLSelectElement).value === '1';
  if (Number(q) !== quality || w !== wet) {
    // renderer-level settings (MSAA, shadow maps, passes, materials) need a fresh context
    localStorage.setItem(LS_QUALITY, q); localStorage.setItem(LS_WET, w ? '1' : '0');
    const u = new URL(location.href); u.searchParams.delete('quality'); u.searchParams.delete('wet'); u.searchParams.set('autostart', '1'); location.href = u.toString(); return;
  }
  camMode = 0; $('h-cam').textContent = 'CAM: CHASE';
  startRace();
};
$('btn-resume').onclick = () => pause(false);
$('btn-restart').onclick = () => { $('pause').classList.add('hidden'); audio.ctx?.resume(); camMode = 0; startRace(); };
$('btn-mute').onclick = toggleMute;
$('btn-quit').onclick = toMenu;
$('btn-again').onclick = () => { camMode = 0; startRace(); };
$('btn-menu').onclick = toMenu;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); composer?.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('pointerdown', () => { if (state === 'intro') skipIntro = true; });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'race') pause(true); });

// debug / automation hooks (used by the screenshot script)
(window as unknown as Record<string, unknown>).__game = {
  start: () => $('btn-start').click(),
  setAutopilot: (v: boolean) => { autopilot = v; },
  skipIntro: () => { skipIntro = true; },
  teleport: (i: number) => { const s = track.samples[i]; player.phys.pos.copy(s.p); player.phys.heading = Math.atan2(s.t.x, -s.t.z); player.idx = i; },
  setNitro: (v: boolean) => { forceNitro = v; },
  setCamera: (m: number) => { camMode = m; $('h-cam').textContent = 'CAM: ' + CAM_NAMES[m]; },
  get state() { return state; },
  get fps() { return fps; },
  get player() { return player && { speed: player.phys.speed, lap: player.crossings, place: player.place, idx: player.idx }; },
};

const startBtn = $('btn-start') as HTMLButtonElement;
startBtn.disabled = true;
loadAssets(renderer, quality, f => { startBtn.textContent = `LOADING ${Math.round(f * 100)}%`; }).then(a => {
  assets = a;
  track.build(scene, quality, assets, wet);
  const env = buildEnvironment(scene, renderer, track, quality, assets);
  dirLight = env.dirLight; sunOffset = env.sunDir.clone().multiplyScalar(300);
  skids = new SkidMarks(scene, [600, 1500, 3000][quality]);
  smoke = new Smoke(scene, [150, 400, 700][quality]);
  setupPost();
  startBtn.disabled = false; startBtn.textContent = 'START RACE';
  attract();
  if (params.has('autostart')) startBtn.click();
  frame();
}).catch(err => { console.error(err); startBtn.textContent = 'FAILED TO LOAD ASSETS'; });
