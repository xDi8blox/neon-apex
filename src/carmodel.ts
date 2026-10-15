import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Assets } from './assets';
import type { Kit } from './cars';

/**
 * Procedural demon machines. Every car is built from code (no external model): an extruded wedge body,
 * obsidian canopy, horns (tapered tubes), spikes, skull grille, an exposed glowing engine, rune decals,
 * spiked wheels and flame-breathing exhausts. Static parts are merged per material, so a car is ~10 draw calls.
 * Orientation: front is −Z, rear is +Z, ground at y = 0.
 */
export interface CarVisual {
  group: THREE.Group;
  wheels: THREE.Object3D[];          // fl, fr, rl, rr
  brakeMat: THREE.MeshStandardMaterial;
  flames: THREE.Mesh[];
  paint: THREE.MeshPhysicalMaterial;
  glow: THREE.MeshBasicMaterial;     // runes + engine core; brightened during Soul Burn
}

export const flameUniforms = { uTime: { value: 0 } };

type MatKey = 'paint' | 'iron' | 'bone' | 'glass' | 'glow' | 'eye' | 'brake' | 'tire' | 'dark';
interface Shared {
  iron: THREE.MeshStandardMaterial; bone: THREE.MeshStandardMaterial; glass: THREE.MeshPhysicalMaterial; eye: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial; tire: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; flame: THREE.ShaderMaterial;
  shadow: THREE.MeshBasicMaterial; runes: THREE.Texture; glowTex: THREE.Texture;
}
let shared: Shared | null = null;

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Strip of procedural runes (angular strokes in the spirit of Elder Futhark), white on transparent. */
function runeTexture() {
  return canvas(1024, 96, c => {
    let s = 9; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    c.strokeStyle = '#fff'; c.lineWidth = 7; c.lineCap = 'square'; c.shadowColor = '#fff'; c.shadowBlur = 6;
    c.beginPath(); c.moveTo(0, 8); c.lineTo(1024, 8); c.moveTo(0, 88); c.lineTo(1024, 88); c.lineWidth = 3; c.stroke(); c.lineWidth = 7;
    for (let x = 30; x < 1000; x += 62) {
      c.beginPath(); c.moveTo(x, 18); c.lineTo(x, 78); // stave
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const y0 = 20 + r() * 40, dir = r() < 0.5 ? -1 : 1, len = 14 + r() * 16;
        c.moveTo(x, y0); c.lineTo(x + dir * len, y0 + (r() < 0.5 ? 1 : -1) * len * (0.6 + r() * 0.5));
        if (r() < 0.35) { c.moveTo(x + dir * len, y0 + 12); c.lineTo(x, y0 + 26); }
      }
      c.stroke();
    }
  });
}
function radial(inner: string, outer: string, w = 64, h = 128) {
  return canvas(w, h, c => {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, Math.max(w, h) / 2);
    g.addColorStop(0, inner); g.addColorStop(1, outer); c.fillStyle = g; c.fillRect(0, 0, w, h);
  });
}

function getShared(): Shared {
  if (shared) return shared;
  shared = {
    iron: new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.9, roughness: 0.42, envMapIntensity: 1.1 }),
    bone: new THREE.MeshStandardMaterial({ color: 0xd8c9a8, roughness: 0.7, metalness: 0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x030101, metalness: 0.6, roughness: 0.12, clearcoat: 1, emissive: 0x2a0400, emissiveIntensity: 0.8, envMapIntensity: 0.7 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x200000, emissive: 0xff3a0a, emissiveIntensity: 6 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1010, emissiveIntensity: 1.6 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x0e0c0c, roughness: 0.93 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x050303, roughness: 0.9 }),
    // additive animated hellfire (exhaust breath + Soul Burn)
    flame: new THREE.ShaderMaterial({
      uniforms: flameUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; varying vec2 vUv;
        float h(float n){return fract(sin(n)*43758.5453);}
        void main(){ float t=1.0-vUv.y; float flick=0.7+0.3*h(floor(uTime*36.0)+vUv.x*5.0);
          float tongue = 0.5+0.5*sin(vUv.x*25.13+uTime*30.0+vUv.y*12.0);
          vec3 core=vec3(1.9,1.4,0.7)*2.4, mid=vec3(1.9,0.45,0.06)*2.2, outer=vec3(0.7,0.03,0.0)*1.6;
          vec3 col=mix(outer, mid, smoothstep(0.1,0.55,t)); col=mix(col, core, smoothstep(0.65,1.0,t));
          float a=smoothstep(0.0,0.55,t)*flick*(0.65+0.35*tongue); gl_FragColor=vec4(col*a,a); }`,
    }),
    shadow: new THREE.MeshBasicMaterial({ map: radial('rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false, toneMapped: false }),
    runes: runeTexture(),
    glowTex: radial('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
  };
  return shared;
}

// ---------- geometry helpers ----------
/** Side-profile wedge: points are (z, y) pairs, extruded across `width`, centered on x = 0. */
function profile(pts: [number, number][], width: number, bevel: number, curveSeg: number): THREE.BufferGeometry {
  const s = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: curveSeg, steps: 1 });
  g.rotateY(Math.PI / 2); g.translate(-(width - bevel * 2) / 2, 0, 0);
  return g;
}
/** Tapered, curved horn: a tube along a Catmull-Rom path whose radius shrinks to a point. */
function horn(path: THREE.Vector3[], r0: number, seg: number, radial = 8, power = 1.2): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(path);
  const g = new THREE.TubeGeometry(curve, seg, r0, radial, false);
  const pos = g.getAttribute('position'), c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= seg; i++) {
    const t = i / seg; curve.getPointAt(t, c); const k = Math.pow(1 - t, power) * 0.96 + 0.04;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j; v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(k).add(c); pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals(); return g;
}
const mirror = (p: THREE.Vector3[]) => p.map(v => new THREE.Vector3(-v.x, v.y, v.z));
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

class Builder {
  parts = new Map<MatKey, THREE.BufferGeometry[]>();
  merged: Map<MatKey, THREE.BufferGeometry> | null = null;
  add(key: MatKey, g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(sx, sy, sz));
    let gg = g.index ? g.toNonIndexed() : g.clone(); gg.applyMatrix4(m);
    for (const a of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv'].includes(a)) gg.deleteAttribute(a);
    if (!gg.getAttribute('uv')) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.getAttribute('position').count * 2), 2));
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key)!.push(gg);
    return gg;
  }
  spike(key: MatKey, r: number, len: number, at: THREE.Vector3, dir: THREE.Vector3, sides = 6) {
    const g = new THREE.ConeGeometry(r, len, sides); g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.clone().normalize()));
    this.add(key, g, at.x, at.y, at.z);
  }
  skull(at: THREE.Vector3, s: number, detail: number) {
    const cran = new THREE.SphereGeometry(0.3 * s, 10 + detail * 6, 8 + detail * 4); cran.scale(1, 0.85, 0.95);
    this.add('bone', cran, at.x, at.y + 0.06 * s, at.z);
    this.add('bone', new THREE.BoxGeometry(0.36 * s, 0.16 * s, 0.28 * s), at.x, at.y - 0.2 * s, at.z - 0.04 * s); // jaw
    for (const sx of [-1, 1]) {
      this.add('dark', new THREE.SphereGeometry(0.085 * s, 8, 6), at.x + sx * 0.11 * s, at.y + 0.02 * s, at.z - 0.24 * s, 0, 0, 0, 1, 0.8, 0.6);
      this.add('eye', new THREE.SphereGeometry(0.035 * s, 6, 4), at.x + sx * 0.11 * s, at.y + 0.02 * s, at.z - 0.28 * s);
    }
    this.add('dark', new THREE.ConeGeometry(0.04 * s, 0.08 * s, 3), at.x, at.y - 0.08 * s, at.z - 0.27 * s, Math.PI, 0, 0); // nose cavity
    for (let i = -2; i <= 2; i++) this.add('bone', new THREE.BoxGeometry(0.045 * s, 0.07 * s, 0.03 * s), at.x + i * 0.055 * s, at.y - 0.17 * s, at.z - 0.2 * s);
  }
  build(mats: Record<MatKey, THREE.Material>, quality: number): THREE.Group {
    const g = new THREE.Group();
    if (!this.merged) {
      this.merged = new Map();
      for (const [k, list] of this.parts) { const geo = mergeGeometries(list, false)!; geo.computeBoundingSphere(); this.merged.set(k, geo); }
      this.parts.clear();
    }
    for (const [k, geo] of this.merged) {
      const m = new THREE.Mesh(geo, mats[k]); m.name = 'part_' + k;
      m.castShadow = quality > 0 && k !== 'glow' && k !== 'eye'; m.receiveShadow = quality > 1;
      g.add(m);
    }
    return g;
  }
}

interface KitStyle { rune: number; engine: number; under: number | null }
const STYLE: Record<Kit, KitStyle> = {
  stock: { rune: 0xff5a10, engine: 0xff6a10, under: null },
  gt: { rune: 0xff1a12, engine: 0xff2a10, under: 0xff2000 },
  rally: { rune: 0xffaa22, engine: 0xffa020, under: null },
  drift: { rune: 0xff2dd8, engine: 0xff3a90, under: 0xff2dd8 },
};

/** Static body for one kit (cached per kit/detail level; instances only swap the paint material). */
const templates = new Map<string, { body: THREE.Group; wheel: THREE.Group[] }>();
function template(kit: Kit, detailed: boolean, quality: number) {
  const key = `${kit}|${detailed}|${quality}`;
  const hit = templates.get(key); if (hit) return hit;
  const d = detailed && quality > 0 ? 1 : 0, seg = d ? 4 : 2;
  const B = new Builder();
  // body: low wedge with a raked nose and a high rear deck
  const long = kit === 'gt' ? 1.06 : 1;
  const body: [number, number][] = [[-2.3 * long, 0.26], [-2.32 * long, 0.5], [-1.9, 0.62], [-1.1, 0.76], [-0.55, 0.82], [0.9, 0.86], [1.95, 0.88], [2.25, 0.8], [2.28, 0.32], [1.9, 0.22], [-1.8, 0.22]];
  B.add('paint', profile(body, kit === 'drift' ? 1.74 : 1.84, 0.08, seg));
  // obsidian canopy
  const canopy: [number, number][] = kit === 'drift' ? [[-0.75, 0.8], [0.05, 1.08], [0.8, 1.06], [1.45, 0.86]] : [[-0.6, 0.8], [0.12, 1.2], [0.72, 1.18], [1.2, 0.85]];
  B.add('glass', profile(canopy, kit === 'drift' ? 1.04 : 1.2, 0.06, seg));
  // fender flares over the wheels + sill blades
  for (const sx of [-1, 1]) {
    for (const [z, r] of [[-1.4, 0.36], [1.35, 0.42]] as const) {
      const arch = new THREE.TorusGeometry(r + 0.06, 0.07, 6, 10 + d * 6, Math.PI); arch.rotateY(Math.PI / 2);
      B.add('paint', arch, sx * 0.97, r, z, 0, 0, 0, 1.4, 1, 1);
    }
    B.add('iron', new THREE.BoxGeometry(0.08, 0.1, 1.9), sx * 0.96, 0.25, 0);
    for (let i = 0; i < 4; i++) B.spike('iron', 0.045, 0.22, V(sx * 1.0, 0.26, -0.75 + i * 0.5), V(sx, 0.15, 0.35));
  }
  // headlight eyes (slanted slits) and brake strip
  for (const sx of [-1, 1]) B.add('eye', new THREE.BoxGeometry(0.32, 0.05, 0.05), sx * 0.55, 0.56, -2.3 * long - 0.02, 0, 0, sx * 0.28);
  // exposed engine on the rear deck: iron block, glowing core, intake stacks
  B.add('iron', new THREE.BoxGeometry(0.9, 0.22, 0.9), 0, 0.97, 1.45);
  B.add('glow', new THREE.CylinderGeometry(0.17, 0.17, 0.72, 10 + d * 6), 0, 1.12, 1.45, 0, 0, Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const sx = i % 2 ? 1 : -1, z = 1.15 + Math.floor(i / 2) * 0.3;
    B.add('iron', new THREE.CylinderGeometry(0.055, 0.07, 0.34, 8), sx * 0.3, 1.2, z, 0, 0, sx * -0.35);
    B.add('glow', new THREE.CylinderGeometry(0.045, 0.045, 0.02, 8), sx * 0.36, 1.36, z, 0, 0, sx * -0.35);
  }
  // exhaust pipes
  for (const sx of [-0.42, 0.42]) B.add('iron', new THREE.CylinderGeometry(0.1, 0.12, 0.42, 10), sx, 0.42, 2.12, Math.PI / 2, 0, 0);
  // skull grille (Cerberus has three heads)
  if (kit === 'rally') { B.skull(V(0, 0.44, -2.38), 0.95, d); for (const sx of [-1, 1]) B.skull(V(sx * 0.62, 0.42, -2.18), 0.7, d); }
  else B.skull(V(0, 0.42, -2.36 * long), kit === 'drift' ? 0.7 : 0.85, d);

  if (kit === 'stock') { // Hellhound: forward-curling ram horns + spine spikes
    const p = [V(0.55, 0.74, -1.3), V(0.85, 1.0, -1.55), V(0.85, 1.22, -2.0), V(0.62, 1.16, -2.4)];
    B.add('bone', horn(p, 0.12, 8 + d * 8)); B.add('bone', horn(mirror(p), 0.12, 8 + d * 8));
    for (let i = 0; i < 5; i++) B.spike('iron', 0.06, 0.28, V(0, 1.18 - Math.abs(i - 2) * 0.03, -0.05 + i * 0.22), V(0, 1, 0.5));
    for (let i = 0; i < 3; i++) B.spike('iron', 0.05, 0.22, V(0, 0.8 + i * 0.03, -1.7 + i * 0.35), V(0, 1, 0.3));
  } else if (kit === 'gt') { // Baphomet: great rear horns framing an iron wing
    const p = [V(0.42, 0.95, 1.5), V(0.9, 1.55, 1.85), V(1.3, 1.72, 1.3), V(1.38, 1.4, 0.8), V(1.2, 1.2, 0.75)];
    B.add('bone', horn(p, 0.16, 10 + d * 10, 9, 1.0)); B.add('bone', horn(mirror(p), 0.16, 10 + d * 10, 9, 1.0));
    B.add('iron', new THREE.BoxGeometry(1.7, 0.05, 0.42), 0, 1.42, 1.95, -0.12);
    for (const sx of [-0.4, 0.4]) B.add('iron', new THREE.BoxGeometry(0.05, 0.42, 0.1), sx, 1.2, 1.95);
    for (let i = 0; i < 7; i++) B.spike('iron', 0.04, 0.2, V(-0.75 + i * 0.25, 1.44, 2.14), V(0, 0.6, 1));
    B.add('iron', new THREE.BoxGeometry(1.9, 0.04, 0.3), 0, 0.12, -2.35); // splitter
    for (let i = 0; i < 6; i++) B.spike('iron', 0.035, 0.18, V(-0.8 + i * 0.32, 0.12, -2.5), V(0, 0, -1));
  } else if (kit === 'rally') { // Cerberus: bone plating, roof lamp eyes, ribcage roll bar
    for (let i = 0; i < 3; i++) B.add('bone', new THREE.BoxGeometry(1.1 - i * 0.18, 0.05, 0.28), 0, 0.84 + i * 0.05, -1.5 + i * 0.32, -0.2);
    B.add('iron', new THREE.BoxGeometry(1.2, 0.08, 0.12), 0, 1.3, -0.05);
    for (let i = 0; i < 4; i++) B.add('eye', new THREE.SphereGeometry(0.06, 8, 6), -0.42 + i * 0.28, 1.3, -0.12);
    for (let i = 0; i < 4; i++) { const rib = new THREE.TorusGeometry(0.58, 0.035, 5, 12, Math.PI); B.add('bone', rib, 0, 0.95, 0.35 + i * 0.16, 0, 0, 0, 1, 0.55, 1); }
    for (const sx of [-1, 1]) for (const z of [-0.75, 1.95]) B.add('dark', new THREE.BoxGeometry(0.34, 0.3, 0.02), sx * 0.8, 0.3, z);
  } else { // Succubus: swept horns, bat-wing fins, tail spike
    const p = [V(0.28, 1.04, -0.2), V(0.5, 1.28, 0.35), V(0.58, 1.32, 1.0), V(0.5, 1.2, 1.45)];
    B.add('bone', horn(p, 0.07, 8 + d * 6)); B.add('bone', horn(mirror(p), 0.07, 8 + d * 6));
    for (const sx of [-1, 1]) {
      const w = new THREE.Shape(); w.moveTo(0, 0); w.lineTo(0.55, 0.65); w.lineTo(0.42, 0.3); w.lineTo(0.75, 0.42); w.lineTo(0.62, 0.1); w.lineTo(0.9, 0.12); w.lineTo(0.7, -0.05); w.lineTo(0, -0.05);
      const wg = new THREE.ExtrudeGeometry(w, { depth: 0.03, bevelEnabled: false }); wg.rotateY(Math.PI / 2);
      B.add('paint', wg, sx * 0.78, 0.86, 2.15, 0, 0, sx * -0.35);
    }
    B.spike('iron', 0.07, 0.65, V(0, 0.55, 2.28), V(0, 0.15, 1), 5);
  }

  // wheels: tire + glowing rim ring + hub spikes (front smaller than rear)
  const wheels: THREE.Group[] = [];
  for (const [n, x, z, r] of [['wheel_fl', -0.97, -1.4, 0.36], ['wheel_fr', 0.97, -1.4, 0.36], ['wheel_rl', -0.97, 1.35, 0.42], ['wheel_rr', 0.97, 1.35, 0.42]] as const) {
    const W = new Builder(); const sx = Math.sign(x);
    W.add('tire', new THREE.CylinderGeometry(r, r, 0.34, 14 + d * 10), 0, 0, 0, 0, 0, Math.PI / 2);
    W.add('iron', new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.36, 6), 0, 0, 0, 0, 0, Math.PI / 2);
    const ring = new THREE.TorusGeometry(r * 0.66, 0.025, 4, 12 + d * 12); ring.rotateY(Math.PI / 2);
    W.add('glow', ring, sx * 0.185, 0, 0);
    W.spike('iron', 0.06, 0.26, V(sx * 0.17, 0, 0), V(sx, 0, 0), 6);
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; W.spike('iron', 0.03, 0.09, V(sx * 0.18, Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4), V(sx, 0, 0), 4); }
    const wg = new THREE.Group(); wg.name = n; wg.position.set(x, r, z); wg.rotation.order = 'YXZ';
    (wg.userData as { builder: Builder }).builder = W; wheels.push(wg);
  }
  const T = { body: new THREE.Group(), wheel: wheels };
  (T.body.userData as { builder: Builder }).builder = B;
  templates.set(key, T);
  return T;
}

/** Build one demon car. Each instance gets its own paint, glow and brake material; geometry is shared per kit. */
export function buildCar(_assets: Assets, color: number, quality: number, detailed: boolean, kit: Kit = 'stock', rideHeight = 0): CarVisual {
  const S = getShared();
  const st = STYLE[kit];
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.7, roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.1 });
  const brakeMat = S.tail.clone();
  const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(st.engine).multiplyScalar(2.2), toneMapped: false });
  const mats: Record<MatKey, THREE.Material> = { paint, iron: S.iron, bone: S.bone, glass: S.glass, glow, eye: S.eye, brake: brakeMat, tire: S.tire, dark: S.dark };
  const T = template(kit, detailed, quality);
  const group = new THREE.Group();
  const main = (T.body.userData as { builder: Builder }).builder.build(mats, quality); main.name = 'main';
  main.position.y = rideHeight; group.add(main);
  const wheels = T.wheel.map(w => {
    const g = (w.userData as { builder: Builder }).builder.build(mats, quality);
    g.name = w.name; g.position.copy(w.position); g.rotation.order = 'YXZ'; group.add(g); return g as THREE.Object3D;
  });
  // brake light bar
  const brake = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.04), brakeMat); brake.position.set(0, 0.74 + rideHeight, 2.29); main.add(brake);
  // emissive rune decals along both flanks and across the hood
  const runeMat = new THREE.MeshBasicMaterial({ map: S.runes, color: new THREE.Color(st.rune).multiplyScalar(1.8), transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  for (const sx of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.24), runeMat); r.rotation.y = sx * Math.PI / 2; r.position.set(sx * 0.975, 0.5, 0.1); r.renderOrder = 2; main.add(r);
  }
  const hood = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.13), runeMat); hood.rotation.set(-Math.PI / 2 + 0.17, 0, Math.PI / 2); hood.position.set(0, 0.81, -1.15); main.add(hood);
  (glow.userData as { rune: THREE.MeshBasicMaterial }).rune = runeMat;
  // contact shadow
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2), S.shadow); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; sh.renderOrder = 1; group.add(sh);
  if (st.under !== null) {
    const u = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5), new THREE.MeshBasicMaterial({ map: S.glowTex, color: st.under, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.8 }));
    u.rotation.x = -Math.PI / 2; u.position.y = 0.035; u.renderOrder = 2; group.add(u);
  }
  // hellfire exhausts: always breathing a little, roaring during Soul Burn
  const flames: THREE.Mesh[] = [];
  const fg = new THREE.ConeGeometry(0.13, 1.4, 10, 1, true); fg.translate(0, 0.7, 0); fg.rotateX(Math.PI / 2);
  for (const x of [-0.42, 0.42]) {
    const f = new THREE.Mesh(fg, S.flame); f.position.set(x, 0.42 + rideHeight, 2.32); f.renderOrder = 3; f.scale.set(0.5, 0.5, 0.3);
    group.add(f); flames.push(f);
  }
  return { group, wheels, brakeMat, flames, paint, glow };
}

/** Pulse a car's runes/engine core (k = 0 idle .. 1 Soul Burn). */
export function setGlow(glow: THREE.MeshBasicMaterial, base: number, k: number, time: number) {
  const pulse = 1 + 0.25 * Math.sin(time * 6);
  glow.color.setHex(base).multiplyScalar((2 + k * 3) * pulse);
  const rune = (glow.userData as { rune?: THREE.MeshBasicMaterial }).rune;
  if (rune) rune.opacity = 0.75 + 0.25 * Math.sin(time * 4) + k * 0.5;
}
export const engineColor = (kit: Kit) => STYLE[kit].engine;
