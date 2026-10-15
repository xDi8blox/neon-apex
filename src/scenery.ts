import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { Track, WALL_OFFSET, textTexture } from './track';
import type { Assets } from './assets';
import type { TrackDef } from './tracks';

/** Find the sun in an equirect HDR (brightest texel) and return its world direction. */
function sunFromHDRI(t: THREE.DataTexture): THREE.Vector3 {
  const { data, width, height } = t.image as { data: ArrayLike<number>; width: number; height: number };
  const half = data instanceof Uint16Array;
  let best = -1, bi = 0;
  for (let i = 0; i < width * height; i += 1) {
    const k = i * 4; const r = half ? THREE.DataUtils.fromHalfFloat(data[k]) : data[k];
    if (r > best) { best = r; bi = i; }
  }
  const x = bi % width, row = Math.floor(bi / width);
  const u = (x + 0.5) / width, v = 1 - (row + 0.5) / height;
  const phi = (u - 0.5) * 2 * Math.PI, theta = (v - 0.5) * Math.PI;
  return new THREE.Vector3(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)).normalize();
}

function flareTex(kind: 'glow' | 'ring' | 'streak' | 'hex'): THREE.Texture {
  const w = kind === 'streak' ? 512 : 128, h = kind === 'streak' ? 32 : 128;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const c = cv.getContext('2d')!;
  if (kind === 'streak') {
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,190,120,0)'); g.addColorStop(0.5, 'rgba(255,230,200,1)'); g.addColorStop(1, 'rgba(255,190,120,0)');
    c.fillStyle = g; c.fillRect(0, h / 2 - 2, w, 4);
    const g2 = c.createLinearGradient(0, 0, w, 0); g2.addColorStop(0, 'rgba(255,140,60,0)'); g2.addColorStop(0.5, 'rgba(255,160,90,.35)'); g2.addColorStop(1, 'rgba(255,140,60,0)');
    c.fillStyle = g2; c.fillRect(0, 0, w, h);
  } else if (kind === 'hex') {
    c.fillStyle = 'rgba(160,200,255,0.35)'; c.beginPath();
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; c.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); }
    c.fill();
  } else {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    if (kind === 'glow') { g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.15, 'rgba(255,220,170,.8)'); g.addColorStop(1, 'rgba(255,140,60,0)'); }
    else { g.addColorStop(0.6, 'rgba(255,200,150,0)'); g.addColorStop(0.8, 'rgba(255,200,150,.35)'); g.addColorStop(1, 'rgba(255,200,150,0)'); }
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** HDRI lighting, sun + lens flare, PBR ground and instanced scenery. */
export function buildEnvironment(scene: THREE.Scene, root: THREE.Object3D, renderer: THREE.WebGLRenderer, track: Track, quality: number,
  assets: Assets, def: TrackDef, hdri: THREE.DataTexture) {
  // --- HDRI (Poly Haven, CC0) for background + image-based lighting
  const pmrem = new THREE.PMREMGenerator(renderer);
  (scene.environment as THREE.Texture | null)?.dispose();
  scene.environment = pmrem.fromEquirectangular(hdri).texture;
  scene.background = hdri;
  scene.backgroundIntensity = def.bgIntensity;
  scene.environmentIntensity = def.envIntensity;
  pmrem.dispose();
  scene.fog = new THREE.Fog(def.fog, def.fogNear, def.fogFar);
  const scene0 = scene; void scene0;
  { const scene = root; // everything below is per-track and disposable

  // --- sun (or moon at night), aligned with the HDRI's brightest point (elevation clamped so shadows stay readable)
  const sun = def.night ? new THREE.Vector3(0.35, 0.6, 0.3).normalize() : sunFromHDRI(hdri);
  const sunLight = sun.clone(); sunLight.y = Math.max(sunLight.y, def.rain ? 0.6 : 0.22); sunLight.normalize();
  scene.add(new THREE.HemisphereLight(def.night ? 0x6070b0 : 0xffe2c4, 0x3a3328, def.hemi));
  const dir = new THREE.DirectionalLight(def.sunColor, def.sunIntensity);
  dir.position.copy(sunLight).multiplyScalar(300);
  if (quality > 0) {
    dir.castShadow = true;
    const s = quality > 1 ? 2048 : 1024;
    dir.shadow.mapSize.set(s, s);
    const c = dir.shadow.camera; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 10; c.far = 800;
    dir.shadow.bias = -0.0003; dir.shadow.normalBias = 0.03;
  }
  scene.add(dir); scene.add(dir.target);

  // --- lens flare + anamorphic streak at the visible sun position
  if (quality > 0 && !def.night && !def.rain) {
    const flare = new Lensflare();
    flare.addElement(new LensflareElement(flareTex('glow'), 420, 0, new THREE.Color(1, 0.9, 0.8)));
    flare.addElement(new LensflareElement(flareTex('streak'), 1100, 0, new THREE.Color(1, 0.85, 0.7)));
    flare.addElement(new LensflareElement(flareTex('ring'), 160, 0.35));
    flare.addElement(new LensflareElement(flareTex('hex'), 70, 0.6));
    flare.addElement(new LensflareElement(flareTex('hex'), 110, 0.75));
    flare.addElement(new LensflareElement(flareTex('ring'), 240, 1.0));
    flare.position.copy(sun).multiplyScalar(3000);
    scene.add(flare);
  }

  // --- ground: CC0 PBR grass (ambientCG)
  const G = assets.grass;
  const groundMat = new THREE.MeshStandardMaterial({ map: G.map, normalMap: G.normalMap, roughnessMap: G.roughnessMap, color: def.grass });
  const groundGeo = new THREE.PlaneGeometry(4000, 4000);
  { const uv = groundGeo.getAttribute('uv'); for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 900, uv.getY(i) * 900); }
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.25; ground.receiveShadow = true; scene.add(ground);

  const rnd = mulberry(1337);
  const N = track.N;
  const tmp = new THREE.Vector3();
  const isClear = (x: number, z: number, margin: number) => {
    const i = track.nearest(tmp.set(x, 0, z));
    const s = track.samples[i].p; return Math.hypot(s.x - x, s.z - z) > WALL_OFFSET + margin;
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  const UP = THREE.Object3D.DEFAULT_UP;

  // --- trees: broadleaf (jittered icosphere canopy) + conifers, instanced
  const treeCount = Math.round([250, 600, 1100][quality] * def.trees);
  const trunkG = new THREE.CylinderGeometry(0.22, 0.38, 3.2, 7); trunkG.translate(0, 1.6, 0);
  const canopyG = new THREE.IcosahedronGeometry(2.6, quality > 1 ? 2 : 1);
  { const pa = canopyG.getAttribute('position'); const r2 = mulberry(7);
    for (let i = 0; i < pa.count; i++) { const k = 0.82 + r2() * 0.3; pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k * 0.85, pa.getZ(i) * k); }
    canopyG.computeVertexNormals(); canopyG.translate(0, 5, 0); }
  const coneG = new THREE.ConeGeometry(2.2, 7, 9); coneG.translate(0, 6, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkG, trunkMat, treeCount);
  const canopies = new THREE.InstancedMesh(canopyG, leafMat, treeCount);
  const cones = new THREE.InstancedMesh(coneG, leafMat, treeCount);
  let nT = 0, nC = 0, nK = 0, guard = 0;
  while (nT < treeCount && guard++ < treeCount * 20) {
    const s = track.samples[Math.floor(rnd() * N)];
    const side = rnd() < 0.5 ? -1 : 1, d = WALL_OFFSET + 8 + rnd() * 110;
    const x = s.p.x + s.n.x * d * side + (rnd() - 0.5) * 10, z = s.p.z + s.n.z * d * side + (rnd() - 0.5) * 10;
    if (!isClear(x, z, 5)) continue;
    const k = 0.7 + rnd() * 0.9;
    m.compose(p.set(x, 0, z), q.setFromAxisAngle(UP, rnd() * 6), sc.set(k, k * (0.8 + rnd() * 0.5), k));
    trunks.setMatrixAt(nT++, m);
    if (rnd() < 0.55) { canopies.setMatrixAt(nC, m); canopies.setColorAt(nC++, col.setHSL(0.2 + rnd() * 0.1, 0.5, 0.2 + rnd() * 0.12)); }
    else { cones.setMatrixAt(nK, m); cones.setColorAt(nK++, col.setHSL(0.3 + rnd() * 0.05, 0.4, 0.15 + rnd() * 0.08)); }
  }
  trunks.count = nT; canopies.count = nC; cones.count = nK;
  trunks.castShadow = canopies.castShadow = cones.castShadow = quality > 1;
  scene.add(trunks, canopies, cones);

  // --- glass towers reflecting the HDRI, with lit windows
  const winTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const c = cv.getContext('2d')!;
    c.fillStyle = '#000'; c.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 8; x++) if (Math.random() < 0.4) {
      c.fillStyle = Math.random() < 0.75 ? '#ffd27a' : '#9fe8ff'; c.fillRect(x * 8 + 1, y * 8 + 2, 6, 5);
    }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const bG = new THREE.BoxGeometry(1, 1, 1); bG.translate(0, 0.5, 0);
  const bMat = new THREE.MeshStandardMaterial({ color: 0x8a96aa, roughness: 0.12, metalness: 0.9, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: def.windows, envMapIntensity: 1.2 });
  const bCount = Math.round([40, 90, 140][quality] * (def.night ? 1.6 : 1));
  const blds = new THREE.InstancedMesh(bG, bMat, bCount);
  for (let i = 0; i < bCount; i++) {
    const ang = rnd() * Math.PI * 2, r = (def.night ? 480 : 700) + rnd() * 450;
    const w = 20 + rnd() * 40, h = 30 + rnd() * 170;
    m.compose(p.set(Math.cos(ang) * r + 200, 0, Math.sin(ang) * r), q.setFromAxisAngle(UP, rnd() * 3), sc.set(w, h, 20 + rnd() * 40));
    blds.setMatrixAt(i, m); blds.setColorAt(i, col.setHSL(0.58 + rnd() * 0.06, 0.15, 0.45 + rnd() * 0.3));
  }
  scene.add(blds);

  // --- street lamps along the circuit (emissive heads feed the bloom pass)
  const lampSpacing = [24, 16, 12][quality];
  const lampCount = Math.floor(N / lampSpacing);
  const poleG = new THREE.CylinderGeometry(0.12, 0.18, 8, 8); poleG.translate(0, 4, 0);
  const headG = new THREE.BoxGeometry(1.6, 0.2, 0.5); headG.translate(0, 8, 0);
  const poles = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0x30343b, metalness: 0.9, roughness: 0.3 }), lampCount);
  const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: def.night ? 0xbfe0ff : 0xffe2a8, emissiveIntensity: def.lamp }), lampCount);
  for (let i = 0; i < lampCount; i++) {
    const s = track.samples[i * lampSpacing];
    const side = i % 2 ? 1 : -1, d = (WALL_OFFSET + 1.5) * side;
    m.compose(p.set(s.p.x + s.n.x * d, 0, s.p.z + s.n.z * d), q.setFromAxisAngle(UP, Math.atan2(s.n.x, s.n.z)), sc.set(1, 1, 1));
    poles.setMatrixAt(i, m); heads.setMatrixAt(i, m);
  }
  poles.castShadow = quality > 1;
  scene.add(poles, heads);

  // --- tire stacks on the outside of the tightest corners
  const tireG = new THREE.TorusGeometry(0.42, 0.2, 8, 14); tireG.rotateX(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const tireMax = 1200; const tires = new THREE.InstancedMesh(tireG, tireMat, tireMax); let nTire = 0;
  for (let i = 0; i < N && nTire < tireMax - 3; i += 3) {
    const s = track.samples[i]; if (Math.abs(s.curvature) < 0.012) continue;
    const side = -Math.sign(s.curvature), d = (WALL_OFFSET + 1.0) * side;
    for (let h = 0; h < 3; h++) {
      m.compose(p.set(s.p.x + s.n.x * d, 0.2 + h * 0.4, s.p.z + s.n.z * d), q.identity(), sc.set(1, 1, 1));
      tires.setMatrixAt(nTire, m); tires.setColorAt(nTire++, col.set(h === 1 && (i / 3) % 2 ? 0xd61f2c : 0x161616));
    }
  }
  tires.count = nTire; tires.castShadow = quality > 0; scene.add(tires);

  // --- sponsor billboards with emissive panels along the straights
  const boardTexts = ['NEON APEX', 'TURBO-X FUEL', 'VELOCITY TYRES', 'APEX ENERGY', 'GRID 26'];
  const boardMats = boardTexts.map(t => new THREE.MeshStandardMaterial({ map: textTexture(t), emissiveMap: textTexture(t), emissive: 0xffffff, emissiveIntensity: 1.2 }));
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.7, roughness: 0.35 });
  for (let i = 0, b = 0; i < N; i += 37) {
    const s = track.samples[i]; if (Math.abs(s.curvature) > 0.004) continue;
    const side = b % 2 ? 1 : -1, d = (WALL_OFFSET + 5) * side;
    const g = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.6), boardMats[b++ % boardMats.length]); panel.position.y = 3.2; g.add(panel);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(14.4, 2, 0.3), frameMat); frame.position.set(0, 3.2, -0.2); g.add(frame);
    for (const x of [-6, 6]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.25, 2.4, 0.25), frameMat); leg.position.set(x, 1.2, -0.2); g.add(leg); }
    g.position.set(s.p.x + s.n.x * d, 0, s.p.z + s.n.z * d);
    g.rotation.y = Math.atan2(-s.n.x * side, -s.n.z * side);
    g.traverse(o => { o.castShadow = quality > 1; });
    scene.add(g);
  }

  // --- grandstand near start/finish
  const s0 = track.samples[Math.floor(N * 0.985)];
  const stand = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({ color: 0x8b93a5, roughness: 0.8 });
  for (let r = 0; r < 6; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 2.2), standMat);
    step.position.set(0, 0.5 + r * 1.1, r * 2.2); step.castShadow = step.receiveShadow = quality > 0; stand.add(step);
  }
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.9, 0.4), new THREE.MeshStandardMaterial({ roughness: 1 }), 300);
  for (let i = 0; i < 300; i++) {
    const r = i % 6; m.compose(p.set(-29 + rnd() * 58, 1.45 + r * 1.1, r * 2.2), q.identity(), sc.set(1, 1, 1));
    crowd.setMatrixAt(i, m); crowd.setColorAt(i, col.setHSL(rnd(), 0.6, 0.5));
  }
  stand.add(crowd);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(62, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x1b2230, metalness: 0.6, roughness: 0.4 }));
  roof.position.set(0, 10, 5.5); roof.castShadow = quality > 0; stand.add(roof);
  const dside = -(WALL_OFFSET + 4);
  stand.position.set(s0.p.x + s0.n.x * dside, 0, s0.p.z + s0.n.z * dside);
  stand.rotation.y = Math.atan2(-s0.n.x, -s0.n.z);
  scene.add(stand);

  return { dirLight: dir, sunDir: sunLight };
  }
}

export function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
