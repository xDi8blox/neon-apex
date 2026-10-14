import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Track, WALL_OFFSET } from './track';

/** Sky, lighting, ground and instanced scenery (trees, buildings, lamps, grandstand). */
export function buildEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer, track: Track, quality: number) {
  // --- sky (physically based Preetham sky) + PMREM environment from it
  const sky = new Sky(); sky.scale.setScalar(10000); scene.add(sky);
  const u = sky.material.uniforms;
  u['turbidity'].value = 4; u['rayleigh'].value = 1.6; u['mieCoefficient'].value = 0.0025; u['mieDirectionalG'].value = 0.78;
  const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(80), THREE.MathUtils.degToRad(115));
  u['sunPosition'].value.copy(sun);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000);
  sky2.material.uniforms['sunPosition'].value.copy(sun);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) sky2.material.uniforms[k].value = u[k].value;
  envScene.add(sky2);
  scene.environment = pmrem.fromScene(envScene).texture;
  scene.environmentIntensity = 0.55;
  scene.fog = new THREE.Fog(0xc9a58a, 400, 1800);

  // --- lights
  scene.add(new THREE.HemisphereLight(0xffd7b0, 0x2a3b22, 0.5));
  const dir = new THREE.DirectionalLight(0xffc690, 2.6);
  dir.position.copy(sun).multiplyScalar(300);
  if (quality > 0) {
    dir.castShadow = true;
    const s = quality > 1 ? 2048 : 1024;
    dir.shadow.mapSize.set(s, s);
    const c = dir.shadow.camera; c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 10; c.far = 800;
    dir.shadow.bias = -0.0004; dir.shadow.normalBias = 0.04;
  }
  scene.add(dir); scene.add(dir.target);

  // --- ground
  const grassTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d')!;
    c.fillStyle = '#3d5a2a'; c.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6000; i++) { c.fillStyle = `hsl(${85 + Math.random() * 25},${35 + Math.random() * 20}%,${18 + Math.random() * 14}%)`; c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(300, 300); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; scene.add(ground);

  const rnd = mulberry(1337);
  const N = track.N;
  const isClear = (x: number, z: number, margin: number) => {
    const i = track.nearest(new THREE.Vector3(x, 0, z));
    const s = track.samples[i].p; return Math.hypot(s.x - x, s.z - z) > WALL_OFFSET + margin;
  };

  // --- trees (instanced trunk + 2 foliage cones)
  const treeCount = [250, 600, 1100][quality];
  const trunkG = new THREE.CylinderGeometry(0.25, 0.4, 3, 6); trunkG.translate(0, 1.5, 0);
  const leafG = new THREE.ConeGeometry(2.4, 6, 8); leafG.translate(0, 5.5, 0);
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x4a3426, roughness: 1 }), treeCount);
  const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.9 }), treeCount);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const col = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < treeCount && guard++ < treeCount * 20) {
    const s = track.samples[Math.floor(rnd() * N)];
    const side = rnd() < 0.5 ? -1 : 1, d = WALL_OFFSET + 6 + rnd() * 90;
    const x = s.p.x + s.n.x * d * side + (rnd() - 0.5) * 10, z = s.p.z + s.n.z * d * side + (rnd() - 0.5) * 10;
    if (!isClear(x, z, 4)) continue;
    const k = 0.7 + rnd() * 0.9;
    m.compose(p.set(x, 0, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6), sc.set(k, k * (0.8 + rnd() * 0.5), k));
    trunks.setMatrixAt(placed, m); leaves.setMatrixAt(placed, m);
    leaves.setColorAt(placed, col.setHSL(0.26 + rnd() * 0.08, 0.45, 0.2 + rnd() * 0.12));
    placed++;
  }
  trunks.count = leaves.count = placed;
  trunks.castShadow = leaves.castShadow = quality > 1;
  scene.add(trunks, leaves);

  // --- buildings (city skyline ring with emissive windows)
  const winTex = (() => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128; const c = cv.getContext('2d')!;
    c.fillStyle = '#000'; c.fillRect(0, 0, 64, 128);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) if (Math.random() < 0.45) {
      c.fillStyle = Math.random() < 0.7 ? '#ffd27a' : '#9fe8ff'; c.fillRect(x * 8 + 2, y * 8 + 2, 4, 5);
    }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const bG = new THREE.BoxGeometry(1, 1, 1); bG.translate(0, 0.5, 0);
  const bMat = new THREE.MeshStandardMaterial({ color: 0x5a6273, roughness: 0.6, metalness: 0.3, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 1.4 });
  const bCount = [40, 90, 140][quality];
  const blds = new THREE.InstancedMesh(bG, bMat, bCount);
  for (let i = 0; i < bCount; i++) {
    const ang = rnd() * Math.PI * 2, r = 650 + rnd() * 400;
    const w = 20 + rnd() * 40, h = 30 + rnd() * 140;
    m.compose(p.set(Math.cos(ang) * r + 200, 0, Math.sin(ang) * r), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 3), sc.set(w, h, 20 + rnd() * 40));
    blds.setMatrixAt(i, m);
    blds.setColorAt(i, col.setHSL(0.6, 0.1, 0.25 + rnd() * 0.25));
  }
  scene.add(blds);

  // --- street lamps along the circuit (emissive heads feed the bloom pass)
  const lampSpacing = [24, 16, 12][quality];
  const lampCount = Math.floor(N / lampSpacing);
  const poleG = new THREE.CylinderGeometry(0.12, 0.18, 8, 6); poleG.translate(0, 4, 0);
  const headG = new THREE.BoxGeometry(1.6, 0.2, 0.5); headG.translate(0, 8, 0);
  const poles = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0x30343b, metalness: 0.8, roughness: 0.4 }), lampCount);
  const heads = new THREE.InstancedMesh(headG, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2a8, emissiveIntensity: 6 }), lampCount);
  for (let i = 0; i < lampCount; i++) {
    const s = track.samples[i * lampSpacing];
    const side = i % 2 ? 1 : -1, d = (WALL_OFFSET + 1.5) * side;
    m.compose(p.set(s.p.x + s.n.x * d, 0, s.p.z + s.n.z * d), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.atan2(s.n.x, s.n.z)), sc.set(1, 1, 1));
    poles.setMatrixAt(i, m); heads.setMatrixAt(i, m);
  }
  poles.castShadow = quality > 1;
  scene.add(poles, heads);

  // --- grandstand near start/finish
  const s0 = track.samples[Math.floor(N * 0.985)];
  const stand = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({ color: 0x8b93a5, roughness: 0.8 });
  for (let r = 0; r < 6; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 2.2), standMat);
    step.position.set(0, 0.5 + r * 1.1, r * 2.2); step.castShadow = step.receiveShadow = quality > 0; stand.add(step);
  }
  const crowdMat = new THREE.MeshStandardMaterial({ vertexColors: false, color: 0xffffff, roughness: 1 });
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.9, 0.4), crowdMat, 300);
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

  return { dirLight: dir };
}

export function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
