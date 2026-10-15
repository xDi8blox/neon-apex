import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar } from './carmodel';
import type { Assets } from './assets';
import type { CarDef } from './cars';

/** Garage showroom: a dark studio with a forge turntable; the car spins slowly and can be dragged. */
export class Showroom {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
  private turntable = new THREE.Group();
  private car: THREE.Group | null = null;
  private paint: THREE.MeshPhysicalMaterial | null = null;
  private yaw = 0.6; private vel = 0.25; private drag = false; private lastX = 0;
  private ring: THREE.MeshBasicMaterial;
  private t = 0;
  intro = 1; // swoop-in progress 0..1 (reset on open)

  constructor(renderer: THREE.WebGLRenderer, private assets: Assets, private quality: number) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
    this.scene.environmentIntensity = 0.35;
    this.scene.background = new THREE.Color(0x0a0302);
    this.scene.fog = new THREE.Fog(0x0a0302, 14, 40);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x120806, roughness: 0.35, metalness: 0.5 }));
    floor.receiveShadow = true; this.scene.add(floor);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.5, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x1c1210, roughness: 0.5, metalness: 0.8 }));
    disc.position.y = 0.04; disc.receiveShadow = true; this.turntable.add(disc);
    this.ring = new THREE.MeshBasicMaterial({ color: 0xff4a10, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.47, 0.03, 8, 96).rotateX(Math.PI / 2), this.ring); ring.position.y = 0.08; this.scene.add(ring);
    // back wall light bars
    for (let i = 0; i < 7; i++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 5, 0.08), new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff2a08 : 0xffa020, toneMapped: false }));
      const a = -0.9 + i * 0.3; bar.position.set(Math.sin(a) * 14, 2.5, -Math.cos(a) * 14); this.scene.add(bar);
    }
    this.scene.add(this.turntable);
    const key = new THREE.SpotLight(0xffffff, 140, 30, 0.6, 0.6); key.position.set(4, 8, 5); key.castShadow = quality > 0;
    key.shadow.mapSize.set(1024, 1024); this.scene.add(key);
    const rim = new THREE.PointLight(0xff3a10, 40, 12); rim.position.set(-4, 2, -3); this.scene.add(rim);
    const rim2 = new THREE.PointLight(0xffa030, 30, 12); rim2.position.set(4, 1.5, -3); this.scene.add(rim2);
    this.scene.add(new THREE.HemisphereLight(0xc07050, 0x200500, 0.35));
  }

  setCar(def: CarDef, color: number) {
    if (this.car) this.turntable.remove(this.car);
    const v = buildCar(this.assets, color, this.quality, true, def.kit, def.phys.rideHeight ?? 0);
    v.group.position.y = 0.08; v.group.traverse(o => { o.castShadow = true; });
    this.car = v.group; this.paint = v.paint; this.turntable.add(v.group);
    this.vel += 1.2; // little spin when switching cars
  }
  setColor(c: number) { this.paint?.color.setHex(c); }
  setAccent(c: number) { this.ring.color.setHex(c); }

  pointerDown(x: number) { this.drag = true; this.lastX = x; }
  pointerMove(x: number) { if (!this.drag) return; const d = (x - this.lastX) * 0.01; this.yaw += d; this.vel = d * 30; this.lastX = x; }
  pointerUp() { this.drag = false; }

  render(renderer: THREE.WebGLRenderer, dt: number) {
    this.t += dt;
    if (!this.drag) { this.vel += (0.25 - this.vel) * Math.min(1, dt * 1.5); this.yaw += this.vel * dt; }
    this.turntable.rotation.y = this.yaw;
    // camera swoop: from high/far to a low 3/4 view, with a gentle breathing drift
    this.intro = Math.min(1, this.intro + dt * 0.6);
    const e = 1 - Math.pow(1 - this.intro, 3);
    const aspect = renderer.domElement.width / renderer.domElement.height;
    const dist = THREE.MathUtils.lerp(16, aspect < 1.2 ? 11 : 8.2, e);
    this.camera.position.set(Math.sin(0.5 + this.t * 0.05) * dist * 0.3 - 1.2 * e, THREE.MathUtils.lerp(9, 1.9, e), dist);
    // car sits a bit right of center so the stats panel has room on the left
    this.camera.lookAt(aspect > 1.2 ? -1.6 : 0, 0.6, 0);
    this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
    const exp = renderer.toneMappingExposure; renderer.toneMappingExposure = 0.9;
    renderer.render(this.scene, this.camera);
    renderer.toneMappingExposure = exp;
  }
}
