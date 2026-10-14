import * as THREE from 'three';

/** Ring-buffer of skid mark quads laid onto the road. */
export class SkidMarks {
  private mesh: THREE.InstancedMesh;
  private i = 0;
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private s = new THREE.Vector3();
  private last = new Map<string, THREE.Vector3>();
  constructor(scene: THREE.Scene, count: number) {
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
  constructor(scene: THREE.Scene, private count: number) {
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
      fragmentShader: `varying float vLife; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); if(r>0.5) discard;
        float a = smoothstep(0.5,0.0,r)*clamp(vLife,0.0,1.0)*0.22; gl_FragColor=vec4(vec3(0.55,0.54,0.53),a); }`,
    });
    const pts = new THREE.Points(this.geo, mat); pts.frustumCulled = false; scene.add(pts);
  }
  emit(p: THREE.Vector3, v: THREE.Vector3) {
    const i = this.next; this.next = (this.next + 1) % this.count;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x * 0.3 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), v.z * 0.3 + (Math.random() - 0.5) * 2], i * 3);
    this.life[i] = 1; this.size[i] = 1;
  }
  update(dt: number) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt * 0.55; this.size[i] += dt * 3.5;
      for (let k = 0; k < 3; k++) { this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; this.vel[i * 3 + k] *= 1 - dt * 1.5; }
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aLife as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }
}
