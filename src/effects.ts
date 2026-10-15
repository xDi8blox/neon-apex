import * as THREE from 'three';

/** Ring-buffer of skid mark quads laid onto the road. */
export class SkidMarks {
  private mesh: THREE.InstancedMesh;
  private i = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3();
  private last = new Map<string, THREE.Vector3>();
  constructor(scene: THREE.Object3D, count: number) {
    const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    scene.add(this.mesh);
  }
  /** Add a segment from the last recorded point of this wheel to `p`. */
  add(key: string, p: THREE.Vector3, active: boolean) {
    const prev = this.last.get(key);
    if (!active) { this.last.delete(key); return; }
    if (prev) {
      const dx = p.x - prev.x, dz = p.z - prev.z, len = Math.hypot(dx, dz);
      if (len < 0.25) return;
      if (len < 4) {
        const yaw = Math.atan2(dx, dz);
        this.m.compose(new THREE.Vector3((p.x + prev.x) / 2, 0.075, (p.z + prev.z) / 2),
          this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw), this.s.set(0.28, 1, len + 0.05));
        this.mesh.setMatrixAt(this.i, this.m);
        this.i = (this.i + 1) % this.mesh.instanceMatrix.count;
        this.mesh.count = Math.max(this.mesh.count, this.i);
        this.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    this.last.set(key, p.clone());
  }
}

/** GPU-light particle system for tire smoke (CPU simulated Points). */
export class Smoke {
  private pos: Float32Array; private vel: Float32Array; private life: Float32Array; private size: Float32Array;
  private geo = new THREE.BufferGeometry();
  private next = 0;
  constructor(scene: THREE.Object3D, private count: number, color = [0.55, 0.54, 0.53], additive = false) {
    this.pos = new Float32Array(count * 3); this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count); this.size = new Float32Array(count);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uScale: { value: 400 } },
      vertexShader: `attribute float aLife; attribute float aSize; varying float vLife; uniform float uScale;
        void main(){ vLife=aLife; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv;
        gl_PointSize = aLife>0.0 ? min(aSize*uScale/ -mv.z, 90.0) : 0.0; }`,
      fragmentShader: `varying float vLife; uniform vec3 uColor; uniform float uAlpha; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); if(r>0.5) discard;
        float a = smoothstep(0.5,0.0,r)*clamp(vLife,0.0,1.0)*uAlpha; gl_FragColor=vec4(uColor,a); }`,
    });
    mat.uniforms.uColor = { value: new THREE.Vector3(...color) };
    mat.uniforms.uAlpha = { value: additive ? 1 : 0.22 };
    if (additive) { mat.blending = THREE.AdditiveBlending; }
    const pts = new THREE.Points(this.geo, mat); pts.frustumCulled = false; scene.add(pts);
  }
  /** fade = life lost per second, grow = size gained per second, gravity in m/s². */
  fade = 0.55; grow = 3.5; gravity = 0; drag = 1.5; baseSize = 1; alpha = 0.22;
  emit(p: THREE.Vector3, v: THREE.Vector3, spread = 2, up = 0.8) {
    const i = this.next; this.next = (this.next + 1) % this.count;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x * 0.3 + (Math.random() - 0.5) * spread, up + Math.random() * spread * 0.5, v.z * 0.3 + (Math.random() - 0.5) * spread], i * 3);
    this.life[i] = 1; this.size[i] = this.baseSize;
  }
  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * this.fade; this.size[i] += dt * this.grow;
      this.vel[i * 3 + 1] -= this.gravity * dt;
      for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; this.vel[i * 3 + k] *= 1 - dt * this.drag; }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Expanding hellfire ring used for the Soul Burn blast. */
export function sigilTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d')!;
  c.strokeStyle = '#fff'; c.shadowColor = '#fff'; c.shadowBlur = 10; c.lineWidth = 7;
  c.beginPath(); c.arc(128, 128, 118, 0, Math.PI * 2); c.stroke(); c.lineWidth = 3; c.beginPath(); c.arc(128, 128, 100, 0, Math.PI * 2); c.stroke();
  c.lineWidth = 6; c.beginPath();
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i * 2 % 5) * Math.PI * 2 / 5; const x = 128 + Math.cos(a) * 100, y = 128 + Math.sin(a) * 100; i ? c.lineTo(x, y) : c.moveTo(x, y); }
  c.stroke();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
let sigilTex: THREE.Texture | null = null;
export class Shockwaves {
  private items: { mesh: THREE.Mesh; t: number; grow: number; spin: number }[] = [];
  private geo = new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2);
  private plane = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  constructor(private parent: THREE.Object3D) {}
  spawn(p: THREE.Vector3, color = 0xff4a10, sigil = false) {
    if (sigil && !sigilTex) sigilTex = sigilTexture();
    const mesh = new THREE.Mesh(sigil ? this.plane : this.geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(sigil ? 3 : 1.5), map: sigil ? sigilTex : null, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    mesh.position.set(p.x, sigil ? 0.15 : 0.4, p.z); this.parent.add(mesh); this.items.push({ mesh, t: 0, grow: sigil ? 9 : 22, spin: sigil ? 2.5 : 0 });
  }
  update(dt: number) {
    for (const it of this.items) {
      it.t += dt; const k = it.t / 0.7;
      it.mesh.scale.setScalar(1 + k * it.grow); it.mesh.rotation.y += it.spin * dt;
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = Math.pow(Math.max(0, 1 - k), 1.5) * 0.9;
      if (k >= 1) { this.parent.remove(it.mesh); (it.mesh.material as THREE.Material).dispose(); }
    }
    this.items = this.items.filter(i => i.t < 0.7);
  }
}

/** Confetti: instanced spinning paper bits with gravity + flutter. */
export class Confetti {
  readonly mesh: THREE.InstancedMesh;
  private p: Float32Array; private v: Float32Array; private r: Float32Array; private alive = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private s = new THREE.Vector3(1, 1, 1); private t = new THREE.Vector3();
  constructor(parent: THREE.Object3D, private n = 600) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 0.26), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), n);
    this.mesh.count = 0; this.mesh.frustumCulled = false; parent.add(this.mesh);
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.r = new Float32Array(n * 3);
    const c = new THREE.Color(); const pal = [0xff4a10, 0xffb02e, 0xc3101a, 0x1a0a08, 0xffe0a0, 0x7a0805]; // embers, ash and blood
    for (let i = 0; i < n; i++) this.mesh.setColorAt(i, c.set(pal[i % pal.length]));
  }
  burst(at: THREE.Vector3) {
    for (let i = 0; i < this.n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 7;
      this.p.set([at.x + (Math.random() - 0.5) * 3, at.y + Math.random() * 2, at.z + (Math.random() - 0.5) * 3], i * 3);
      this.v.set([Math.cos(a) * sp, 6 + Math.random() * 9, Math.sin(a) * sp], i * 3);
      this.r.set([Math.random() * 6, Math.random() * 6, Math.random() * 6], i * 3);
    }
    this.alive = 6; this.mesh.count = this.n;
  }
  update(dt: number, time: number) {
    if (this.alive <= 0) { this.mesh.count = 0; return; }
    this.alive -= dt;
    for (let i = 0; i < this.n; i++) {
      const k = i * 3;
      this.v[k + 1] = Math.max(this.v[k + 1] - 9.81 * dt, -1.6); // paper hits terminal velocity fast
      this.v[k] *= 1 - dt * 0.8; this.v[k + 2] *= 1 - dt * 0.8;
      const flutter = Math.sin(time * 6 + i) * 0.8;
      this.p[k] += (this.v[k] + flutter) * dt; this.p[k + 1] = Math.max(0.02, this.p[k + 1] + this.v[k + 1] * dt); this.p[k + 2] += this.v[k + 2] * dt;
      this.e.set(this.r[k] * time, this.r[k + 1] * time, this.r[k + 2] * time);
      this.m.compose(this.t.set(this.p[k], this.p[k + 1], this.p[k + 2]), this.q.setFromEuler(this.e), this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
