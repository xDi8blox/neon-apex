import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Track, WALL_OFFSET, textTexture } from './track';
import { horn } from './carmodel';
import type { Assets } from './assets';
import type { TrackDef } from './tracks';

/** Shared animated uniforms for every hell shader (lava, sky, braziers). Updated once per frame by main. */
export const hellUniforms = { uTime: { value: 0 } };

// ---------- noise ----------
function hash2(x: number, y: number) { const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return h - Math.floor(h); }
function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}
function fbm(x: number, y: number, oct = 5) { let s = 0, a = 0.5, f = 1; for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); f *= 2.03; a *= 0.5; } return s; }
const GLSL_NOISE = `
  float hh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(hh(i),hh(i+vec2(1,0)),u.x), mix(hh(i+vec2(0,1)),hh(i+vec2(1,1)),u.x), u.y); }
  float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<OCT;i++){ s+=a*vn(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }`;

// ---------- sky ----------
function skyMaterial(def: TrackDef, oct: number, env = false) {
  const k = def.sky;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: true,
    defines: { OCT: oct },
    uniforms: {
      uTime: hellUniforms.uTime, uTop: { value: new THREE.Color(k.top) }, uMid: { value: new THREE.Color(k.mid) }, uHor: { value: new THREE.Color(k.horizon) },
      uSun: { value: new THREE.Vector3(...k.sun).normalize() }, uSunCol: { value: new THREE.Color(k.sunColor) }, uSunSize: { value: env ? 0 : k.sunSize },
      uClouds: { value: k.clouds }, uStars: { value: k.stars },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uTop, uMid, uHor, uSun, uSunCol; uniform float uSunSize, uClouds, uStars; varying vec3 vDir;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir); float y = d.y;
        vec3 col = mix(uHor, uMid, smoothstep(-0.02, 0.18, y)); col = mix(col, uTop, smoothstep(0.18, 0.75, y));
        col = mix(col, uHor * 0.35, smoothstep(0.0, -0.25, y));
        float sd = dot(d, uSun);
        if (uSunSize > 0.0) { col += uSunCol * (smoothstep(1.0 - uSunSize * 0.02, 1.0 - uSunSize * 0.015, sd) * 6.0 + pow(max(sd, 0.0), 24.0) * 0.6 + pow(max(sd, 0.0), 4.0) * 0.1); }
        // smoke/ash clouds, lit from below by the fires
        vec2 cp = d.xz / max(0.08, y + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
        float c = fbm(cp) * 0.7 + fbm(cp * 3.1 - uTime * 0.02) * 0.3;
        float cov = smoothstep(0.45 - uClouds * 0.25, 0.85, c) * smoothstep(-0.05, 0.12, y);
        vec3 cloud = mix(uHor * 0.7, uMid * 0.8 + uTop * 0.3, smoothstep(0.0, 0.4, y)) * (0.45 + 0.6 * c);
        col = mix(col, cloud, cov * 0.85);
        if (uStars > 0.0) { vec2 sp = d.xz / (abs(y) + 0.3) * 160.0; float s = step(0.996, hh(floor(sp))) * smoothstep(0.1, 0.4, y) * (1.0 - cov); col += vec3(1.0, 0.7, 0.6) * s * uStars * 1.5; }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------- lava ----------
function lavaMaterial(color: number, oct: number) {
  return new THREE.ShaderMaterial({
    fog: true, defines: { OCT: oct },
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uCol: { value: new THREE.Color(color) } }]),
    vertexShader: `varying vec2 vW;
      #include <fog_pars_vertex>
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform vec3 uCol; varying vec2 vW; ${GLSL_NOISE}

      #include <fog_pars_fragment>
      void main(){
        vec2 p = vW * 0.018; float t = uTime * 0.05;
        vec2 q = vec2(fbm(p + vec2(t, 0.3 * t)), fbm(p + vec2(4.1, 1.7) - t * 0.7));
        float n = fbm(p * 1.6 + q * 1.8 + vec2(t * 0.5, 0.0));
        float crust = smoothstep(0.42, 0.62, n);
        float veins = 1.0 - smoothstep(0.0, 0.06, abs(n - 0.5));
        vec3 hot = mix(uCol * 2.6, vec3(3.2, 2.2, 0.8), smoothstep(0.25, 0.0, n) );
        vec3 col = mix(hot, vec3(0.05, 0.015, 0.01), crust) + uCol * veins * 2.2 * crust;
        col *= 0.85 + 0.15 * sin(uTime * 1.3 + vW.x * 0.02 + vW.y * 0.015);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  });
}

// ---------- textures ----------
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function flameTexture() {
  return canvasTex(64, 128, c => {
    const g = c.createRadialGradient(32, 100, 2, 32, 80, 64);
    g.addColorStop(0, 'rgba(255,240,180,1)'); g.addColorStop(0.25, 'rgba(255,150,40,0.9)'); g.addColorStop(0.6, 'rgba(200,30,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.moveTo(32, 0); c.bezierCurveTo(60, 50, 64, 90, 48, 124); c.lineTo(16, 124); c.bezierCurveTo(0, 90, 4, 50, 32, 0); c.fill();
  });
}
function glowTexture() {
  return canvasTex(64, 64, c => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
}
function flareTex(kind: 'glow' | 'ring' | 'streak') {
  const w = kind === 'streak' ? 512 : 128, h = kind === 'streak' ? 32 : 128;
  return canvasTex(w, h, c => {
    if (kind === 'streak') { const g = c.createLinearGradient(0, 0, w, 0); g.addColorStop(0, 'rgba(255,90,30,0)'); g.addColorStop(0.5, 'rgba(255,200,150,1)'); g.addColorStop(1, 'rgba(255,90,30,0)'); c.fillStyle = g; c.fillRect(0, h / 2 - 2, w, 4); return; }
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    if (kind === 'glow') { g.addColorStop(0, 'rgba(255,240,200,1)'); g.addColorStop(0.2, 'rgba(255,140,60,.8)'); g.addColorStop(1, 'rgba(255,40,0,0)'); }
    else { g.addColorStop(0.6, 'rgba(255,90,40,0)'); g.addColorStop(0.8, 'rgba(255,90,40,.35)'); g.addColorStop(1, 'rgba(255,90,40,0)'); }
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  });
}
function windowTexture() {
  return canvasTex(64, 256, c => {
    c.fillStyle = '#000'; c.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 3; x++) if (Math.random() < 0.55) {
      c.fillStyle = Math.random() < 0.7 ? '#ff3a10' : '#ffb02e'; const X = 6 + x * 20, Y = 12 + y * 31;
      c.beginPath(); c.moveTo(X, Y + 22); c.lineTo(X, Y + 7); c.quadraticCurveTo(X + 6, Y - 2, X + 12, Y + 7); c.lineTo(X + 12, Y + 22); c.fill();
    }
  });
}

/** Simple low-poly skull, merged (used for ornaments and piles). */
function skullGeometry(detail: number) {
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { g.scale(sx, sy, sz); g.translate(x, y, z); parts.push(g.index ? g.toNonIndexed() : g); };
  add(new THREE.SphereGeometry(0.5, 8 + detail * 4, 6 + detail * 2), 0, 0.55, 0, 1, 0.88, 1.05);
  add(new THREE.BoxGeometry(0.58, 0.28, 0.5), 0, 0.18, -0.12);
  for (const g of parts) for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
  const m = mergeGeometries(parts)!; m.computeVertexNormals(); return m;
}
function deadTreeGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const t = new THREE.CylinderGeometry(0.12, 0.42, 6, 6); t.translate(0, 3, 0); parts.push(t.toNonIndexed());
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.03, 0.14, 2.6, 5); b.translate(0, 1.3, 0);
    b.rotateZ(0.7 + i * 0.15); b.rotateY(i * 1.7); b.translate(0, 2.8 + i * 0.7, 0); parts.push(b.toNonIndexed());
  }
  for (const g of parts) for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
  return mergeGeometries(parts)!;
}

export interface Environment { dirLight: THREE.DirectionalLight; sunDir: THREE.Vector3; update(dt: number, time: number, cam: THREE.Vector3): void }

/** Hellscape: procedural sky + image lighting, obsidian terrain over lava, braziers, bones, spires, volcanoes. */
export function buildEnvironment(scene: THREE.Scene, root: THREE.Object3D, renderer: THREE.WebGLRenderer, track: Track, quality: number,
  _assets: Assets, def: TrackDef): Environment {
  const oct = [3, 4, 5][quality];
  // --- sky (also baked into the PMREM environment so cars and obsidian reflect the inferno)
  const skyGeo = new THREE.SphereGeometry(2800, 48, 24);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(skyGeo, skyMaterial(def, 3, true)); envScene.add(envSky);
  const glowSpots = new THREE.MeshBasicMaterial({ color: new THREE.Color(def.lavaColor).multiplyScalar(4), side: THREE.DoubleSide });
  const lavaFloor = new THREE.Mesh(new THREE.CircleGeometry(2500, 16).rotateX(-Math.PI / 2), glowSpots); lavaFloor.position.y = -60; lavaFloor.scale.setScalar(def.lava > 0 ? 1 : 0.6); envScene.add(lavaFloor);
  const pmrem = new THREE.PMREMGenerator(renderer);
  (scene.environment as THREE.Texture | null)?.dispose();
  scene.environment = pmrem.fromScene(envScene, 0.02, 1, 4000).texture;
  pmrem.dispose(); (envSky.material as THREE.Material).dispose(); glowSpots.dispose(); lavaFloor.geometry.dispose();
  scene.background = new THREE.Color(def.fog);
  scene.backgroundIntensity = 1;
  scene.environmentIntensity = def.envIntensity;
  scene.fog = new THREE.Fog(def.fog, def.fogNear, def.fogFar);

  const R = root;
  const sky = new THREE.Mesh(skyGeo, skyMaterial(def, oct)); sky.frustumCulled = false; sky.renderOrder = -10; R.add(sky);

  // --- sun (red giant / blood moon), elevation clamped so shadows stay readable
  const sun = new THREE.Vector3(...def.sky.sun).normalize();
  const sunLight = sun.clone(); sunLight.y = Math.max(sunLight.y, 0.45); sunLight.normalize();
  R.add(new THREE.HemisphereLight(def.hemiSky, def.hemiGround, def.hemi));
  const dir = new THREE.DirectionalLight(def.sunColor, def.sunIntensity);
  dir.position.copy(sunLight).multiplyScalar(300);
  if (quality > 0) {
    dir.castShadow = true; const s = quality > 1 ? 2048 : 1024; dir.shadow.mapSize.set(s, s);
    const c = dir.shadow.camera; c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 10; c.far = 800;
    dir.shadow.bias = -0.0003; dir.shadow.normalBias = 0.03;
  }
  R.add(dir); R.add(dir.target);
  if (quality > 0 && !def.night && !def.rain) {
    const flare = new Lensflare();
    flare.addElement(new LensflareElement(flareTex('glow'), 520, 0, new THREE.Color(1, 0.6, 0.4)));
    flare.addElement(new LensflareElement(flareTex('streak'), 1200, 0, new THREE.Color(1, 0.5, 0.3)));
    flare.addElement(new LensflareElement(flareTex('ring'), 260, 0.9));
    flare.position.copy(sun).multiplyScalar(2600); R.add(flare);
  }

  // --- distance-to-track lookup (spatial hash of centerline samples)
  const CELL = 20, cells = new Map<number, THREE.Vector3[]>();
  const key = (ix: number, iz: number) => ix * 100003 + iz;
  let cx = 0, cz = 0;
  for (const s of track.samples) { const k = key(Math.floor(s.p.x / CELL), Math.floor(s.p.z / CELL)); if (!cells.has(k)) cells.set(k, []); cells.get(k)!.push(s.p); cx += s.p.x; cz += s.p.z; }
  cx /= track.N; cz /= track.N;
  const distToTrack = (x: number, z: number) => {
    const ix = Math.floor(x / CELL), iz = Math.floor(z / CELL); let best = 1e9;
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const l = cells.get(key(ix + a, iz + b)); if (l) for (const p of l) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; } }
    return Math.sqrt(best);
  };
  const LAVA_Y = -1.2;
  const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const heightAt = (x: number, z: number) => {
    const r = Math.hypot(x - cx, z - cz);
    let h = (fbm(x * 0.006, z * 0.006) + fbm(x * 0.03, z * 0.03, 3) * 0.25 + 0.12 - def.lava) * 10 * def.terrain;
    h += sstep(650, 1300, r) * 90 * def.terrain * (0.6 + 0.4 * fbm(x * 0.004 + 5, z * 0.004));
    const dt = distToTrack(x, z) - (WALL_OFFSET + 4);
    if (dt < 60) h = THREE.MathUtils.lerp(-0.25, h, sstep(0, 16, dt));
    return h;
  };

  // --- obsidian terrain (faceted), glowing where it meets the lava
  const segs = [110, 170, 230][quality], SIZE = 3000;
  const tg = new THREE.PlaneGeometry(SIZE, SIZE, segs, segs); tg.rotateX(-Math.PI / 2); tg.translate(cx, 0, cz);
  const tp = tg.getAttribute('position'), heat = new Float32Array(tp.count), colors = new Float32Array(tp.count * 3);
  const rc = new THREE.Color(), rock = new THREE.Color(0x1d1513), ash = new THREE.Color(0x4a403a), scorch = new THREE.Color(0x3a0c04);
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i), h = heightAt(x, z); tp.setY(i, h);
    heat[i] = Math.max(0, Math.min(1, 1 - (h - LAVA_Y) / 2.2));
    rc.copy(rock).lerp(ash, sstep(8, 40, h) * (0.6 + 0.4 * hash2(x, z))).lerp(scorch, heat[i] * 0.8).multiplyScalar(0.75 + hash2(z, x) * 0.5);
    colors.set([rc.r, rc.g, rc.b], i * 3);
  }
  tg.setAttribute('aHeat', new THREE.BufferAttribute(heat, 1)); tg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  tg.computeVertexNormals();
  const lavaRGB = new THREE.Color(def.lavaColor);
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15, flatShading: true, envMapIntensity: 0.9 });
  terrainMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = hellUniforms.uTime; sh.uniforms.uLava = { value: lavaRGB };
    sh.vertexShader = 'attribute float aHeat; varying float vHeat;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;');
    sh.fragmentShader = 'uniform float uTime; uniform vec3 uLava; varying float vHeat;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uLava * pow(vHeat, 2.0) * (2.2 + 0.6 * sin(uTime * 1.7 + vHeat * 8.0));');
  };
  const terrain = new THREE.Mesh(tg, terrainMat); terrain.receiveShadow = quality > 0; R.add(terrain);
  // --- lava sea filling every valley (rivers and lakes appear wherever the rock dips)
  const lava = new THREE.Mesh(new THREE.PlaneGeometry(SIZE + 400, SIZE + 400).rotateX(-Math.PI / 2), lavaMaterial(def.lavaColor, oct));
  (lava.material as THREE.ShaderMaterial).uniforms.uTime = hellUniforms.uTime;
  lava.position.set(cx, LAVA_Y, cz); R.add(lava);

  const rnd = mulberry(666);
  const N = track.N;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
  const UP = THREE.Object3D.DEFAULT_UP;
  const near = (minD: number, maxD: number) => {
    const s = track.samples[Math.floor(rnd() * N)], side = rnd() < 0.5 ? -1 : 1, d = WALL_OFFSET + minD + rnd() * (maxD - minD);
    return [s.p.x + s.n.x * d * side + (rnd() - 0.5) * 8, s.p.z + s.n.z * d * side + (rnd() - 0.5) * 8] as const;
  };
  const bone = new THREE.MeshStandardMaterial({ color: 0xcfbf9e, roughness: 0.75 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2b2522, metalness: 0.85, roughness: 0.45 });

  // --- obsidian shards and cliffs
  const rockCount = [140, 300, 480][quality];
  const rockG = new THREE.DodecahedronGeometry(1, 0);
  { const pa = rockG.getAttribute('position'); for (let i = 0; i < pa.count; i++) pa.setXYZ(i, pa.getX(i) * (0.7 + hash2(i, 1) * 0.6), pa.getY(i) * (0.8 + hash2(i, 2) * 0.8), pa.getZ(i) * (0.7 + hash2(i, 3) * 0.6)); rockG.computeVertexNormals(); }
  const rocks = new THREE.InstancedMesh(rockG, new THREE.MeshStandardMaterial({ color: 0x0c090b, roughness: 0.18, metalness: 0.35, flatShading: true, envMapIntensity: 1.4 }), rockCount);
  let nR = 0;
  for (let g = 0; nR < rockCount && g < rockCount * 10; g++) {
    const [x, z] = near(6, 200); if (distToTrack(x, z) < WALL_OFFSET + 5) continue;
    const big = rnd() < 0.2, k = big ? 4 + rnd() * 7 : 0.8 + rnd() * 3;
    m.compose(p.set(x, heightAt(x, z) - k * 0.35, z), q.setFromEuler(new THREE.Euler(rnd() * 0.4, rnd() * 6, rnd() * 0.4)), sc.set(k, k * (big ? 1.3 + rnd() * 1.4 : 0.6 + rnd() * 0.8), k));
    rocks.setMatrixAt(nR++, m);
  }
  rocks.count = nR; rocks.castShadow = quality > 1; rocks.receiveShadow = quality > 1; R.add(rocks);

  // --- dead, charred trees
  const treeCount = Math.round([70, 160, 280][quality] * def.trees);
  const trees = new THREE.InstancedMesh(deadTreeGeometry(), new THREE.MeshStandardMaterial({ color: 0x120c0a, roughness: 1, flatShading: true }), treeCount);
  let nT = 0;
  for (let g = 0; nT < treeCount && g < treeCount * 10; g++) {
    const [x, z] = near(8, 140); const h = heightAt(x, z); if (h < LAVA_Y + 0.3 || distToTrack(x, z) < WALL_OFFSET + 4) continue;
    const k = 0.8 + rnd() * 1.2; m.compose(p.set(x, h - 0.1, z), q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3)), sc.set(k, k, k));
    trees.setMatrixAt(nT++, m);
  }
  trees.count = nT; trees.castShadow = quality > 1; R.add(trees);

  // --- braziers: iron tripod bowls with living fire and a glow pool on the ground
  const spacing = Math.round([30, 20, 15][quality] / def.braziers);
  const brazCount = Math.floor(N / spacing);
  const poleG = new THREE.CylinderGeometry(0.1, 0.18, 2.6, 6); poleG.translate(0, 1.3, 0);
  const bowlG = new THREE.CylinderGeometry(0.75, 0.35, 0.5, 10, 1, true); bowlG.translate(0, 2.75, 0);
  const coalG = new THREE.CircleGeometry(0.7, 10).rotateX(-Math.PI / 2); coalG.translate(0, 2.85, 0);
  const flameG = (() => { const a = new THREE.PlaneGeometry(1.5, 2.8); a.translate(0, 4.2, 0); const b = a.clone().rotateY(Math.PI / 2); return mergeGeometries([a, b])!; })();
  const poolG = new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2); poolG.translate(0, 0.06, 0);
  const poles = new THREE.InstancedMesh(poleG, iron, brazCount), bowls = new THREE.InstancedMesh(bowlG, iron, brazCount);
  const coals = new THREE.InstancedMesh(coalG, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff5a10).multiplyScalar(3), toneMapped: false }), brazCount);
  const fireMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    uniforms: { uTime: hellUniforms.uTime, uMap: { value: flameTexture() } },
    vertexShader: `varying vec2 vUv; varying float vPh; uniform float uTime;
      void main(){ vUv = uv; vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
        vPh = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.11; p = instanceMatrix * p;
        #endif
        float sway = sin(uTime * 7.0 + vPh * 3.0 + uv.y * 3.0) * 0.25 * uv.y; p.x += sway; p.y += sin(uTime * 11.0 + vPh) * 0.15 * uv.y;
        gl_Position = projectionMatrix * modelViewMatrix * p; }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uTime; varying vec2 vUv; varying float vPh;
      void main(){ vec2 uv = vUv; uv.x += sin(uv.y * 9.0 - uTime * 9.0 + vPh) * 0.05 * uv.y;
        vec4 c = texture2D(uMap, uv); float fl = 0.8 + 0.2 * sin(uTime * 19.0 + vPh * 5.0);
        gl_FragColor = vec4(c.rgb * vec3(2.4, 1.4, 0.7) * fl * c.a, c.a); }`,
  });
  const fires = new THREE.InstancedMesh(flameG, fireMat, brazCount);
  const pools = new THREE.InstancedMesh(poolG, new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xff4a10, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), brazCount);
  for (let i = 0; i < brazCount; i++) {
    const s = track.samples[i * spacing], side = i % 2 ? 1 : -1, d = (WALL_OFFSET + 1.8) * side;
    m.compose(p.set(s.p.x + s.n.x * d, 0, s.p.z + s.n.z * d), q.setFromAxisAngle(UP, rnd() * 6), sc.set(1, 1, 1));
    poles.setMatrixAt(i, m); bowls.setMatrixAt(i, m); coals.setMatrixAt(i, m); fires.setMatrixAt(i, m); pools.setMatrixAt(i, m);
  }
  poles.castShadow = bowls.castShadow = quality > 1; fires.frustumCulled = false; pools.renderOrder = 1;
  R.add(poles, bowls, coals, fires, pools);

  // --- skull piles on the outside of the tightest corners
  const skullG = skullGeometry(quality > 1 ? 1 : 0);
  const skullMax = [250, 500, 800][quality]; const skulls = new THREE.InstancedMesh(skullG, bone, skullMax); let nS = 0;
  for (let i = 0; i < N && nS < skullMax - 6; i += 5) {
    const s = track.samples[i]; if (Math.abs(s.curvature) < 0.012) continue;
    const side = -Math.sign(s.curvature), d = (WALL_OFFSET + 1.4) * side;
    for (let k = 0; k < 6; k++) {
      const row = k < 3 ? 0 : k < 5 ? 1 : 2, off = (k < 3 ? k - 1 : k < 5 ? k - 3.5 : 0) * 0.9;
      m.compose(p.set(s.p.x + s.n.x * (d + side * 0.4) + s.t.x * off, row * 0.72, s.p.z + s.n.z * (d + side * 0.4) + s.t.z * off),
        q.setFromAxisAngle(UP, Math.atan2(-s.n.x * side, -s.n.z * side) + (rnd() - 0.5) * 0.6), sc.setScalar(0.85 + rnd() * 0.3));
      skulls.setMatrixAt(nS++, m);
    }
  }
  skulls.count = nS; skulls.castShadow = quality > 0; R.add(skulls);

  // --- giant horn gates arching over the straights
  const gateSegs = quality > 0 ? 18 : 10;
  const hornL = horn([new THREE.Vector3(-WALL_OFFSET - 2, -1, 0), new THREE.Vector3(-WALL_OFFSET + 1, 12, 1), new THREE.Vector3(-6, 20, 2), new THREE.Vector3(1.5, 17, 1.5)], 2.2, gateSegs, 10, 1.1);
  let gates = 0;
  for (let i = Math.floor(N * 0.12); i < N && gates < 3; i += 9) {
    const s = track.samples[i]; if (Math.abs(s.curvature) > 0.002) continue;
    let ok = true; for (let k = -12; k <= 12; k += 4) if (Math.abs(track.samples[(i + k + N) % N].curvature) > 0.003) ok = false;
    if (!ok) continue;
    const g = new THREE.Group();
    const hr = new THREE.Mesh(hornL, bone); hr.scale.x = -1; g.add(new THREE.Mesh(hornL, bone), hr);
    const sk = new THREE.Mesh(skullG, bone); sk.scale.setScalar(3.2); sk.position.set(0, 16.5, -0.5); g.add(sk);
    const eyes = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3a0a).multiplyScalar(4), toneMapped: false });
    for (const x of [-0.6, 0.6]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), eyes); e.position.set(x, 18.3, -1.9); g.add(e); }
    g.position.copy(s.p); g.rotation.y = Math.atan2(s.n.x, s.n.z) + Math.PI / 2;
    g.traverse(o => { o.castShadow = quality > 0; }); R.add(g);
    gates++; i += Math.floor(N * 0.25);
  }

  // --- Bone Cathedral: a nave of giant ribs vaulting over the longest straight
  if (def.spires > 1) {
    let best = 0, bestLen = 0, run = 0;
    for (let i = 0; i < N * 2; i++) { if (Math.abs(track.samples[i % N].curvature) < 0.0025) { run++; if (run > bestLen) { bestLen = run; best = i - run + 1; } } else run = 0; }
    const ribG = new THREE.TorusGeometry(WALL_OFFSET + 3, 0.7, 6, quality > 0 ? 24 : 14, Math.PI);
    const ribs = Math.min(18, Math.floor(bestLen / 6));
    const ribMesh = new THREE.InstancedMesh(ribG, bone, ribs);
    for (let k = 0; k < ribs; k++) {
      const s = track.samples[(best + 3 + k * 6) % N];
      m.compose(p.set(s.p.x, -2, s.p.z), q.setFromAxisAngle(UP, Math.atan2(s.n.x, s.n.z) + Math.PI / 2), sc.set(1, 1.35, 1)); ribMesh.setMatrixAt(k, m);
    }
    ribMesh.castShadow = quality > 0; R.add(ribMesh);
  }

  // --- gothic spires / bone cathedrals on the horizon with burning windows
  const spireCount = Math.round([24, 50, 80][quality] * def.spires);
  if (spireCount > 0) {
    const winTex = windowTexture(); winTex.wrapS = winTex.wrapT = THREE.RepeatWrapping;
    const baseG = new THREE.BoxGeometry(1, 1, 1); baseG.translate(0, 0.5, 0);
    const capG = new THREE.ConeGeometry(0.72, 1, 4); capG.rotateY(Math.PI / 4); capG.translate(0, 0.5, 0);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x2a2220, roughness: 0.8, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: def.night ? 2.2 : 1.2 });
    const bases = new THREE.InstancedMesh(baseG, towerMat, spireCount), caps = new THREE.InstancedMesh(capG, new THREE.MeshStandardMaterial({ color: 0x15100f, roughness: 0.6, metalness: 0.4 }), spireCount);
    for (let i = 0; i < spireCount; i++) {
      const a = rnd() * Math.PI * 2, r = (def.spires > 1 ? 330 : 520) + rnd() * 380, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const w = 10 + rnd() * 18, h = 40 + rnd() * 120, y = Math.max(LAVA_Y, heightAt(x, z)) - 2;
      m.compose(p.set(x, y, z), q.setFromAxisAngle(UP, rnd() * 3), sc.set(w, h, w)); bases.setMatrixAt(i, m);
      m.compose(p.set(x, y + h, z), q, sc.set(w, w * (2.5 + rnd() * 2.5), w)); caps.setMatrixAt(i, m);
      bases.setColorAt(i, col.setHSL(0.05, 0.15, 0.5 + rnd() * 0.4));
    }
    R.add(bases, caps);
  }

  // --- banners along the straights
  const boardTexts = ['HELLDRIVE', 'ABANDON ALL HOPE', 'SOUL BURN', 'NO RETURN', 'CIRCLE IX'];
  const boardMats = boardTexts.map(t => new THREE.MeshStandardMaterial({ map: textTexture(t), emissiveMap: textTexture(t), emissive: 0xffffff, emissiveIntensity: 1.3 }));
  for (let i = 0, b = 0; i < N; i += 41) {
    const s = track.samples[i]; if (Math.abs(s.curvature) > 0.004) continue;
    const side = b % 2 ? 1 : -1, d = (WALL_OFFSET + 5) * side;
    const g = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.6), boardMats[b++ % boardMats.length]); panel.position.y = 3.6; g.add(panel);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(14.4, 2, 0.3), iron); frame.position.set(0, 3.6, -0.2); g.add(frame);
    for (const x of [-7.4, 7.4]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 5, 6), iron); leg.position.set(x, 2.5, -0.2); g.add(leg);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.2, 6), iron); tip.position.set(x, 5.6, -0.2); g.add(tip);
    }
    g.position.set(s.p.x + s.n.x * d, 0, s.p.z + s.n.z * d); g.rotation.y = Math.atan2(-s.n.x * side, -s.n.z * side);
    g.traverse(o => { o.castShadow = quality > 1; }); R.add(g);
  }

  // --- the stands of the damned near start/finish
  const s0 = track.samples[Math.floor(N * 0.985)];
  const stand = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({ color: 0x1a1412, roughness: 0.4, metalness: 0.3, flatShading: true });
  for (let r = 0; r < 6; r++) { const step = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 2.2), standMat); step.position.set(0, 0.5 + r * 1.1, r * 2.2); step.castShadow = step.receiveShadow = quality > 0; stand.add(step); }
  const crowd = new THREE.InstancedMesh(skullG, new THREE.MeshStandardMaterial({ roughness: 0.8 }), 240);
  for (let i = 0; i < 240; i++) { const r = i % 6; m.compose(p.set(-29 + rnd() * 58, 1.0 + r * 1.1, r * 2.2), q.setFromAxisAngle(UP, Math.PI + (rnd() - 0.5) * 0.8), sc.setScalar(0.7)); crowd.setMatrixAt(i, m); crowd.setColorAt(i, col.setHSL(0.08, 0.25, 0.55 + rnd() * 0.3)); }
  stand.add(crowd);
  for (const x of [-30, 30]) { const sp = new THREE.Mesh(new THREE.ConeGeometry(1.2, 16, 4), standMat); sp.position.set(x, 8, 6); stand.add(sp); }
  const dside = -(WALL_OFFSET + 4);
  stand.position.set(s0.p.x + s0.n.x * dside, 0, s0.p.z + s0.n.z * dside); stand.rotation.y = Math.atan2(-s0.n.x, -s0.n.z); R.add(stand);

  // --- volcanoes on the horizon, erupting lava bombs and smoke
  const volcanoes: { top: THREE.Vector3; next: number }[] = [];
  const bombs = new BombSystem(R, [150, 300, 500][quality], quality);
  for (let i = 0; i < def.volcanoes; i++) {
    const a = 0.6 + i * 2.1 + rnd() * 0.6, r = 1150 + rnd() * 250, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const H = 260 + rnd() * 160, Rb = 420 + rnd() * 120;
    const prof = [new THREE.Vector2(Rb, -20), new THREE.Vector2(Rb * 0.55, H * 0.45), new THREE.Vector2(Rb * 0.16, H * 0.97), new THREE.Vector2(Rb * 0.12, H), new THREE.Vector2(Rb * 0.08, H * 0.9)];
    const vg = new THREE.LatheGeometry(prof, 20 + quality * 8);
    { const pa = vg.getAttribute('position'); for (let k = 0; k < pa.count; k++) { const j = 1 + fbm(pa.getX(k) * 0.01, pa.getZ(k) * 0.01, 3) * 0.25; pa.setXYZ(k, pa.getX(k) * j, pa.getY(k), pa.getZ(k) * j); } vg.computeVertexNormals(); }
    const v = new THREE.Mesh(vg, new THREE.MeshStandardMaterial({ color: 0x140e0c, roughness: 0.9, flatShading: true })); v.position.set(x, 0, z); R.add(v);
    const crater = new THREE.Mesh(new THREE.CircleGeometry(Rb * 0.13, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(def.lavaColor).multiplyScalar(5), toneMapped: false, fog: false }));
    crater.position.set(x, H * 0.92, z); R.add(crater);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: def.lavaColor, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.7 }));
    halo.position.set(x, H * 1.05, z); halo.scale.set(Rb * 0.9, Rb * 0.6, 1); R.add(halo);
    volcanoes.push({ top: new THREE.Vector3(x, H * 0.95, z), next: rnd() * 3 });
  }

  // --- falling ash + rising embers that follow the camera
  const ashFall = new AshFall(R, Math.round([500, 900, 1500][quality] * def.ash * (def.rain ? 2.2 : 1)), def.rain ? 1 : 0.25);

  return {
    dirLight: dir, sunDir: sunLight,
    update(dt, time, cam) {
      for (const v of volcanoes) { v.next -= dt; if (v.next <= 0) { v.next = 2.5 + Math.random() * 5; bombs.erupt(v.top, 30 + Math.random() * 40); } }
      bombs.update(dt); ashFall.update(dt, time, cam);
    },
  };
}

/** Volcanic ejecta: additive glowing points thrown from craters with gravity. */
class BombSystem {
  private pos: Float32Array; private vel: Float32Array; private life: Float32Array; private geo = new THREE.BufferGeometry(); private next = 0;
  constructor(parent: THREE.Object3D, private n: number, quality: number) {
    this.pos = new Float32Array(n * 3).fill(-9999); this.vel = new Float32Array(n * 3); this.life = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const pts = new THREE.Points(this.geo, new THREE.PointsMaterial({ color: 0xff7a20, size: quality > 0 ? 9 : 12, map: (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 32; const c = cv.getContext('2d')!; const g = c.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, '#fff'); g.addColorStop(0.4, 'rgba(255,160,60,.8)'); g.addColorStop(1, 'rgba(255,40,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(cv); })(),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false, sizeAttenuation: true }));
    pts.frustumCulled = false; parent.add(pts);
  }
  erupt(at: THREE.Vector3, count: number) {
    for (let k = 0; k < count; k++) {
      const i = this.next; this.next = (this.next + 1) % this.n;
      this.pos.set([at.x + (Math.random() - 0.5) * 20, at.y, at.z + (Math.random() - 0.5) * 20], i * 3);
      const a = Math.random() * Math.PI * 2, s = 15 + Math.random() * 45;
      this.vel.set([Math.cos(a) * s, 60 + Math.random() * 70, Math.sin(a) * s], i * 3); this.life[i] = 1;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 0.18; this.vel[i * 3 + 1] -= 30 * dt;
      for (let k = 0; k < 3; k++) this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -9999;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Ash flakes drifting down (grey) and embers rising (additive), recycled in a box around the camera. */
class AshFall {
  private ash: Float32Array; private emb: Float32Array; private ga = new THREE.BufferGeometry(); private ge = new THREE.BufferGeometry();
  constructor(parent: THREE.Object3D, private n: number, private wind: number) {
    this.ash = new Float32Array(n * 3); const ne = Math.max(40, Math.round(n * 0.3)); this.emb = new Float32Array(ne * 3);
    for (let i = 0; i < n; i++) this.ash.set([(Math.random() - 0.5) * 120, Math.random() * 50, (Math.random() - 0.5) * 120], i * 3);
    for (let i = 0; i < ne; i++) this.emb.set([(Math.random() - 0.5) * 120, Math.random() * 40, (Math.random() - 0.5) * 120], i * 3);
    this.ga.setAttribute('position', new THREE.BufferAttribute(this.ash, 3)); this.ge.setAttribute('position', new THREE.BufferAttribute(this.emb, 3));
    const dot = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 32; const c = cv.getContext('2d')!; const g = c.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(cv); })();
    const pm = (color: number, size: number, alpha: number, additive: boolean) => new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
      uniforms: { uMap: { value: dot }, uCol: { value: new THREE.Color(color) }, uA: { value: alpha }, uScale: { value: innerHeight * 0.6 } },
      vertexShader: `uniform float uScale; varying float vF; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float d = -mv.z; vF = smoothstep(1.5, 5.0, d) * (1.0 - smoothstep(30.0, 55.0, d)); gl_PointSize = clamp(${size.toFixed(2)} * uScale / d, 1.0, 7.0); }`,
      fragmentShader: `uniform sampler2D uMap; uniform vec3 uCol; uniform float uA; varying float vF; void main(){ float a = texture2D(uMap, gl_PointCoord).a * uA * vF; if (a < 0.01) discard; gl_FragColor = vec4(uCol, a); }`,
    });
    const a = new THREE.Points(this.ga, pm(0x5a504a, 0.3, 0.8, false));
    const e = new THREE.Points(this.ge, pm(0xff6a10, 0.2, 1, true));
    a.frustumCulled = e.frustumCulled = false; parent.add(a, e);
  }
  private origin = new THREE.Vector3();
  update(dt: number, time: number, cam: THREE.Vector3) {
    const o = this.origin.copy(cam);
    const wrap = (arr: Float32Array, i: number, half: number, yLo: number, yHi: number) => {
      const k = i * 3;
      if (arr[k] - o.x > half) arr[k] -= half * 2; else if (arr[k] - o.x < -half) arr[k] += half * 2;
      if (arr[k + 2] - o.z > half) arr[k + 2] -= half * 2; else if (arr[k + 2] - o.z < -half) arr[k + 2] += half * 2;
      if (arr[k + 1] < o.y + yLo) arr[k + 1] += yHi - yLo; else if (arr[k + 1] > o.y + yHi) arr[k + 1] -= yHi - yLo;
    };
    const w = this.wind * 14;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3; this.ash[k] += (w + Math.sin(time + i) * 1.2) * dt; this.ash[k + 1] -= (1.6 + (i % 7) * 0.3 + this.wind * 3) * dt; this.ash[k + 2] += (Math.cos(time * 0.7 + i) * 1.2 + w * 0.4) * dt;
      wrap(this.ash, i, 60, -8, 40);
    }
    for (let i = 0; i < this.emb.length / 3; i++) {
      const k = i * 3; this.emb[k] += (Math.sin(time * 2 + i) * 1.5 + w * 0.5) * dt; this.emb[k + 1] += (2 + (i % 5) * 0.6) * dt; this.emb[k + 2] += Math.cos(time * 1.7 + i * 1.3) * 1.5 * dt;
      wrap(this.emb, i, 60, -4, 36);
    }
    (this.ga.attributes.position as THREE.BufferAttribute).needsUpdate = true; (this.ge.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

export function mulberry(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
