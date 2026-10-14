import * as THREE from 'three';

export interface CarInput { throttle: number; brake: number; steer: number; handbrake: boolean; }

/**
 * Planar vehicle dynamics: a bicycle model with saturating tire forces,
 * longitudinal load transfer, a 6-speed auto gearbox (for RPM/audio),
 * aero drag and rolling resistance. Integrated at a fixed 120 Hz.
 */
export class CarPhysics {
  // state
  pos = new THREE.Vector3();
  heading = 0;            // radians, 0 = facing -Z
  vf = 0;                 // forward velocity (m/s, body frame)
  vl = 0;                 // lateral velocity (m/s, +right)
  yawRate = 0;            // rad/s (+ = turning right)
  steerAngle = 0;
  rpm = 1000; gear = 1;
  slipFront = 0; slipRear = 0; wheelspin = 0;
  offroad = false;

  // params
  mass = 1250; inertia = 1700;
  a = 1.25; b = 1.35;          // CG to front / rear axle
  cornering = 95000;           // N/rad
  mu = 1.55;                   // tire friction (arcade-ish)
  engineForce = 11500;
  brakeForce = 16000;
  drag = 0.42; rolling = 14;
  maxSteer = 0.55;
  gearRatios = [0, 3.4, 2.3, 1.7, 1.32, 1.08, 0.9];
  power = 1;                   // AI skill multiplier
  stability = 0.6;             // traction/stability assist (0 = off). Disabled while handbraking.

  get speed() { return Math.hypot(this.vf, this.vl); }
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.heading), 0, -Math.cos(this.heading)); }
  right(out = new THREE.Vector3()) { return out.set(Math.cos(this.heading), 0, Math.sin(this.heading)); }

  /** world-space velocity */
  velocity(out = new THREE.Vector3()) {
    const f = this.forward(), r = this.right();
    return out.copy(f).multiplyScalar(this.vf).addScaledVector(r, this.vl);
  }
  setVelocity(v: THREE.Vector3) {
    const f = this.forward(), r = this.right();
    this.vf = v.dot(f); this.vl = v.dot(r);
  }

  step(inp: CarInput, dt: number) {
    const g = 9.81, m = this.mass, L = this.a + this.b;
    const speed = Math.abs(this.vf);
    // speed-sensitive steering: lock reduces with speed, steering is rate-limited
    const lock = this.maxSteer / (1 + speed / 18);
    const target = inp.steer * lock;
    const rate = 3.2 * dt;
    this.steerAngle += THREE.MathUtils.clamp(target - this.steerAngle, -rate, rate);
    const delta = this.steerAngle;

    // gearbox (auto), drive force falls with gear ratio
    const wheelRpm = speed / 0.33 * 60 / (2 * Math.PI);
    let ratio = this.gearRatios[this.gear] * 3.7;
    let rpm = wheelRpm * ratio;
    if (rpm > 7600 && this.gear < 6) this.gear++;
    else if (rpm < 3600 && this.gear > 1) this.gear--;
    ratio = this.gearRatios[this.gear] * 3.7;
    rpm = Math.max(1000, wheelRpm * ratio);
    const torqueCurve = 0.75 + 0.35 * Math.sin(Math.min(rpm / 8000, 1) * Math.PI * 0.95);
    let drive = 0, brakeF = 0;
    const reversing = this.vf < 0.5 && inp.brake > 0.1 && inp.throttle < 0.1;
    if (reversing) drive = -this.engineForce * 0.35 * inp.brake;
    else {
      drive = inp.throttle * this.engineForce * this.power * torqueCurve * (this.gearRatios[this.gear] / 1.7) * 0.55;
      if (this.vf > 0.5) brakeF = inp.brake * this.brakeForce;
    }
    if (rpm > 8200) drive = Math.min(drive, 0); // limiter
    let Fx = drive - brakeF;
    this.rpm += (Math.min(rpm + inp.throttle * 600, 8400) - this.rpm) * Math.min(1, dt * 10);

    // resistances
    const dragMul = this.offroad ? 3.5 : 1;
    Fx -= this.drag * this.vf * Math.abs(this.vf) + this.rolling * this.vf * dragMul * (this.offroad ? 8 : 1);

    // load transfer
    const ax0 = Fx / m;
    const h = 0.32;
    const Wf = m * g * this.b / L - m * ax0 * h / L;
    const Wr = m * g * this.a / L + m * ax0 * h / L;

    // slip angles (low speed guard)
    const vx = Math.max(Math.abs(this.vf), 2) * Math.sign(this.vf || 1);
    const slipF = Math.atan2(this.vl + this.a * this.yawRate, Math.abs(vx)) - delta * Math.sign(vx);
    const slipR = Math.atan2(this.vl - this.b * this.yawRate, Math.abs(vx));
    const muSurf = this.mu * (this.offroad ? 0.7 : 1);
    const rearMu = muSurf * (inp.handbrake ? 0.38 : 1);
    // rear grip also reduced by throttle (combined slip, simple friction circle)
    // friction circle: RWD drive + 35% of braking on the rear, 65% of braking on the front
    const rearLongUse = Math.min(0.9, Math.abs(drive + 0.35 * brakeF) / (rearMu * Wr + 1));
    const frontLongUse = Math.min(0.9, 0.65 * brakeF / (muSurf * Wf + 1));
    const maxF = muSurf * Wf * Math.sqrt(1 - frontLongUse * frontLongUse * 0.5);
    const maxR = rearMu * Wr * Math.sqrt(1 - rearLongUse * rearLongUse * 0.5);
    const Fyf = THREE.MathUtils.clamp(-this.cornering * slipF, -maxF, maxF);
    const Fyr = THREE.MathUtils.clamp(-this.cornering * 1.2 * slipR, -maxR, maxR);
    this.slipFront = Math.abs(slipF); this.slipRear = Math.abs(slipR);
    this.wheelspin = rearLongUse;

    if (inp.handbrake) Fx -= Math.sign(this.vf) * Math.min(Math.abs(this.vf) * m, 4500);

    // equations of motion in body frame (y = right)
    const axl = (Fx - Fyf * Math.sin(delta)) / m + this.vl * this.yawRate;
    const ayl = (Fyr + Fyf * Math.cos(delta)) / m - this.vf * this.yawRate;
    let yawAcc = (this.a * Fyf * Math.cos(delta) - this.b * Fyr) / this.inertia;
    // stability assist: nudges yaw rate toward the kinematic (steered) yaw rate, capped by grip
    if (!inp.handbrake && speed > 5) {
      const rMax = muSurf * g / speed;
      const rIdeal = THREE.MathUtils.clamp(this.vf * Math.tan(delta) / L, -rMax, rMax);
      yawAcc -= this.stability * 4 * (this.yawRate - rIdeal);
    }

    this.vf += axl * dt;
    this.vl += ayl * dt;
    this.yawRate += yawAcc * dt;
    // low speed stabilisation
    if (speed < 3) { this.vl *= 1 - dt * 6; this.yawRate *= 1 - dt * 4; }
    if (Math.abs(this.vf) < 0.3 && inp.throttle < 0.05 && inp.brake < 0.05) this.vf *= 1 - dt * 5;
    this.heading += this.yawRate * dt;

    const f = this.forward(), r = this.right();
    this.pos.addScaledVector(f, this.vf * dt).addScaledVector(r, this.vl * dt);
  }
}

/** Procedural low-poly sports car mesh. */
export function buildCarMesh(color: number, quality: number): { group: THREE.Group; wheels: THREE.Object3D[]; brakeMat: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.6, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x0a1420, metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.85 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff4ff, emissiveIntensity: 3 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff1020, emissiveIntensity: 1.2 });

  // lower body: extruded side profile
  const shape = new THREE.Shape();
  shape.moveTo(-2.25, 0.25); shape.lineTo(2.2, 0.25); shape.lineTo(2.3, 0.6);
  shape.lineTo(1.2, 0.85); shape.lineTo(-1.9, 0.92); shape.lineTo(-2.3, 0.75); shape.closePath();
  const body = new THREE.ExtrudeGeometry(shape, { depth: 1.9, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2 });
  body.translate(0, 0, -0.95); body.rotateY(Math.PI / 2); // length along -Z
  const bodyMesh = new THREE.Mesh(body, paint); group.add(bodyMesh);
  // cabin
  const cs = new THREE.Shape();
  cs.moveTo(-1.2, 0.85); cs.lineTo(0.9, 0.86); cs.lineTo(0.15, 1.32); cs.lineTo(-0.9, 1.3); cs.lineTo(-1.5, 0.9); cs.closePath();
  const cab = new THREE.ExtrudeGeometry(cs, { depth: 1.5, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 });
  cab.translate(0, 0, -0.75); cab.rotateY(Math.PI / 2);
  group.add(new THREE.Mesh(cab, glass));
  // spoiler
  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.4), dark); wing.position.set(0, 1.18, 2.0); group.add(wing);
  for (const x of [-0.6, 0.6]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.2), dark); st.position.set(x, 1.02, 2.0); group.add(st); }
  // splitter / diffuser
  const split = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.5), dark); split.position.set(0, 0.24, -2.25); group.add(split);
  // lights
  for (const x of [-0.7, 0.7]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.05), headMat); hl.position.set(x, 0.58, -2.33); group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.05), brakeMat); tl.position.set(x, 0.7, 2.33); group.add(tl);
  }
  // wheels
  const wheels: THREE.Object3D[] = [];
  const tire = new THREE.CylinderGeometry(0.36, 0.36, 0.32, quality > 1 ? 24 : 14); tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(0.24, 0.24, 0.34, 10); rim.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.25 });
  for (const [x, z] of [[-0.93, -1.3], [0.93, -1.3], [-0.93, 1.38], [0.93, 1.38]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tire, dark)); spin.add(new THREE.Mesh(rim, rimMat));
    pivot.add(spin); group.add(pivot); wheels.push(pivot);
  }
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = quality > 0; o.receiveShadow = false; } });
  return { group, wheels, brakeMat };
}
