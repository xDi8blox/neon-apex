import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { SSRPass } from 'three/examples/jsm/postprocessing/SSRPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { loadAssets, Assets } from './assets';
import { buildCar, flameUniforms, setGlow, engineColor, horn } from './carmodel';
import { Track, ROAD_WIDTH, CURB_WIDTH, WALL_OFFSET, textTexture } from './track';
import { CarPhysics, CarInput } from './car';
import { buildEnvironment, hellUniforms, Environment } from './scenery';
import { SkidMarks, Smoke, Shockwaves, Confetti, sigilTexture } from './effects';
import { AudioEngine } from './audio';
import { Music } from './music';
import { Input } from './input';
import { Hud, fmt, drawTrackThumb } from './hud';
import { TRACKS, TrackDef, trackById } from './tracks';
import { CARS, CarDef, carById, applyCar } from './cars';
import { settings, saveSettings, bestKey, ghostKey, getBest } from './settings';
import { Showroom } from './showroom';
import { isPhone } from './touch';
import { startEmbers } from './embers';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const LS_QUALITY = 'neonapex.quality';
const params = new URLSearchParams(location.search);

// ---------------- device / quality ----------------
const phone = isPhone() || /iPhone|Android.+Mobile/i.test(navigator.userAgent);
if (phone) document.body.classList.add('phone');
let quality = Number(params.get('quality') ?? localStorage.getItem(LS_QUALITY) ?? (phone ? 0 : 1));
if (!(quality >= 0 && quality <= 2)) quality = 1;
if (params.has('track')) settings.track = trackById(params.get('track')!).id;
if (params.has('car')) settings.car = carById(params.get('car')!).id;
if (phone && !localStorage.getItem('neonapex.settings')) settings.opponents = 3;

// ---------------- renderer / scene ----------------
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
const audio = new AudioEngine();
const music = new Music();
audio.setVolumes(settings.sfx, settings.music);
audio.onInit = () => { music.attach(audio.ctx!, audio.musicBus); music.start(); audio.setRain(trackDef?.rain ? 1 : 0); };
const input = new Input();
const hud = new Hud();
hud.units = settings.units; hud.showFps = settings.showFps;
document.body.classList.toggle('swapped', settings.layout === 'swapped');
let assets!: Assets;
let track!: Track;
let trackDef!: TrackDef;
let world: THREE.Group | null = null;
let dirLight!: THREE.DirectionalLight;
let sunOffset = new THREE.Vector3();
let skids!: SkidMarks, smoke!: Smoke, sparks!: Smoke, fire!: Smoke, shock!: Shockwaves, confetti!: Confetti;
let worldEnv: Environment | null = null;
let showroom: Showroom | null = null;

// ---------------- post-processing ----------------
// Speed FX: radial motion blur scaled by speed, nitro speed lines + chromatic fringe, shockwave ripple, vignette.
const SpeedShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0 }, uNitro: { value: 0 }, uTime: { value: 0 }, uVignette: { value: 0.38 }, uShock: { value: 0 }, uSlow: { value: 0 }, uHeat: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount; uniform float uNitro; uniform float uTime; uniform float uVignette; uniform float uShock; uniform float uSlow; uniform float uHeat; varying vec2 vUv;
    float h(float n){ return fract(sin(n)*43758.5453); }
    void main(){
      vec2 d = vUv - 0.5; float r = length(d);
      vec2 uv = vUv;
      if (uShock > 0.001) { float ring = (1.0 - uShock) * 0.9; float w = exp(-pow((r - ring) * 18.0, 2.0)); uv += normalize(d + 1e-5) * w * 0.035 * uShock; }
      // heat haze: shimmering refraction rising off the lava, strongest low on screen
      if (uHeat > 0.001) { float hz = uHeat * smoothstep(0.75, 0.15, vUv.y); uv += vec2(sin(vUv.y * 90.0 + uTime * 5.0) + sin(vUv.x * 37.0 - uTime * 3.3) * 0.5, cos(vUv.x * 70.0 + uTime * 4.0)) * 0.0011 * hz; }
      d = uv - 0.5;
      float blur = (uAmount + uNitro*0.8) * smoothstep(0.12, 0.7, r);
      vec3 c = vec3(0.0);
      for (int i = 0; i < 10; i++) { float s = 1.0 - blur * float(i) * 0.011; c += texture2D(tDiffuse, 0.5 + d * s).rgb; }
      c /= 10.0;
      if (uNitro > 0.01) {
        float ca = uNitro * 0.006 * r;
        c.r = mix(c.r, texture2D(tDiffuse, uv + d * ca).r, 0.6);
        c.b = mix(c.b, texture2D(tDiffuse, uv - d * ca).b, 0.6);
        float ang = atan(d.y, d.x);
        float seg = floor(ang * 60.0);
        float line = step(0.82, h(seg + floor(uTime * 18.0) * 7.0));
        c += vec3(1.0, 0.42, 0.1) * smoothstep(0.28, 0.75, r) * line * uNitro * 0.65;
        c = mix(c, c * vec3(1.25, 0.85, 0.7), uNitro * 0.5); // Soul Burn: hellfire grade
      }
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(l) * vec3(1.2, 0.75, 0.6), uSlow * 0.55 * smoothstep(0.1, 0.6, r));
      c *= 1.0 - (uVignette + uSlow * 0.3) * smoothstep(0.35, 0.85, r);
      gl_FragColor = vec4(c, 1.0);
    }`,
};
let composer: EffectComposer | null = null;
let speedPass: ShaderPass | null = null;
function setupPost() {
  if (composer) { for (const p of composer.passes) p.dispose?.(); composer.dispose(); composer = null; speedPass = null; }
  if (quality === 0) return;
  // the lens flare copies the framebuffer, which is invalid on MSAA targets: use FXAA instead on flare tracks
  const flare = !trackDef.night && !trackDef.rain;
  const rt = new THREE.WebGLRenderTarget(window.innerWidth * renderer.getPixelRatio(), window.innerHeight * renderer.getPixelRatio(),
    { type: THREE.HalfFloatType, samples: flare ? 0 : quality > 1 ? 4 : 2 });
  composer = new EffectComposer(renderer, rt);
  if (trackDef.wet && quality > 1 && track.roadMesh) {
    const ssr = new SSRPass({ renderer, scene, camera, width: window.innerWidth, height: window.innerHeight, selects: [track.roadMesh], groundReflector: null });
    ssr.thickness = 0.02; ssr.maxDistance = 60; ssr.opacity = trackDef.night ? 0.7 : 0.55; ssr.infiniteThick = false;
    composer.addPass(ssr);
  } else composer.addPass(new RenderPass(scene, camera));
  if (quality > 1 && params.get('gtao') !== '0') {
    const gtao = new GTAOPass(scene, camera, window.innerWidth, window.innerHeight);
    gtao.blendIntensity = 0.85;
    gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1, samples: 12 });
    composer.addPass(gtao);
  }
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), trackDef.night ? 0.45 : quality > 1 ? 0.5 : 0.4, 0.45, trackDef.night ? 1.6 : 1.4));
  speedPass = new ShaderPass(SpeedShader);
  speedPass.uniforms.uHeat.value = trackDef.heat;
  composer.addPass(speedPass);
  composer.addPass(new OutputPass());
  if (flare) composer.addPass(new FXAAPass());
}

// ---------------- world (per track) ----------------
function disposeTree(o: THREE.Object3D) {
  const keep = new Set<THREE.Texture>();
  for (const set of [assets.asphalt]) for (const t of Object.values(set)) if (t instanceof THREE.Texture) keep.add(t);
  o.traverse(c => {
    const m = c as THREE.Mesh;
    m.geometry?.dispose();
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture && !keep.has(v)) v.dispose();
      mat.dispose();
    }
  });
}
let worldId = '';
let worldTask: Promise<void> = Promise.resolve();
function ensureWorld(id: string, onProgress?: (f: number) => void): Promise<void> {
  worldTask = worldTask.then(async () => {
    if (worldId === id) return;
    const def = trackById(id);
    onProgress?.(1);
    if (world) { scene.remove(world); disposeTree(world); }
    for (const r of racers) scene.remove(r.mesh);
    racers = []; ghost = null;
    world = new THREE.Group(); world.name = 'world'; scene.add(world);
    trackDef = def;
    track = new Track(def.control, def.scale, def.grip);
    track.build(world, quality, assets, def.wet, def.night);
    const env = buildEnvironment(scene, world, renderer, track, quality, assets, def); worldEnv = env;
    dirLight = env.dirLight; sunOffset = env.sunDir.clone().multiplyScalar(300);
    renderer.toneMappingExposure = def.exposure;
    skids = new SkidMarks(world, [600, 1500, 3000][quality]);
    smoke = new Smoke(world, [150, 400, 700][quality], [0.22, 0.17, 0.15]); // ash-dark tire smoke
    fire = new Smoke(world, [160, 320, 520][quality], [1, 0.32, 0.05], true); // hellfire: Soul Burn trails, banishments
    Object.assign(fire, { fade: 1.5, grow: 1.2, gravity: -5, drag: 1.2, baseSize: 0.9 });
    sparks = new Smoke(world, [120, 250, 400][quality], [1, 0.55, 0.15], true);
    Object.assign(sparks, { fade: 2.2, grow: -0.5, gravity: 14, drag: 0.6, baseSize: 0.45 });
    shock = new Shockwaves(world);
    confetti = new Confetti(world, [250, 450, 700][quality]);
    podium = null;
    hud.setTrack(track);
    setupPost();
    audio.setRain(def.rain ? 1 : 0);
    $('lb-title').textContent = `HELLDRIVE · ${def.name.toUpperCase()}`;
    document.documentElement.style.setProperty('--accent', def.accent);
    worldId = id;
  });
  return worldTask;
}

// ---------------- racers ----------------
const COLORS = [0xc3101a, 0x1b1b22, 0xb9a68a, 0x5a0f4a, 0xff4a10, 0x3a0a0a, 0xffb02e, 0x2e3a12];
const NAMES = ['YOU', 'Vega', 'Malphas', 'Lilith', 'Azazel', 'Mordre', 'Belial', 'Morrigan'];
const PAINTS = [0x8a0d0d, 0xc3101a, 0xff4a10, 0xffb02e, 0x1b1b22, 0xb9a68a, 0x5a0f4a, 0x3a0a0a, 0x2e3a12, 0xe9dcc4];
interface Racer {
  name: string; car: CarDef; phys: CarPhysics; mesh: THREE.Group; wheels: THREE.Object3D[]; brakeMat: THREE.MeshStandardMaterial; flames: THREE.Mesh[]; glow: THREE.MeshBasicMaterial; boostGlow: number;
  isPlayer: boolean; idx: number; crossings: number; half: boolean; lapStart: number; lastLap: number; bestLap: number;
  finished: boolean; finishTime: number; skill: number; lineBias: number; input: CarInput; wheelRot: number; place: number;
  hitT: number; wreckT: number; nearMin: number; nearRel: number; nearContact: boolean; nearCool: number;
}
let racers: Racer[] = [];
let player!: Racer;
let camTarget!: Racer;

function makeRacer(i: number, isPlayer: boolean, skill: number, def: CarDef, color: number): Racer {
  const detailed = quality > 0 && isPlayer;
  const { group, wheels, brakeMat, flames, glow } = buildCar(assets, color, quality, detailed, def.kit, def.phys.rideHeight ?? 0);
  scene.add(group);
  const phys = new CarPhysics();
  applyCar(phys, def, isPlayer);
  phys.power = isPlayer ? 1 : skill;
  phys.surfaceGrip = trackDef.grip;
  return { name: NAMES[i % NAMES.length], car: def, phys, mesh: group, wheels, brakeMat, flames, glow, boostGlow: 0, isPlayer, idx: 0, crossings: 0, half: false, lapStart: 0, lastLap: 0,
    bestLap: Infinity, finished: false, finishTime: 0, skill, lineBias: (Math.random() - 0.5) * 2, input: { throttle: 0, brake: 0, steer: 0, handbrake: false },
    wheelRot: 0, place: 1, hitT: 0, wreckT: 0, nearMin: 99, nearRel: 0, nearContact: false, nearCool: 0 };
}
const playerColor = () => settings.colors[settings.car] ?? carById(settings.car).color;

// ---------------- game state ----------------
type State = 'menu' | 'intro' | 'countdown' | 'race' | 'paused' | 'finishing' | 'replay' | 'podium' | 'garage';
type Mode = 'quick' | 'champ' | 'tt';
let state: State = 'menu';
let mode: Mode = 'quick';
let raceTime = 0, countdown = 0, totalLaps = 3, lastBeep = -1;
let camMode = 0; const CAM_NAMES = ['CHASE', 'BUMPER', 'TV', 'ORBIT'];
let autopilot = params.has('autopilot');
let forceNitro = false;
let shake = 0;
let introT = 0; const INTRO_LEN = 5.5;
let bestLap = Infinity;
const champ = { round: 0, points: new Map<string, number>(), cars: new Map<string, string>(), active: false };
function champInit() {
  champ.round = 0; champ.points.clear(); champ.active = true; champ.cars.clear();
  NAMES.slice(1).forEach((n, i) => champ.cars.set(n, CARS[(i + 1) % CARS.length].id));
}

function setupRace(attractMode = false) {
  for (const r of racers) scene.remove(r.mesh);
  if (ghost) { scene.remove(ghost.mesh); ghost = null; }
  if (podium) { world!.remove(podium); podium = null; }
  const tt = mode === 'tt' && !attractMode;
  totalLaps = settings.laps;
  const nAI = attractMode ? Math.min(5, settings.opponents) : tt ? 0 : mode === 'champ' ? 5 : settings.opponents;
  const diff = settings.difficulty;
  racers = [];
  const grid = nAI + 1;
  for (let g = 0; g < grid; g++) {
    const isPlayer = g === grid - 1;
    const id = isPlayer ? 0 : g + 1;
    const def = isPlayer ? carById(settings.car) : carById(champ.cars.get(NAMES[id]) ?? CARS[id % CARS.length].id);
    const r = makeRacer(id, isPlayer, diff * (0.95 + Math.random() * 0.06), def, isPlayer ? playerColor() : COLORS[id % COLORS.length]);
    const back = 10 + g * 9;
    const si = (track.N - Math.round(back / (track.length / track.N))) % track.N;
    const s = track.samples[si];
    const lat = grid === 1 ? 0 : (g % 2 ? 1 : -1) * 3.5;
    r.phys.pos.set(s.p.x + s.n.x * lat, 0, s.p.z + s.n.z * lat);
    r.phys.heading = Math.atan2(s.t.x, -s.t.z);
    r.idx = si;
    racers.push(r);
    if (isPlayer) player = r;
  }
  camTarget = player;
  bestLap = getBest(trackDef.id, settings.car);
  raceTime = 0; countdown = 4.0; lastBeep = -1; acc = 0;
  resetFun();
  replay.reset(racers.length);
  lapTimes = [];
  if (tt) loadGhost(); else ghostRec = null;
  if (attractMode) return;
  state = 'intro'; introT = 0;
  hud.show(false); document.body.classList.add('cinematic');
  hud.delta(null); hud.ghost = null;
  document.body.classList.toggle('tt', tt);
  syncMeshes(0);
}

async function startRace() {
  audio.init();
  hideScreens();
  hideResults(); $('pause').classList.add('hidden');
  wipe();
  await sleep(450);
  await ensureWorld(mode === 'champ' ? TRACKS[champ.round].id : settings.track);
  camMode = settings.camera; $('h-cam').textContent = 'CAM: ' + CAM_NAMES[camMode];
  music.intensity = 1;
  setupRace();
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function wipe() { for (const id of ['wipe', 'crack']) { const w = $(id); w.classList.remove('go'); void w.offsetWidth; w.classList.add('go'); } audio.swish(); }

// ---------------- AI ----------------
const tmpV = new THREE.Vector3(), tmpF = new THREE.Vector3();
function aiControl(r: Racer): CarInput {
  const p = r.phys, N = track.N, ds = track.length / N;
  const speed = Math.max(p.vf, 0);
  const look = Math.round((7 + speed * 0.55) / ds);
  const s = track.samples[(r.idx + look) % N];
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
  const ang = Math.atan2(f.x * tmpV.z - f.z * tmpV.x, f.dot(tmpV));
  let target = Infinity;
  for (let k = 0; k < 60; k += 4) target = Math.min(target, track.samples[(r.idx + k) % N].targetSpeed);
  target *= r.skill;
  if (!r.isPlayer && state === 'race' && player) {
    const gap = progress(r) - progress(player);
    target *= THREE.MathUtils.clamp(1 - gap / N * 0.25, 0.92, 1.06);
  }
  const err = target - speed;
  if (r.wreckT > 0) return { steer: 0, throttle: 0, brake: 0.6, handbrake: true };
  return {
    steer: THREE.MathUtils.clamp(ang * 2.4 - p.yawRate * 0.08, -1, 1),
    throttle: THREE.MathUtils.clamp(err * 0.35 + 0.3, 0, 1),
    brake: err < -2 ? THREE.MathUtils.clamp(-err * 0.15, 0, 1) : 0,
    handbrake: false,
    nitro: state === 'race' && p.nitro > 0.25 && target > speed + 12 && Math.abs(ang) < 0.06 && (r.lineBias > -0.3 || p.boosting),
  };
}
function progress(r: Racer) {
  const N = track.N;
  return r.crossings * N + r.idx - (r.idx > N / 2 && !r.half ? N : 0);
}

// ---------------- fun systems: score, drift, near miss, takedowns, shockwave, perfect start ----------------
let score = 0, driftPts = 0, driftT = 0, driftGrace = 0, driftMult = 1;
let slowT = 0, timeScale = 1;
let takedowns = 0, nearMisses = 0, bestDrift = 0, perfectStart = false;
let gasHeldSince = -1, startWindow = 0, perfectT = 0, bogT = 0, shockCool = 0, wasBoosting = false, bumpCool = 0;
function resetFun() {
  score = 0; driftPts = 0; driftT = 0; driftGrace = 0; driftMult = 1; slowT = 0; timeScale = 1;
  takedowns = 0; nearMisses = 0; bestDrift = 0; perfectStart = false; gasHeldSince = -1; startWindow = 0; perfectT = 0; bogT = 0; shockCool = 0; wasBoosting = false;
  hud.combo(null); hud.score(0);
}
function addScore(v: number, text: string, cls = '') { score += v; hud.score(score); if (text) hud.popup(`${text}${v ? ' +' + v.toLocaleString('en-US') : ''}`, cls); }
function slowmo(t: number) { slowT = Math.max(slowT, t); }
const sparkP = new THREE.Vector3();
function emitSparks(p: THREE.Vector3, v: THREE.Vector3, n: number) {
  for (let i = 0; i < n; i++) sparks.emit(sparkP.copy(p).setY(0.5 + Math.random() * 0.4), v, 9, 2.5);
}
function takedown(r: Racer) {
  if (r.wreckT > 0) return;
  r.wreckT = 2.2; r.hitT = 0; takedowns++;
  r.phys.yawRate += (Math.random() < 0.5 ? -1 : 1) * 3.5; r.phys.vf *= 0.55;
  addScore(1000, 'BANISHED!', 'big red');
  slowmo(1.1); shake = 1; audio.boom(1);
  emitSparks(r.phys.pos, r.phys.velocity(new THREE.Vector3()), 40);
  emitFire(r.phys.pos, r.phys.velocity(new THREE.Vector3()), 50, 6);
  shock.spawn(r.phys.pos, 0xff2a08, true);
}
const fireP = new THREE.Vector3();
function emitFire(p: THREE.Vector3, v: THREE.Vector3, n: number, spread = 3) {
  for (let i = 0; i < n; i++) fire.emit(fireP.copy(p).setY(0.4 + Math.random() * 1.2), v, spread, 1.5);
}
function onDriftTick(dt: number) {
  const p = player.phys;
  const slip = Math.atan2(Math.abs(p.vl), Math.abs(p.vf));
  const drifting = state === 'race' && slip > 0.16 && p.speed > 12 && !p.offroad && !player.finished;
  if (drifting) {
    driftT += dt; driftGrace = 0.7;
    driftMult = Math.min(5, 1 + Math.floor(driftT / 1.4));
    driftPts += dt * p.speed * 8 * driftMult * (0.6 + slip * 2);
    hud.combo(`EMBERS ×${driftMult}  ${Math.round(driftPts).toLocaleString('en-US')}`);
  } else if (driftPts > 0) {
    driftGrace -= dt;
    if (driftGrace <= 0) bankDrift();
  }
}
function bankDrift() {
  const v = Math.round(driftPts); driftPts = 0; driftT = 0; driftMult = 1; hud.combo(null);
  if (v < 60) return;
  bestDrift = Math.max(bestDrift, v);
  addScore(v, v > 2500 ? 'INFERNAL DRIFT' : v > 1000 ? 'SCORCHING DRIFT' : 'EMBER DRIFT', v > 1000 ? 'gold' : '');
  if (v > 1000) audio.chime(880, 3);
}
function loseCombo() { if (driftPts > 200) hud.popup('COMBO SNUFFED', 'red'); driftPts = 0; driftT = 0; driftMult = 1; hud.combo(null); }
function nearMissTick(dt: number) {
  const p = player.phys;
  for (const r of racers) {
    if (r === player) continue;
    r.nearCool -= dt; r.hitT -= dt; r.wreckT -= dt;
    const d = r.phys.pos.distanceTo(p.pos);
    if (d < 5.5) {
      if (d < r.nearMin) { r.nearMin = d; r.nearRel = r.phys.velocity(tmpV).sub(p.velocity(tmpF)).length(); }
    } else if (r.nearMin < 99) {
      if (r.nearMin < 3.6 && !r.nearContact && r.nearRel > 4 && p.speed > 22 && r.nearCool <= 0 && state === 'race') {
        nearMisses++; r.nearCool = 4; addScore(300, 'NEAR MISS'); slowmo(0.55); audio.swish();
      }
      r.nearMin = 99; r.nearContact = false;
    }
  }
}
function fireShockwave() {
  shock.spawn(player.phys.pos, 0xff4a10); shock.spawn(player.phys.pos, 0xff1a08, true);
  emitFire(player.phys.pos, player.phys.velocity(new THREE.Vector3()), 60, 10);
  if (speedPass) speedPass.uniforms.uShock.value = 1;
  audio.boom(0.6); shake = Math.min(1, shake + 0.5);
  let hit = 0;
  for (const r of racers) {
    if (r === player) continue;
    const dv = new THREE.Vector3().subVectors(r.phys.pos, player.phys.pos).setY(0); const d = dv.length();
    if (d > 16 || d < 0.1) continue;
    const v = r.phys.velocity(new THREE.Vector3()).addScaledVector(dv.normalize(), 9 * (1 - d / 16));
    r.phys.setVelocity(v); r.phys.yawRate += (Math.random() - 0.5) * 2; r.hitT = 1.5; hit++;
  }
  hud.popup(hit ? `HELLBLAST ×${hit}` : 'HELLBLAST', 'gold');
  if (hit) addScore(150 * hit, '');
}

// ---------------- simulation ----------------
const STEP = 1 / 120;
let acc = 0;
function simulate(dt: number) {
  const N = track.N;
  for (const r of racers) {
    if (state === 'countdown' || state === 'intro') r.input = { throttle: 0, brake: 0, steer: 0, handbrake: true };
    else if (r.finished || (r.isPlayer && !autopilot)) {
      if (r.isPlayer && !r.finished) r.input = input.controls();
      else { const ai = aiControl(r); r.input = { ...ai, throttle: ai.throttle * 0.5 }; }
    } else { r.input = aiControl(r); if (r.isPlayer) r.input.nitro = forceNitro; }
    if (r.isPlayer && state === 'race') {
      if (perfectT > 0) r.input = { ...r.input, nitro: true, throttle: 1 };
      if (bogT > 0) r.input = { ...r.input, throttle: r.input.throttle * 0.25 };
    }
    r.phys.step(r.input, dt);

    const prevIdx = r.idx;
    r.idx = track.nearest(r.phys.pos, r.idx);
    const lat = track.lateral(r.phys.pos, r.idx);
    r.phys.offroad = Math.abs(lat) > ROAD_WIDTH / 2 + CURB_WIDTH + 0.3;
    if (r.idx > N * 0.4 && r.idx < N * 0.6) r.half = true;
    if ((state === 'race' || state === 'finishing') && prevIdx > N * 0.8 && r.idx < N * 0.2 && (r.half || r.crossings === 0)) onCross(r);

    // barrier collision
    const lim = WALL_OFFSET - 1.15;
    if (Math.abs(lat) > lim) {
      const s = track.samples[r.idx], sgn = Math.sign(lat);
      r.phys.pos.addScaledVector(s.n, -sgn * (Math.abs(lat) - lim));
      const v = r.phys.velocity(tmpV);
      const vn = v.x * s.n.x * sgn + v.z * s.n.z * sgn;
      if (vn > 0) {
        v.addScaledVector(s.n, -sgn * vn * 1.35);
        v.multiplyScalar(0.92);
        r.phys.setVelocity(v);
        r.phys.yawRate *= 0.6;
        if (vn > 3) emitSparks(r.phys.pos.clone().addScaledVector(s.n, sgn * 1.1), v, Math.min(20, Math.round(vn * 1.5)));
        if (r.isPlayer) { audio.impact(vn / 15); shake = Math.min(1, shake + vn / 20); if (vn > 4) loseCombo(); }
        else if (r.hitT > 0 && vn > 4 && state === 'race') takedown(r);
      }
    }
  }
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
        a.phys.yawRate += oa * j * 0.02; b.phys.yawRate -= ob * j * 0.02;
        if (a.isPlayer || b.isPlayer) {
          const other = a.isPlayer ? b : a;
          other.nearContact = true;
          audio.impact(-rel / 12); shake = Math.min(1, shake - rel / 25);
          if (-rel > 3) emitSparks(cA.clone().lerp(cB, 0.5), va, Math.min(24, Math.round(-rel * 2)));
          if (state === 'race') {
            if (-rel > 12) takedown(other);
            else if (-rel > 4) { other.hitT = 1.2; if (bumpCool <= 0) { bumpCool = 1; addScore(50, 'BUMP'); } }
          }
        }
      }
    }
  }
}

let lapTimes: number[] = [];
function onCross(r: Racer) {
  r.half = false;
  r.crossings++;
  if (r.crossings === 1) { r.lapStart = raceTime; if (r.isPlayer && ghostRec) ghostRec.length = 0; return; }
  const lap = raceTime - r.lapStart; r.lapStart = raceTime;
  r.lastLap = lap; r.bestLap = Math.min(r.bestLap, lap);
  if (r.finished) return;
  if (r.isPlayer) {
    lapTimes.push(lap);
    if (mode === 'tt') finishGhostLap(lap);
    if (ghostRec) ghostRec.length = 0;
    if (lap < bestLap) { bestLap = lap; localStorage.setItem(bestKey(trackDef.id, settings.car), String(lap)); hud.flash('NEW BEST LAP!', 1.8); audio.chime(990, 4); }
    else if (r.crossings - 1 < totalLaps) hud.flash(r.crossings - 1 === totalLaps - 1 ? 'FINAL LAP' : `LAP ${r.crossings}`, 1.4);
  }
  if (r.crossings - 1 >= totalLaps) {
    r.finished = true; r.finishTime = raceTime;
    if (r.isPlayer) { hud.flash('FINISH!', 2.4); bankDrift(); state = 'finishing'; finishT = 0; slowmo(1.2); }
  }
}

// ---------------- ghost (time trial) ----------------
interface GhostData { lap: number; x: number[]; z: number[]; h: number[] }
let ghost: { data: GhostData; mesh: THREE.Group; idxTime: Float32Array } | null = null;
let ghostRec: number[][] | null = null; // [x, z, heading] at GHOST_HZ since the lap started
let ghostAcc = 0;
const GHOST_HZ = 20;
function makeGhostMesh() {
  const def = carById(settings.car);
  const { group } = buildCar(assets, 0x7ff6ff, Math.min(quality, 1), false, def.kit, def.phys.rideHeight ?? 0);
  group.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.transparent = true; mat.opacity = 0.32; mat.depthWrite = false;
    if ('emissive' in mat) { mat.emissive = new THREE.Color(0x00a0c0); mat.emissiveIntensity = 0.6; }
    m.material = mat; m.castShadow = false;
  });
  scene.add(group); return group;
}
function setGhost(data: GhostData) {
  if (ghost) scene.remove(ghost.mesh);
  const idxTime = new Float32Array(track.N).fill(-1);
  let idx = 0; const p = new THREE.Vector3();
  for (let i = 0; i < data.x.length; i++) {
    idx = track.nearest(p.set(data.x[i], 0, data.z[i]), idx);
    if (idxTime[idx] < 0 && !(i < 20 && idx > track.N / 2)) idxTime[idx] = i / GHOST_HZ;
  }
  for (let i = 1; i < track.N; i++) if (idxTime[i] < 0) idxTime[i] = idxTime[i - 1];
  ghost = { data, mesh: makeGhostMesh(), idxTime };
  ghost.mesh.visible = false;
}
function loadGhost() {
  ghostRec = []; ghostAcc = 0;
  try {
    const raw = localStorage.getItem(ghostKey(trackDef.id, settings.car));
    if (raw) setGhost(JSON.parse(raw));
  } catch { /* corrupt ghost */ }
}
function recordGhost(dt: number) {
  if (!ghostRec || player.crossings < 1) return;
  ghostAcc += dt;
  while (ghostAcc >= 1 / GHOST_HZ) { ghostAcc -= 1 / GHOST_HZ; ghostRec.push([player.phys.pos.x, player.phys.pos.z, player.phys.heading]); }
}
function finishGhostLap(lap: number) {
  const rec = ghostRec; if (!rec || rec.length < 10) return;
  if (!ghost || lap < ghost.data.lap) {
    const data: GhostData = { lap, x: rec.map(r => +r[0].toFixed(2)), z: rec.map(r => +r[1].toFixed(2)), h: rec.map(r => +r[2].toFixed(3)) };
    try { localStorage.setItem(ghostKey(trackDef.id, settings.car), JSON.stringify(data)); } catch { /* storage full */ }
    setGhost(data);
    hud.popup('NEW WRAITH', 'gold');
  }
}
function updateGhost() {
  if (!ghost || mode !== 'tt') return;
  const lapT = player.crossings >= 1 ? raceTime - player.lapStart : -1;
  const d = ghost.data, n = d.x.length;
  if (lapT < 0 || player.finished) { ghost.mesh.visible = false; hud.ghost = null; return; }
  const f = Math.min(lapT * GHOST_HZ, n - 1.001), i = Math.floor(f), k = f - i;
  const x = d.x[i] + (d.x[i + 1] - d.x[i]) * k, z = d.z[i] + (d.z[i + 1] - d.z[i]) * k;
  let dh = d.h[i + 1] - d.h[i]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
  ghost.mesh.visible = true;
  ghost.mesh.position.set(x, 0, z); ghost.mesh.rotation.set(0, -(d.h[i] + dh * k), 0);
  hud.ghost = { x, z };
  const gt = ghost.idxTime[player.idx];
  hud.delta(gt >= 0 && lapT > 1 ? lapT - gt : null);
}

// ---------------- replay ----------------
const REPLAY_HZ = 30, REPLAY_LEN = 12 * REPLAY_HZ, F = 7;
const replay = {
  buf: new Float32Array(0), n: 0, head: 0, racers: 0, acc: 0, len: 0,
  reset(nr: number) { this.racers = nr; this.buf = new Float32Array(REPLAY_LEN * nr * F); this.n = 0; this.head = 0; this.acc = 0; },
  record(dt: number) {
    this.acc += dt;
    while (this.acc >= 1 / REPLAY_HZ) {
      this.acc -= 1 / REPLAY_HZ;
      const base = this.head * this.racers * F;
      racers.forEach((r, i) => this.buf.set([r.phys.pos.x, r.phys.pos.z, r.phys.heading, r.phys.steerAngle, r.phys.vf, r.phys.boosting ? 1 : 0, r.input.brake], base + i * F));
      this.head = (this.head + 1) % REPLAY_LEN; this.n = Math.min(REPLAY_LEN, this.n + 1);
    }
  },
  /** pose the racers at time t (seconds from the start of the stored window) */
  apply(t: number) {
    const f = Math.min(t * REPLAY_HZ, this.n - 1.001), i = Math.floor(f), k = f - i;
    const fr = (j: number) => ((this.head - this.n + j) % REPLAY_LEN + REPLAY_LEN) % REPLAY_LEN;
    const a = fr(i) * this.racers * F, b = fr(i + 1) * this.racers * F;
    racers.forEach((r, ri) => {
      const A = a + ri * F, B = b + ri * F, L = (q: number) => this.buf[A + q] + (this.buf[B + q] - this.buf[A + q]) * k;
      let dh = this.buf[B + 2] - this.buf[A + 2]; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      r.phys.pos.set(L(0), 0, L(1)); r.phys.heading = this.buf[A + 2] + dh * k; r.phys.steerAngle = L(3); r.phys.vf = L(4);
      r.phys.boosting = this.buf[A + 5] > 0.5; r.input = { ...r.input, brake: L(6), throttle: 0.5 };
      r.idx = track.nearest(r.phys.pos, r.idx);
    });
  },
};
let finishT = 0, replayT = 0;
let liveSnapshot: { pos: THREE.Vector3; heading: number; vf: number; idx: number }[] = [];
function startReplay() {
  if (replay.n < REPLAY_HZ * 2) { startPodium(); return; }
  liveSnapshot = racers.map(r => ({ pos: r.phys.pos.clone(), heading: r.phys.heading, vf: r.phys.vf, idx: r.idx }));
  state = 'replay'; replay.len = replay.n / REPLAY_HZ; replayT = Math.max(0, replay.len - 10);
  hud.show(false); hideResults(); document.body.classList.add('cinematic'); $('replay-badge').classList.remove('hidden');
  for (const r of racers) r.mesh.visible = true;
  if (ghost) ghost.mesh.visible = false;
  if (podium) podium.visible = false;
  tvIdx = -1; swoopT = 1; lastSeg = -1;
}
function endReplay() {
  $('replay-badge').classList.add('hidden'); document.body.classList.remove('cinematic');
  racers.forEach((r, i) => { const s = liveSnapshot[i]; if (s) { r.phys.pos.copy(s.pos); r.phys.heading = s.heading; r.phys.vf = s.vf; r.idx = s.idx; } });
  startPodium();
}

// ---------------- results / podium ----------------
let podium: THREE.Group | null = null;
let finalOrder: Racer[] = [];
let champAwarded = false;
const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];
function raceOrder() {
  return [...racers].sort((a, b) => (a.finished && b.finished) ? a.finishTime - b.finishTime : (a.finished ? -1 : b.finished ? 1 : progress(b) - progress(a)));
}
function buildPodium() {
  // the Throne of Ash: obsidian altar steps, bone trim, a burning sigil, flanking braziers and great horns
  const g = new THREE.Group();
  const s = track.samples[Math.floor(track.N * 0.03)];
  const mat = new THREE.MeshStandardMaterial({ color: 0x120c0b, metalness: 0.4, roughness: 0.25, flatShading: true });
  const boneM = new THREE.MeshStandardMaterial({ color: 0xcfbf9e, roughness: 0.7 });
  const glowM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a10).multiplyScalar(3), toneMapped: false });
  const steps: [number, number, string][] = [[0, 1.6, 'I'], [-4.6, 1.0, 'II'], [4.6, 0.6, 'III']];
  for (const [x, h, label] of steps) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.9, h, 6), mat); b.position.set(x, h / 2, 0); b.castShadow = b.receiveShadow = true; g.add(b);
    const t = new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.08, 4, 6), glowM); t.rotation.x = Math.PI / 2; t.rotation.z = Math.PI / 6; t.position.set(x, h, 0); g.add(t);
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.8, Math.min(0.9, h * 0.7)), new THREE.MeshBasicMaterial({ map: textTexture(label), toneMapped: false }));
    plate.position.set(x, h / 2, 2.55); g.add(plate);
  }
  // throne back with horns behind the winner
  const back = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.5, 0.5), mat); back.position.set(0, 1.6 + 2.25, -2.4); back.castShadow = true; g.add(back);
  const hornPts = [new THREE.Vector3(1.4, 0, 0), new THREE.Vector3(2.6, 1.6, 0.2), new THREE.Vector3(2.4, 3.6, 0.4), new THREE.Vector3(1.3, 4.6, 0.6)];
  const hg = horn(hornPts, 0.45, 14);
  for (const sx of [1, -1]) { const h = new THREE.Mesh(hg, boneM); h.scale.x = sx; h.position.set(0, 1.6 + 4.2, -2.4); h.castShadow = true; g.add(h); }
  // burning sigil on the ground
  const sig = new THREE.Mesh(new THREE.PlaneGeometry(16, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: sigilTexture(), color: new THREE.Color(0xff3a10).multiplyScalar(2.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  sig.position.set(0, 0.08, 1); g.add(sig);
  // braziers either side
  for (const x of [-8.2, 8.2]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.35, 3.2, 6), mat); pole.position.set(x, 1.6, 0.5); g.add(pole);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.45, 0.6, 8, 1, true), mat); bowl.position.set(x, 3.4, 0.5); g.add(bowl);
    const coal = new THREE.Mesh(new THREE.CircleGeometry(0.95, 8).rotateX(-Math.PI / 2), glowM); coal.position.set(x, 3.5, 0.5); g.add(coal);
  }
  const light = new THREE.PointLight(0xff5a1a, 60, 26, 1.6); light.position.set(0, 5, 3); g.add(light);
  g.position.copy(s.p); g.rotation.y = Math.atan2(s.n.x, s.n.z);
  world!.add(g); g.updateMatrixWorld(true);
  g.userData.fires = [new THREE.Vector3(-8.2, 3.6, 0.5), new THREE.Vector3(8.2, 3.6, 0.5)].map(v => v.applyMatrix4(g.matrixWorld));
  return { g, steps };
}
function startPodium() {
  state = 'podium';
  finalOrder = raceOrder();
  hud.show(false); hud.combo(null);
  if (podium) world!.remove(podium);
  const { g, steps } = buildPodium(); podium = g;
  for (const r of racers) r.mesh.visible = false;
  if (ghost) ghost.mesh.visible = false;
  finalOrder.slice(0, 3).forEach((r, i) => {
    const [x, h] = steps[i];
    r.mesh.visible = true;
    r.mesh.position.copy(new THREE.Vector3(x, h, 0).applyMatrix4(g.matrixWorld));
    r.mesh.rotation.set(0, g.rotation.y + Math.PI, 0);
    r.flames.forEach(f => (f.visible = false));
  });
  for (const f of g.userData.fires as THREE.Vector3[]) emitFire(f, new THREE.Vector3(), 40, 2);
  confetti.burst(new THREE.Vector3(g.position.x, 7, g.position.z));
  audio.chime(523, 4); setTimeout(() => audio.chime(659, 4), 350);
  music.intensity = 0;
  showResults();
}
function showResults() {
  const sorted = finalOrder;
  const champMode = mode === 'champ';
  if (champMode && !champAwarded) {
    sorted.forEach((r, i) => champ.points.set(r.name, (champ.points.get(r.name) ?? 0) + (POINTS[i] ?? 0)));
    champAwarded = true;
  }
  if (mode === 'tt') {
    const best = Math.min(...lapTimes);
    $('res-table').innerHTML = `<tr><th>LAP</th><th>TIME</th></tr>` + lapTimes.map((t, i) => `<tr class="${t === best ? 'me' : ''}"><td>${i + 1}</td><td>${fmt(t)}</td></tr>`).join('');
  } else {
    const rows = sorted.map((r, i) => `<tr class="${r.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td>${r.name}</td><td>${r.car.name}</td><td>${r.finished ? fmt(r.finishTime) : '<i>DNF</i>'}</td><td>${isFinite(r.bestLap) ? fmt(r.bestLap) : '--'}</td>${champMode ? `<td class="pts">+${POINTS[i] ?? 0}</td>` : ''}</tr>`);
    $('res-table').innerHTML = `<tr><th>POS</th><th>DRIVER</th><th>CAR</th><th>TIME</th><th>BEST LAP</th>${champMode ? '<th>PTS</th>' : ''}</tr>${rows.join('')}`;
  }
  const place = sorted.indexOf(player) + 1;
  $('res-title').textContent = mode === 'tt' ? 'SOUL TRIAL' : place === 1 ? 'YOU RULE HELL!' : `FINISHED P${place}`;
  const extras = [`Style ${score.toLocaleString('en-US')} pts`, takedowns && `${takedowns} takedown${takedowns > 1 ? 's' : ''}`, nearMisses && `${nearMisses} near miss${nearMisses > 1 ? 'es' : ''}`,
    bestDrift && `best drift ${bestDrift.toLocaleString('en-US')}`, perfectStart && 'perfect start'].filter(Boolean).join(' · ');
  $('res-note').innerHTML = `Best lap on ${trackDef.name}: <b>${isFinite(bestLap) ? fmt(bestLap) : '--'}</b><br>${extras}`;
  $('btn-again').textContent = champMode ? (champ.round < TRACKS.length - 1 ? 'STANDINGS' : 'FINAL STANDINGS') : 'RACE AGAIN';
  $('results').classList.remove('hidden');
  refreshMainFoot();
}
function hideResults() { $('results').classList.add('hidden'); }

// ---------------- visuals sync ----------------
const wp = new THREE.Vector3();
function syncMeshes(dt: number, trails = true) {
  for (const r of racers) {
    const p = r.phys;
    r.mesh.position.set(p.pos.x, 0, p.pos.z);
    r.mesh.rotation.order = 'YXZ';
    r.mesh.rotation.y = -p.heading;
    const latAcc = p.vf * p.yawRate;
    r.mesh.rotation.z = THREE.MathUtils.lerp(r.mesh.rotation.z, THREE.MathUtils.clamp(latAcc * 0.006, -0.06, 0.06), 0.15);
    r.mesh.rotation.x = THREE.MathUtils.lerp(r.mesh.rotation.x, (r.input.brake - r.input.throttle) * 0.015, 0.1);
    r.wheelRot += p.vf * dt / 0.36;
    r.wheels.forEach((w, i) => { if (i < 2) w.rotation.y = -p.steerAngle; w.rotation.x = -r.wheelRot; });
    r.brakeMat.emissiveIntensity = r.input.brake > 0.1 ? 7 : 1.4;
    const breath = Math.min(1, Math.max(0, r.input.throttle) * 0.6 + p.speed / 160);
    for (const f of r.flames) { f.visible = true; if (p.boosting) f.scale.set(1.25, 1.25, 1 + Math.random() * 0.8); else f.scale.set(0.45, 0.45, 0.15 + breath * 0.35 + Math.random() * 0.12); }
    r.boostGlow += ((p.boosting ? 1 : 0) - r.boostGlow) * Math.min(1, dt * 5);
    setGlow(r.glow, engineColor(r.car.kit), r.boostGlow, time + r.idx);
    // Soul Burn hellfire trail from both exhausts; banished cars burn while they wreck
    if (p.boosting && Math.random() < 0.35 + quality * 0.3) for (const f of r.flames) { f.getWorldPosition(wp); fire.emit(wp, p.velocity(tmpV).multiplyScalar(0.2), 0.8, 0.6); }
    if (r.wreckT > 0 && Math.random() < 0.6) fire.emit(fireP.copy(p.pos).setY(0.8), p.velocity(tmpV).multiplyScalar(0.3), 2, 2);
    if (!trails) continue;
    const sliding = (p.slipRear > 0.14 || (r.input.handbrake && p.speed > 6) || (p.wheelspin > 0.85 && p.speed < 18 && r.input.throttle > 0.5)) && p.speed > 3 && !p.offroad;
    for (let w = 2; w < 4; w++) {
      r.wheels[w].getWorldPosition(wp);
      skids.add(r.name + w, wp, sliding);
      if (sliding && Math.random() < (quality + 1) * 0.25) smoke.emit(wp.setY(0.3), p.velocity(tmpV));
      if (sliding && p.speed > 8 && Math.random() < (quality + 1) * 0.2) sparks.emit(wp.setY(0.25), p.velocity(tmpV).multiplyScalar(0.5), 3, 1.5); // drift embers
      else if (trackDef.wet && p.speed > 18 && Math.random() < (quality + 1) * 0.12) smoke.emit(wp.setY(0.2), p.velocity(tmpV).multiplyScalar(0.6), 1, 0.4); // road spray
    }
  }
}

// ---------------- cameras ----------------
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let tvIdx = -1; const tvPos = new THREE.Vector3();
let orbitT = 0, swoopT = 0;
let menuCam = 3, menuCamT = 0, lastSeg = -1;
const want = new THREE.Vector3(), wantLook = new THREE.Vector3();
// camera ids: 0 chase, 1 bumper, 2 TV, 3 orbit, 4 low side tracking, 5 high crane
function updateCamera(dt: number, modeOverride?: number) {
  const tr = camTarget ?? player;
  const p = tr.phys;
  const f = p.forward(new THREE.Vector3()), rt = p.right(new THREE.Vector3());
  const speed = p.speed;
  const target = new THREE.Vector3(p.pos.x, 0, p.pos.z);
  const m = modeOverride ?? camMode;
  let fov = 60, smooth = false;
  if (state === 'intro') {
    const t = Math.min(introT / INTRO_LEN, 1), e = t * t * (3 - 2 * t);
    const lead = racers[0].phys.pos;
    const a = new THREE.Vector3().copy(lead).addScaledVector(f, 25).add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(rt, 6);
    const b = new THREE.Vector3().copy(target).addScaledVector(rt, -14).setY(16);
    const c = new THREE.Vector3().copy(target).addScaledVector(f, -6.0).setY(1.9);
    const k1 = a.clone().lerp(b, e), k2 = b.clone().lerp(c, e);
    want.copy(k1.lerp(k2, e));
    wantLook.copy(lead).lerp(target, Math.min(1, e * 1.4)).setY(1);
    fov = 45 + 15 * e;
  } else if (state === 'podium' && podium) {
    orbitT += dt * 0.22;
    for (const f of podium.userData.fires as THREE.Vector3[]) for (let k = 0; k < 2; k++) fire.emit(f, tmpF.set(0, 0, 0), 0.9, 1.6);
    const c = podium.position;
    want.set(c.x + Math.cos(orbitT) * 14, 4.2 + Math.sin(orbitT * 0.7) * 1.2, c.z + Math.sin(orbitT) * 14);
    wantLook.set(c.x, 1.4, c.z); fov = 50; smooth = true;
  } else if (m === 0) {
    const vel = p.velocity(new THREE.Vector3());
    const dir = speed > 4 ? f.clone().lerp(vel.normalize(), 0.35).normalize() : f;
    want.copy(target).addScaledVector(dir, -6.0 - speed * 0.015).setY(1.9 + speed * 0.006);
    camPos.lerp(want, 1 - Math.exp(-dt * 7)); want.copy(camPos);
    camLook.lerp(target.clone().addScaledVector(f, 5).setY(0.9), 1 - Math.exp(-dt * 12)); wantLook.copy(camLook);
    fov = 60 + Math.min(speed, 80) * 0.28;
  } else if (m === 1) {
    want.copy(target).addScaledVector(f, 2.45).setY(0.75);
    wantLook.copy(target).addScaledVector(f, 20).setY(0.9);
    fov = 70 + Math.min(speed, 80) * 0.2;
  } else if (m === 2) {
    const step = Math.floor(track.N / 14);
    const wIdx = (Math.floor(tr.idx / step) * step + Math.floor(step * 0.7)) % track.N;
    if (wIdx !== tvIdx) {
      tvIdx = wIdx; const s = track.samples[tvIdx];
      tvPos.set(s.p.x + s.n.x * (WALL_OFFSET + 6), 6, s.p.z + s.n.z * (WALL_OFFSET + 6));
      if (swoopT <= 0) camPos.copy(tvPos);
    }
    want.copy(tvPos); camLook.lerp(target.clone().setY(0.8), 1 - Math.exp(-dt * 10)); wantLook.copy(camLook);
    fov = THREE.MathUtils.clamp(2400 / Math.max(10, tvPos.distanceTo(target)), 12, 60);
  } else if (m === 3) {
    orbitT += dt * 0.35;
    want.set(target.x + Math.cos(orbitT) * 9, 3, target.z + Math.sin(orbitT) * 9);
    wantLook.copy(target).setY(0.8); smooth = true;
  } else if (m === 4) {
    want.copy(target).addScaledVector(rt, 4.2).addScaledVector(f, 1.5).setY(0.55);
    wantLook.copy(target).addScaledVector(f, 2).setY(0.7); fov = 48; smooth = true;
  } else {
    want.copy(target).addScaledVector(f, -16).addScaledVector(rt, 12).setY(15);
    wantLook.copy(target).addScaledVector(f, 8).setY(0); fov = 50; smooth = true;
  }
  if (swoopT > 0 || smooth) {
    swoopT = Math.max(0, swoopT - dt);
    const k = 1 - Math.exp(-dt * (swoopT > 0 ? 2.2 : 6));
    camPos.lerp(want, k); camLook.lerp(wantLook, k);
  } else { camPos.copy(want); camLook.copy(wantLook); }
  camera.position.copy(camPos);
  if (shake > 0.001) { camera.position.x += (Math.random() - 0.5) * shake * 0.5; camera.position.y += (Math.random() - 0.5) * shake * 0.4; shake *= Math.exp(-dt * 6); }
  if (m < 2 && speed > 45 && state === 'race') camera.position.y += (Math.random() - 0.5) * (speed - 45) * 0.0015;
  camera.lookAt(camLook);
  if (p.boosting && state !== 'intro' && m < 2) fov += 10;
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  if (speedPass) {
    const u = speedPass.uniforms;
    u.uAmount.value = m < 2 && state === 'race' ? THREE.MathUtils.clamp((speed - 30) / 45, 0, 1) * (quality > 1 ? 1.4 : 1) : 0;
    u.uNitro.value += ((p.boosting && m < 2 && state === 'race' ? 1 : 0) - u.uNitro.value) * Math.min(1, dt * 6);
    u.uTime.value += dt;
    u.uShock.value = Math.max(0, u.uShock.value - dt * 1.6);
    u.uSlow.value += ((timeScale < 0.9 ? 1 : 0) - u.uSlow.value) * Math.min(1, dt * 8);
  }
  dirLight.position.copy(target).add(sunOffset); dirLight.target.position.copy(target);
}

// ---------------- main loop ----------------
const clock = new THREE.Timer();
let fpsAcc = 0, fpsFrames = 0, fps = 60, time = 0;
let skipIntro = false;
function frame(ts?: number) {
  requestAnimationFrame(frame);
  clock.update(ts);
  const rdt = Math.min(clock.getDelta(), 0.1);
  input.pollPad();
  handleGlobalKeys();
  time += rdt;
  if (slowT > 0) slowT -= rdt;
  timeScale += ((slowT > 0 ? 0.4 : 1) - timeScale) * Math.min(1, rdt * 10);
  const dt = rdt * (state === 'race' || state === 'finishing' ? timeScale : 1);

  if (state === 'garage' && showroom) { showroom.render(renderer, rdt); fpsTick(rdt); input.endFrame(); return; }
  flameUniforms.uTime.value += dt; hellUniforms.uTime.value += dt;
  if (state === 'intro') {
    introT += dt;
    acc += dt; while (acc >= STEP) { simulate(STEP); acc -= STEP; }
    if (introT >= INTRO_LEN || input.hit('Enter') || input.hit('Space') || skipIntro) endIntro();
  }
  if (state === 'countdown' || state === 'race' || state === 'finishing') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n++ < 12) { simulate(STEP); acc -= STEP; if (state !== 'countdown') raceTime += STEP; }
    if (state === 'countdown') {
      countdown -= dt;
      // perfect start: gas pressed during the last 0.35 s before GO (or within 0.25 s after); earlier = jump start
      const thr = autopilot ? 0 : input.controls().throttle;
      if (thr > 0.5) { if (gasHeldSince < 0) gasHeldSince = countdown; } else gasHeldSince = -1;
      const sec = Math.ceil(countdown - 1);
      if (sec !== lastBeep && sec >= 0 && sec <= 2) { lastBeep = sec; audio.beep(440); }
      hud.lights(countdown);
      if (countdown <= 1) {
        state = 'race'; audio.beep(880, 0.5); hud.flash('GO!', 1);
        if (gasHeldSince > 0 && gasHeldSince <= 1.35) doPerfectStart();
        else if (gasHeldSince > 1.35) { bogT = 1.1; hud.popup('FALSE START — CURSED', 'red'); }
        else startWindow = 0.25;
      }
    } else if (state === 'race') {
      if (startWindow > 0) { startWindow -= dt; if (!autopilot && input.controls().throttle > 0.5) { startWindow = 0; doPerfectStart(); } }
      perfectT -= dt; bogT -= dt; shockCool -= dt; bumpCool -= dt;
      const boosting = player.phys.boosting;
      if (boosting && !wasBoosting && player.phys.nitro > 0.55 && shockCool <= 0 && perfectT <= 0) { fireShockwave(); shockCool = 5; }
      wasBoosting = boosting;
      onDriftTick(dt); nearMissTick(dt);
      recordGhost(dt); updateGhost();
    } else {
      finishT += rdt; nearMissTick(dt);
      if (finishT > 2.6) startReplay();
    }
    if ((state as State) !== 'replay') replay.record(dt);
  } else if (state === 'menu') {
    acc += dt; let n = 0;
    while (acc >= STEP && n++ < 10) { simulate(STEP); acc -= STEP; }
    menuCamT += dt;
    if (menuCamT > 9 && racers.length && screen !== 'standings') { // cycle attract-mode camera presets with a swoop
      const cyc = [3, 4, 5, 2]; menuCamT = 0; menuCam = cyc[(cyc.indexOf(menuCam) + 1) % cyc.length];
      camTarget = racers[Math.floor(Math.random() * racers.length)]; swoopT = 1.6; tvIdx = -1;
    }
  } else if (state === 'replay') {
    replayT += dt * (replay.len - replayT < 2.5 ? 0.45 : 1);
    replay.apply(replayT);
    if (replayT >= replay.len - 0.05 || input.hit('Enter') || input.hit('Space') || skipIntro) { skipIntro = false; endReplay(); }
  }
  if (state === 'replay') syncMeshes(dt, false);
  else if (state !== 'paused' && state !== 'podium') syncMeshes(dt);
  if (state !== 'paused') { smoke.update(dt); sparks.update(dt); fire.update(dt); shock.update(dt); confetti.update(dt, time); }
  worldEnv?.update(dt, time, camera.position);
  if (racers.length) {
    let ov: number | undefined;
    if (state === 'menu') ov = menuCam;
    else if (state === 'replay') { const seg = Math.floor(replayT / 3.2) % 3; ov = [2, 4, 3][seg]; if (seg !== lastSeg) { lastSeg = seg; tvIdx = -1; } camTarget = player; }
    else if (state === 'finishing') ov = 3;
    updateCamera(dt, ov);
  }
  raceOrder().forEach((r, i) => (r.place = i + 1));
  const active = state === 'race' || state === 'countdown' || state === 'intro' || state === 'finishing';
  if (player) {
    const skid = player.phys.speed > 5 ? Math.max(0, player.phys.slipRear - 0.12) * 4 + (player.input.handbrake ? 0.5 : 0) : 0;
    audio.update(player.phys.rpm, player.input.throttle, skid, active || state === 'replay', player.phys.boosting);
  }
  if (state === 'race' || state === 'countdown' || state === 'finishing') hud.update(dt, player, racers, totalLaps, raceTime, bestLap, fps);

  if (composer) composer.render(); else renderer.render(scene, camera);
  fpsTick(rdt);
  input.endFrame();
}
function fpsTick(dt: number) { fpsAcc += dt; fpsFrames++; if (fpsAcc > 0.5) { fps = fpsFrames / fpsAcc; fpsAcc = 0; fpsFrames = 0; } }
function doPerfectStart() {
  perfectStart = true; perfectT = 1.3; player.phys.nitro = Math.min(1, player.phys.nitro + 0.25);
  addScore(500, 'UNHOLY START!', 'big gold'); audio.chime(784, 4); shake = 0.4;
}
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
    else if (state === 'replay') skipIntro = true;
    else if (state === 'menu' || state === 'garage') goBack();
  }
}
let pausedFrom: State = 'race';
function pause(on: boolean) {
  if (on) { pausedFrom = state; state = 'paused'; $('pause').classList.remove('hidden'); void audio.ctx?.suspend(); }
  else { state = pausedFrom; $('pause').classList.add('hidden'); void audio.ctx?.resume(); acc = 0; }
}
function toggleMute() { audio.setMuted(!audio.muted); $('btn-mute').textContent = audio.muted ? 'SOUND: OFF' : 'SOUND: ON'; }

// ---------------- menus ----------------
type ScreenId = 'main' | 'mode' | 'track' | 'garage' | 'options' | 'standings';
let screen: ScreenId | null = null;
const history: ScreenId[] = [];
const SCREEN_CAM: Record<ScreenId, number> = { main: 3, mode: 4, track: 5, garage: 3, options: 2, standings: 5 };
function showScreen(id: ScreenId, push = true) {
  if (screen === id) return;
  if (screen) {
    const old = $(`scr-${screen}`); old.classList.add('leaving');
    setTimeout(() => { if (screen !== old.id.slice(4)) old.classList.add('hidden'); old.classList.remove('leaving'); }, 300);
    if (push) history.push(screen);
  }
  screen = id;
  const el = $(`scr-${id}`); el.classList.remove('hidden', 'leaving');
  el.querySelectorAll<HTMLElement>(':scope > *').forEach(c => { c.style.animation = 'none'; void c.offsetWidth; c.style.animation = ''; });
  audio.beep(1320, 0.04);
  if (id === 'garage') openGarage();
  else if (state === 'garage') state = 'menu';
  if (state === 'menu') { menuCam = SCREEN_CAM[id]; swoopT = 1.6; menuCamT = 0; tvIdx = -1; }
  if (id === 'track') buildTrackCards();
  if (id === 'options') loadOptions();
  if (id === 'main') refreshMainFoot();
}
function goBack() { const prev = history.pop(); if (prev) showScreen(prev, false); }
function hideScreens() {
  if (screen) $(`scr-${screen}`).classList.add('hidden');
  if (state === 'garage') state = 'menu';
  screen = null; history.length = 0;
}
async function toMenu(to: ScreenId = 'main') {
  hideResults(); $('pause').classList.add('hidden'); $('replay-badge').classList.add('hidden');
  document.body.classList.remove('cinematic', 'tt');
  void audio.ctx?.resume();
  state = 'menu'; hud.show(false); music.intensity = 0;
  wipe(); await sleep(400);
  attract();
  showScreen(to, false);
}
function attract() {
  setupRace(true); state = 'menu'; hud.show(false);
  for (const r of racers) { r.isPlayer = false; r.skill = 0.9; r.phys.power = 0.9; r.phys.stability = 1; }
  camTarget = racers[0]; menuCam = screen ? SCREEN_CAM[screen] : 3; swoopT = 0;
  camPos.copy(camTarget.phys.pos).add(new THREE.Vector3(8, 3, 8));
}
function refreshMainFoot() {
  const c = carById(settings.car);
  $('m-car').textContent = `Car: ${c.name}`;
  const b = getBest(settings.track, settings.car);
  $('m-best').textContent = `Best on ${trackById(settings.track).name}: ${isFinite(b) ? fmt(b) : '--'}`;
}

document.querySelectorAll<HTMLElement>('[data-back]').forEach(b => (b.onclick = goBack));
$('m-play').onclick = () => showScreen('mode');
$('m-garage').onclick = () => showScreen('garage');
$('m-options').onclick = () => showScreen('options');
document.querySelectorAll<HTMLElement>('#mode-cards .mcard').forEach(c => (c.onclick = () => {
  mode = c.dataset.mode as Mode;
  if (mode === 'champ') champInit();
  showScreen('track');
}));

// track select
const thumbTracks = new Map<string, Track>();
function buildTrackCards() {
  const box = $('track-cards'); box.innerHTML = '';
  const champMode = mode === 'champ';
  $('track-title').textContent = champMode ? 'INFERNAL CROWN · 3 CIRCLES' : mode === 'tt' ? 'SOUL TRIAL · CHOOSE YOUR HELL' : 'DAMNED SPRINT · CHOOSE YOUR HELL';
  $('lbl-ai').classList.toggle('hidden', mode !== 'quick');
  $('lbl-diff').classList.toggle('hidden', mode === 'tt');
  $('t-start').textContent = champMode ? 'START ROUND 1' : 'START';
  TRACKS.forEach((t, i) => {
    let tr = thumbTracks.get(t.id); if (!tr) { tr = new Track(t.control, t.scale, t.grip); thumbTracks.set(t.id, tr); }
    const c = document.createElement('div'); c.className = 'mcard'; c.dataset.track = t.id; c.style.setProperty('--accent', t.accent);
    if (!champMode && settings.track === t.id) c.classList.add('sel');
    const best = getBest(t.id, settings.car);
    c.innerHTML = `<span class="tod">${champMode ? 'ROUND ' + (i + 1) : t.tod}</span><canvas width="300" height="130"></canvas><b>${t.name}</b><p>${t.subtitle} · ${(tr.length / 1000).toFixed(2)} km</p><div class="rec">Best (${carById(settings.car).name}): ${isFinite(best) ? fmt(best) : '--'}</div>`;
    drawTrackThumb(c.querySelector('canvas')!, tr, t.accent);
    if (!champMode) c.onclick = () => {
      settings.track = t.id; saveSettings();
      box.querySelectorAll('.mcard').forEach(x => x.classList.remove('sel')); c.classList.add('sel');
      void switchMenuWorld(t.id);
    };
    box.appendChild(c);
  });
  ($('opt-laps') as HTMLSelectElement).value = String(settings.laps);
  ($('opt-ai') as HTMLSelectElement).value = String(settings.opponents);
  ($('opt-diff') as HTMLSelectElement).value = String(settings.difficulty);
}
async function switchMenuWorld(id: string) {
  if (id === worldId) return;
  wipe(); await sleep(420);
  await ensureWorld(id);
  attract(); menuCam = screen ? SCREEN_CAM[screen] : 5;
}
$('opt-laps').onchange = e => { settings.laps = Number(val(e)); saveSettings(); };
$('opt-ai').onchange = e => { settings.opponents = Number(val(e)); saveSettings(); };
$('opt-diff').onchange = e => { settings.difficulty = Number(val(e)); saveSettings(); };
$('t-start').onclick = () => { champAwarded = false; if (mode === 'champ') champInit(); void startRace(); };

// garage
let gIdx = 0;
const STAT_KEYS = ['speed', 'accel', 'handling', 'nitro'] as const;
function openGarage() {
  if (!showroom) showroom = new Showroom(renderer, assets, quality);
  state = 'garage'; gIdx = Math.max(0, CARS.findIndex(c => c.id === settings.car));
  showroom.intro = 0; garageCar();
}
function garageCar() {
  const c = CARS[gIdx];
  const col = settings.colors[c.id] ?? c.color;
  showroom!.setCar(c, col); showroom!.setAccent(new THREE.Color(trackDef.accent).getHex());
  $('g-name').textContent = c.name; $('g-tag').textContent = c.tagline; $('g-lore').textContent = c.lore;
  $('g-stats').innerHTML = STAT_KEYS.map(k => `<div class="stat"><span>${k === 'nitro' ? 'SOUL BURN' : k.toUpperCase()}</span><div class="sb"><i style="width:0"></i></div><b>${c.stats[k]}</b></div>`).join('');
  requestAnimationFrame(() => requestAnimationFrame(() => $('g-stats').querySelectorAll<HTMLElement>('i').forEach((el, i) => (el.style.width = `${c.stats[STAT_KEYS[i]] * 10}%`))));
  const paints = PAINTS.includes(c.color) ? PAINTS : [c.color, ...PAINTS.slice(0, -1)];
  $('g-paint').innerHTML = paints.map(p => `<i data-c="${p}" style="background:#${p.toString(16).padStart(6, '0')}" class="${p === col ? 'sel' : ''}"></i>`).join('');
  $('g-paint').querySelectorAll<HTMLElement>('i').forEach(el => (el.onclick = () => {
    const v = Number(el.dataset.c); settings.colors[c.id] = v; saveSettings(); showroom!.setColor(v);
    $('g-paint').querySelectorAll('i').forEach(x => x.classList.remove('sel')); el.classList.add('sel'); audio.beep(1500, 0.03);
  }));
  $('g-best').innerHTML = TRACKS.map(t => { const b = getBest(t.id, c.id); return `${t.name}: ${isFinite(b) ? fmt(b) : '--'}`; }).join('<br>');
  $('g-select').textContent = settings.car === c.id ? 'BOUND ✓' : 'BIND SOUL';
}
$('g-prev').onclick = () => { gIdx = (gIdx + CARS.length - 1) % CARS.length; garageCar(); audio.swish(); };
$('g-next').onclick = () => { gIdx = (gIdx + 1) % CARS.length; garageCar(); audio.swish(); };
$('g-select').onclick = () => { settings.car = CARS[gIdx].id; saveSettings(); garageCar(); refreshMainFoot(); audio.chime(880, 2); setTimeout(goBack, 250); };
renderer.domElement.addEventListener('pointerdown', e => { if (state === 'garage') showroom?.pointerDown(e.clientX); });
window.addEventListener('pointermove', e => { if (state === 'garage') showroom?.pointerMove(e.clientX); });
window.addEventListener('pointerup', () => showroom?.pointerUp());

// options
const val = (e: Event) => (e.target as HTMLInputElement).value;
function loadOptions() {
  const set = (id: string, v: string) => (($(id) as HTMLInputElement).value = v);
  set('o-quality', String(quality)); set('o-camera', String(settings.camera)); set('o-sfx', String(settings.sfx)); set('o-music', String(settings.music));
  set('o-units', settings.units); set('o-layout', settings.layout); set('o-tilt', input.touch.tilt ? '1' : '0'); set('o-fps', settings.showFps ? '1' : '0');
}
$('o-quality').onchange = e => {
  localStorage.setItem(LS_QUALITY, val(e));
  const u = new URL(location.href); u.searchParams.delete('quality'); u.searchParams.set('screen', 'options'); location.href = u.toString();
};
$('o-camera').onchange = e => { settings.camera = Number(val(e)); saveSettings(); };
$('o-sfx').oninput = e => { settings.sfx = Number(val(e)); audio.setVolumes(settings.sfx, settings.music); saveSettings(); };
$('o-music').oninput = e => { settings.music = Number(val(e)); audio.setVolumes(settings.sfx, settings.music); saveSettings(); };
$('o-units').onchange = e => { settings.units = val(e) as 'kmh' | 'mph'; hud.units = settings.units; saveSettings(); };
$('o-layout').onchange = e => { settings.layout = val(e) as 'standard' | 'swapped'; document.body.classList.toggle('swapped', settings.layout === 'swapped'); saveSettings(); };
$('o-tilt').onchange = async e => {
  const on = await input.touch.setTilt(val(e) === '1'); settings.tilt = on; saveSettings();
  ($('o-tilt') as HTMLSelectElement).value = on ? '1' : '0';
  if (on) $('o-note').textContent = 'Tilt on: roll your phone like a steering wheel (◀ ▶ still work).';
};
$('o-fps').onchange = e => { settings.showFps = val(e) === '1'; hud.showFps = settings.showFps; saveSettings(); };
$('o-reset').onclick = () => {
  Object.keys(localStorage).filter(k => k.startsWith('neonapex.best') || k.startsWith('neonapex.ghost')).forEach(k => localStorage.removeItem(k));
  $('o-reset').textContent = 'RECORDS CLEARED'; refreshMainFoot();
};

// championship standings
function showStandings() {
  hideResults();
  const last = champ.round >= TRACKS.length - 1;
  const rows = [...champ.points.entries()].sort((a, b) => b[1] - a[1]);
  $('st-title').textContent = last ? (rows[0][0] === 'YOU' ? 'YOU ARE THE CHAMPION! THE CROWN IS YOURS' : `${rows[0][0].toUpperCase()} WINS THE TITLE`) : `STANDINGS · AFTER ROUND ${champ.round + 1}`;
  $('st-rounds').innerHTML = TRACKS.map((t, i) => `<span class="${i <= champ.round ? 'done' : ''}">R${i + 1} ${t.name}</span>`).join('');
  $('st-table').innerHTML = `<tr><th>POS</th><th>DRIVER</th><th>CAR</th><th>PTS</th></tr>` + rows.map(([n, p], i) =>
    `<tr class="${n === 'YOU' ? 'me' : ''}"><td>${i + 1}</td><td>${n}</td><td>${carById(n === 'YOU' ? settings.car : champ.cars.get(n) ?? 'stradale').name}</td><td class="pts">${p}</td></tr>`).join('');
  $('st-next').textContent = last ? 'FINISH' : `ROUND ${champ.round + 2}: ${TRACKS[champ.round + 1].name.toUpperCase()}`;
  showScreen('standings', false);
  if (last) { confetti.burst(camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 12).setY(8)); audio.chime(523, 4); }
}
$('st-next').onclick = () => {
  if (champ.round >= TRACKS.length - 1) { champ.active = false; void toMenu('main'); return; }
  champ.round++; champAwarded = false; void startRace();
};
$('st-quit').onclick = () => { champ.active = false; void toMenu('main'); };

// pause / results
$('btn-resume').onclick = () => pause(false);
$('btn-restart').onclick = () => { $('pause').classList.add('hidden'); void audio.ctx?.resume(); champAwarded = false; void startRace(); };
$('btn-mute').onclick = toggleMute;
$('btn-quit').onclick = () => void toMenu('main');
$('btn-again').onclick = () => { if (mode === 'champ') showStandings(); else { champAwarded = false; void startRace(); } };
$('btn-menu').onclick = () => void toMenu('main');
$('btn-replay').onclick = () => startReplay();
$('btn-mute').textContent = audio.muted ? 'SOUND: OFF' : 'SOUND: ON';

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight); composer?.setSize(window.innerWidth, window.innerHeight);
});
document.addEventListener('pointerdown', e => {
  if (state === 'intro' || (state === 'replay' && !(e.target as HTMLElement).closest('button'))) skipIntro = true;
  audio.init(); // the first gesture unlocks audio + menu music
}, { capture: true });
window.addEventListener('keydown', () => audio.init(), { once: true });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'race') pause(true); });

// ---------------- loading screen ----------------
const TIPS = [
  'Stomp the gas in the last heartbeat before GO for an UNHOLY START.',
  'Hold a slide to stoke an ember combo, up to ×5. Kissing a wall snuffs it out.',
  'Unleash Soul Burn with a full tank to release a HELLBLAST that hurls rivals aside.',
  'Slam a rival into the spikes to BANISH them in fire.',
  'Skim past the damned at speed for NEAR MISS points and a moment of dread slow-motion.',
  'Falling ash cuts grip: brake earlier in the Ashen Storm. Cerberus digs in where others slide.',
  'Drifting feeds your Soul Burn. The Succubus drinks it in more than twice as fast.',
  'Soul Trial binds your best lap into a wraith you can race against.',
];
let tipI = Math.floor(Math.random() * TIPS.length);
const tipTimer = setInterval(() => { tipI = (tipI + 1) % TIPS.length; $('ld-tip').textContent = TIPS[tipI]; }, 3500);
startEmbers(document.getElementById('embers') as HTMLCanvasElement, isPhone() ? 45 : 90);
$('ld-tip').textContent = TIPS[tipI];
function setLoad(f: number, label: string) { $('ld-fill').style.width = `${Math.round(f * 100)}%`; $('ld-pct').textContent = `${Math.round(f * 100)}%`; $('ld-label').textContent = label; }

// debug / automation hooks (used by the screenshot + mobile scripts)
(window as unknown as Record<string, unknown>).__game = {
  quick: async (o: { track?: string; car?: string; mode?: Mode; laps?: number; opponents?: number } = {}) => {
    mode = o.mode ?? 'quick';
    if (o.track) settings.track = o.track;
    if (o.car) settings.car = o.car;
    if (o.laps) settings.laps = o.laps;
    if (o.opponents != null) settings.opponents = o.opponents;
    if (mode === 'champ') champInit();
    champAwarded = false;
    await startRace();
  },
  menuWorld: (id: string) => switchMenuWorld(id),
  setAutopilot: (v: boolean) => { autopilot = v; },
  skipIntro: () => { skipIntro = true; },
  teleport: (i: number) => { const s = track.samples[i]; player.phys.pos.copy(s.p); player.phys.heading = Math.atan2(s.t.x, -s.t.z); player.idx = i; },
  setNitro: (v: boolean) => { forceNitro = v; },
  setCamera: (m: number) => { camMode = m; $('h-cam').textContent = 'CAM: ' + CAM_NAMES[m]; },
  /** test-only: trigger a feature's feedback for screenshots */
  demo: (kind: string) => {
    if (kind === 'perfect') doPerfectStart();
    else if (kind === 'shock') { player.phys.nitro = 1; fireShockwave(); }
    else if (kind === 'takedown') { const r = racers.find(x => !x.isPlayer); if (r) takedown(r); }
    else if (kind === 'drift') { driftPts = 1840; driftMult = 4; driftT = 5; driftGrace = 3; hud.combo('EMBERS ×4  1,840'); }
    else if (kind === 'nearmiss') { nearMisses++; addScore(300, 'NEAR MISS'); slowmo(0.8); }
  },
  /** test-only: end the race now, keeping the current order */
  finishNow: () => {
    raceOrder().forEach((r, i) => { if (!r.finished) { r.finished = true; r.finishTime = raceTime + i * 0.7; } });
    bankDrift(); hud.flash('FINISH!', 2.4); state = 'finishing'; finishT = 0;
  },
  get state() { return state; },
  get countdown() { return countdown; },
  get controls() { return input.controls(); },
  get delta() { return document.getElementById('h-delta')!.textContent; },
  get screen() { return screen; },
  get mode() { return mode; },
  get track() { return worldId; },
  get fps() { return fps; },
  get score() { return score; },
  get champ() { return { round: champ.round, points: Object.fromEntries(champ.points) }; },
  get player() { return player && { speed: player.phys.speed, lap: player.crossings, place: player.place, idx: player.idx, car: player.car.id, finished: player.finished }; },
};

setLoad(0, 'Loading cars & textures');
loadAssets(renderer, quality, f => setLoad(f * 0.7, 'Loading cars & textures')).then(async a => {
  assets = a;
  setLoad(0.72, 'Building circuit');
  await ensureWorld(settings.track, f => setLoad(0.72 + f * 0.2, 'Loading sky & lighting'));
  setLoad(0.95, 'Warming up engines');
  attract();
  renderer.compile(scene, camera);
  setLoad(1, 'Ready');
  refreshMainFoot();
  frame();
  setTimeout(() => { $('loading').classList.add('done'); clearInterval(tipTimer); }, 250);
  const scr = params.get('screen') as ScreenId | null;
  if (params.has('autostart')) { mode = (params.get('mode') as Mode) ?? 'quick'; if (mode === 'champ') champInit(); void startRace(); }
  else {
    showScreen(scr && ['main', 'mode', 'track', 'garage', 'options'].includes(scr) ? scr : 'main', false);
    if (scr && scr !== 'main') history.push('main');
  }
}).catch(err => { console.error(err); $('ld-label').textContent = 'FAILED TO LOAD ASSETS'; });
