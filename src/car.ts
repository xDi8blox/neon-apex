import * as THREE from 'three';

export interface CarInput { throttle: number; brake: number; steer: number; handbrake: boolean; nitro?: boolean; }

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
  nitro = 0.6;            // boost tank 0..1
  boosting = false;
  nitroForce = 6500;
  nitroRegen = 1;          // multiplier on drift refill
  offroadGrip = 0.7;

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
  stability = 0.6;
  surfaceGrip = 1;             // track/weather grip multiplier

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
    if (rpm > 8200 && !(inp.nitro && this.nitro > 0)) drive = Math.min(drive, 0); // limiter
    // nitro: extra thrust while the tank lasts; refills slowly, faster while drifting
    this.boosting = !!inp.nitro && this.nitro > 0.01 && this.vf > 3 && !reversing;
    let boostF = 0;
    if (this.boosting) { boostF = this.nitroForce * this.power; this.nitro = Math.max(0, this.nitro - dt * 0.3); }
    else this.nitro = Math.min(1, this.nitro + dt * (0.035 + (this.slipRear > 0.12 && speed > 12 ? 0.22 * this.nitroRegen : 0)));
    let Fx = drive + boostF - brakeF;
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
    const muSurf = this.mu * (this.offroad ? this.offroadGrip : 1) * this.surfaceGrip;
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

