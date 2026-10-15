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

/** Rain streaks: line segments recycled in a box that follows the camera. */
export class Rain {
  private geo = new THREE.BufferGeometry();
  private pos: Float32Array; private n: number;
  readonly mesh: THREE.LineSegments;
  constructor(parent: THREE.Object3D, count: number) {
    this.n = count; this.pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i++) this.reset(i, new THREE.Vector3(), true);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mesh = new THREE.LineSegments(this.geo, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.38, depthWrite: false }));
    this.mesh.frustumCulled = false; parent.add(this.mesh);
  }
  private reset(i: number, c: THREE.Vector3, anyY: boolean) {
    const x = c.x + (Math.random() - 0.5) * 70, z = c.z + (Math.random() - 0.5) * 70, y = c.y + (anyY ? Math.random() * 40 - 8 : 30 + Math.random() * 6);
    this.pos.set([x, y, z, x + 0.15, y + 0.9, z + 0.05], i * 6);
  }
  update(dt: number, cam: THREE.Vector3, vel: THREE.Vector3) {
    const dy = 34 * dt, dx = 5 * dt;
    for (let i = 0; i < this.n; i++) {
      const k = i * 6;
      this.pos[k] -= dx; this.pos[k + 3] -= dx; this.pos[k + 1] -= dy; this.pos[k + 4] -= dy;
      // tilt streaks against the camera's motion for a sense of speed
      this.pos[k + 3] = this.pos[k] - vel.x * 0.02 + 0.15; this.pos[k + 5] = this.pos[k + 2] - vel.z * 0.02 + 0.05;
      if (this.pos[k + 1] < cam.y - 10 || Math.abs(this.pos[k] - cam.x) > 40 || Math.abs(this.pos[k + 2] - cam.z) > 40) this.reset(i, cam, false);
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Expanding neon ring used for the nitro shockwave. */
export class Shockwaves {
  private items: { mesh: THREE.Mesh; t: number }[] = [];
  private geo = new THREE.RingGeometry(0.85, 1, 64).rotateX(-Math.PI / 2);
  constructor(private parent: THREE.Object3D) {}
  spawn(p: THREE.Vector3, color = 0x7ff6ff) {
    const mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    mesh.position.set(p.x, 0.4, p.z); this.parent.add(mesh); this.items.push({ mesh, t: 0 });
  }
  update(dt: number) {
    for (const it of this.items) {
      it.t += dt; const k = it.t / 0.7;
      it.mesh.scale.setScalar(1 + k * 22);
      (it.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k) * 2;
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
    const c = new THREE.Color(); const pal = [0xff2d75, 0x00e5ff, 0xffc21a, 0x22d36a, 0xffffff, 0xa24bff];
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
