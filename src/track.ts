import * as THREE from 'three';
import type { Assets } from './assets';

export interface TrackSample {
  p: THREE.Vector3;   // centerline point
  t: THREE.Vector3;   // unit tangent
  n: THREE.Vector3;   // unit right-hand normal (in XZ plane)
  curvature: number;  // signed, 1/m (positive = turning left)
  racingOffset: number; // lateral offset of the racing line (m, +right)
  targetSpeed: number;  // AI target speed (m/s)
  dist: number;       // distance along track from start (m)
}

export const ROAD_WIDTH = 16;
export const CURB_WIDTH = 1.4;
export const WALL_OFFSET = ROAD_WIDTH / 2 + 7; // barrier distance from centerline

// Control points of a closed circuit (x, z). Hand designed: long straight,
// hairpin, esses, sweeper and a fast final corner.
const CONTROL: [number, number][] = [
  [0, 0], [0, -120], [10, -220], [60, -280], [140, -290], [190, -250],
  [180, -190], [130, -160], [120, -110], [170, -70], [250, -80], [320, -40],
  [340, 40], [300, 110], [220, 130], [160, 170], [150, 240], [90, 290],
  [10, 280], [-40, 220], [-30, 140], [-10, 80],
];

export class Track {
  curve: THREE.CatmullRomCurve3;
  samples: TrackSample[] = [];
  length: number;
  readonly N = 1600;

  constructor() {
    this.curve = new THREE.CatmullRomCurve3(
      CONTROL.map(([x, z]) => new THREE.Vector3(x * 1.4, 0, z * 1.4)), true, 'centripetal');
    this.length = this.curve.getLength();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.N; i++) {
      const u = i / this.N;
      const p = this.curve.getPointAt(u);
      const t = this.curve.getTangentAt(u).setY(0).normalize();
      const n = new THREE.Vector3().crossVectors(t, up).normalize(); // right
      this.samples.push({ p, t, n, curvature: 0, racingOffset: 0, targetSpeed: 80, dist: u * this.length });
    }
    // curvature from tangent change
    const ds = this.length / this.N;
    for (let i = 0; i < this.N; i++) {
      const a = this.samples[(i - 3 + this.N) % this.N].t, b = this.samples[(i + 3) % this.N].t;
      const cross = a.x * b.z - a.z * b.x; // + = turning right in our frame
      const ang = Math.atan2(cross, a.dot(b));
      this.samples[i].curvature = ang / (6 * ds);
    }
    // smooth curvature, build racing line (move to inside of corners, outside on approach)
    const smooth = (arr: number[], r: number) => arr.map((_, i) => {
      let s = 0; for (let k = -r; k <= r; k++) s += arr[(i + k + this.N) % this.N]; return s / (2 * r + 1);
    });
    let k = smooth(this.samples.map(s => s.curvature), 12);
    const half = ROAD_WIDTH / 2 - 2;
    let off = k.map(c => THREE.MathUtils.clamp(c * 900, -1, 1) * half);
    off = smooth(off, 40);
    // target speed from lookahead curvature: v = sqrt(mu*g/|k|), then backward pass for braking
    const mu = 1.38 * 9.81;
    const v = k.map(c => Math.min(78, Math.sqrt(mu / Math.max(Math.abs(c), 1e-4))));
    const decel = 11; // m/s^2 braking capability
    for (let pass = 0; pass < 2; pass++)
      for (let i = this.N - 1; i >= 0; i--) {
        const nxt = v[(i + 1) % this.N];
        v[i] = Math.min(v[i], Math.sqrt(nxt * nxt + 2 * decel * ds));
      }
    this.samples.forEach((s, i) => { s.racingOffset = off[i]; s.targetSpeed = v[i]; s.curvature = k[i]; });
  }

  /** Find nearest sample index, searching around a hint for speed. */
  nearest(pos: THREE.Vector3, hint = -1): number {
    let best = 0, bd = Infinity;
    const scan = (from: number, to: number) => {
      for (let j = from; j <= to; j++) {
        const i = ((j % this.N) + this.N) % this.N;
        const s = this.samples[i].p;
        const d = (s.x - pos.x) ** 2 + (s.z - pos.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    };
    if (hint >= 0) { scan(hint - 40, hint + 40); if (bd < 30 * 30) return best; }
    scan(0, this.N - 1);
    return best;
  }

  lateral(pos: THREE.Vector3, i: number): number {
    const s = this.samples[i];
    return (pos.x - s.p.x) * s.n.x + (pos.z - s.p.z) * s.n.z;
  }

  /** Build all track visuals. */
  build(scene: THREE.Scene, quality: number, assets: Assets, wet: boolean): void {
    const N = this.N;
    // --- road ribbon: CC0 PBR asphalt (ambientCG) + painted markings decal layer
    // tiling is baked into UVs (no texture clones) so compressed textures are uploaded once
    const A = assets.asphalt;
    const roadMat = new THREE.MeshStandardMaterial({
      map: A.map, normalMap: A.normalMap, roughnessMap: A.roughnessMap,
      color: wet ? 0x5a5d62 : 0x9a9a9a, roughness: wet ? 0.28 : 1, metalness: wet ? 0.15 : 0, envMapIntensity: wet ? 1.6 : 0.8,
    });
    roadMat.normalScale.set(0.8, 0.8);
    const road = new THREE.Mesh(this.ribbon(-ROAD_WIDTH / 2, ROAD_WIDTH / 2, 0.02, 3.2, 6), roadMat); road.receiveShadow = true; scene.add(road);
    this.roadMesh = road;
    const marks = new THREE.Mesh(this.ribbon(-ROAD_WIDTH / 2, ROAD_WIDTH / 2, 0.03, 1), new THREE.MeshStandardMaterial({
      map: markingTexture(), transparent: true, roughness: wet ? 0.3 : 0.7, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    marks.receiveShadow = true; scene.add(marks);
    // --- curbs (painted, bumpy)
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTexture(), roughness: wet ? 0.25 : 0.55 });
    for (const side of [-1, 1]) {
      const a = side * ROAD_WIDTH / 2, b = side * (ROAD_WIDTH / 2 + CURB_WIDTH);
      const g = this.ribbon(Math.min(a, b), Math.max(a, b), 0.06, 0.25);
      const m = new THREE.Mesh(g, curbMat); m.receiveShadow = true; scene.add(m);
    }
    // --- run-off asphalt strip
    const runoffMat = new THREE.MeshStandardMaterial({ map: A.map, normalMap: A.normalMap, color: 0x7a7468, roughness: 1 });
    for (const side of [-1, 1]) {
      const a = side * (ROAD_WIDTH / 2 + CURB_WIDTH), b = side * (WALL_OFFSET);
      const m = new THREE.Mesh(this.ribbon(Math.min(a, b), Math.max(a, b), 0.01, 1, 2), runoffMat);
      m.receiveShadow = true; scene.add(m);
    }
    // --- barriers (walls with emissive stripe)
    const wallMat = new THREE.MeshStandardMaterial({ map: barrierTexture(), roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const g = this.wall(side * (WALL_OFFSET + 0.3), 1.1, 0.6);
      const m = new THREE.Mesh(g, wallMat); m.castShadow = quality > 0; m.receiveShadow = true; scene.add(m);
    }
    // --- start/finish line + gantry
    const s0 = this.samples[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH, 2.5),
      new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.7 }));
    line.rotation.x = -Math.PI / 2; line.position.y = 0.04;
    const gantry = new THREE.Group(); gantry.add(line);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x222831, metalness: 0.8, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9, 0.8), postMat);
      post.position.set(side * (ROAD_WIDTH / 2 + 2.5), 4.5, 0); post.castShadow = true; gantry.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(ROAD_WIDTH + 6, 1.6, 1), postMat);
    beam.position.y = 9; gantry.add(beam);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_WIDTH + 4, 1.3),
      new THREE.MeshBasicMaterial({ map: textTexture('NEON APEX  ·  START / FINISH'), toneMapped: false }));
    sign.position.set(0, 9, 0.51); gantry.add(sign);
    const sign2 = sign.clone(); sign2.rotation.y = Math.PI; sign2.position.z = -0.51; gantry.add(sign2);
    gantry.position.copy(s0.p);
    gantry.rotation.y = Math.atan2(s0.t.x, s0.t.z) + Math.PI;
    scene.add(gantry);
    this.lights = [];
    void N;
  }
  lights: THREE.Vector3[] = [];
  roadMesh: THREE.Mesh | null = null;

  /** Flat ribbon between lateral offsets l0..l1. vScale = texture repeats per meter along track. */
  private ribbon(l0: number, l1: number, y: number, vScale: number, uScale = 1): THREE.BufferGeometry {
    const N = this.N, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      const d = i === N ? this.length : s.dist;
      for (const [l, u] of [[l0, 0], [l1, uScale]] as const) {
        pos.push(s.p.x + s.n.x * l, y, s.p.z + s.n.z * l);
        uv.push(u, d * vScale / 8);
      }
      if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // ensure normals point up
    const nrm = g.getAttribute('normal');
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    return g;
  }

  /** A thick wall following the track at lateral offset `l`. */
  private wall(l: number, h: number, thick: number): THREE.BufferGeometry {
    const N = this.N, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const ring = [[-thick / 2, 0], [-thick / 2, h], [thick / 2, h], [thick / 2, 0]];
    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      const d = i === N ? this.length : s.dist;
      for (let r = 0; r < 4; r++) {
        const [dl, y] = ring[r];
        pos.push(s.p.x + s.n.x * (l + dl), y, s.p.z + s.n.z * (l + dl));
        uv.push(r / 3, d / 6);
      }
      if (i < N) {
        const a = i * 4, b = a + 4;
        for (let r = 0; r < 3; r++) idx.push(a + r, b + r, a + r + 1, a + r + 1, b + r, b + r + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
}

// ---------- procedural textures ----------
function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function markingTexture() {
  return canvasTex(256, 512, c => {
    c.clearRect(0, 0, 256, 512);
    c.fillStyle = 'rgba(240,240,240,0.92)'; c.fillRect(6, 0, 5, 512); c.fillRect(245, 0, 5, 512);
    c.fillRect(125, 0, 6, 220);
  });
}
function curbTexture() {
  return canvasTex(64, 128, c => {
    c.fillStyle = '#d61f2c'; c.fillRect(0, 0, 64, 64);
    c.fillStyle = '#f2f2f2'; c.fillRect(0, 64, 64, 64);
  });
}
function barrierTexture() {
  return canvasTex(128, 256, c => {
    c.fillStyle = '#c9ccd2'; c.fillRect(0, 0, 128, 256);
    c.fillStyle = '#1f6feb'; c.fillRect(0, 0, 128, 128);
    c.fillStyle = '#f2f2f2'; c.fillRect(0, 118, 128, 20);
  });
}
function checkerTexture() {
  return canvasTex(256, 64, c => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
      c.fillStyle = (x + y) % 2 ? '#111' : '#eee'; c.fillRect(x * 16, y * 16, 16, 16);
    }
  }, false);
}
export function textTexture(text: string) {
  return canvasTex(1024, 72, c => {
    c.fillStyle = '#0a0f1e'; c.fillRect(0, 0, 1024, 72);
    c.font = 'bold 46px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.shadowColor = '#00e5ff'; c.shadowBlur = 18; c.fillStyle = '#7ff6ff'; c.fillText(text, 512, 38);
  }, false);
}
