// Stylized air bubbles in water. Positions and radii use viewport-height
// units, so the motion and contact sizes do not change with device density.
export const BUBBLE_STEP = 1 / 120;
export const MAX_BUBBLES = 96;
export const PADDLE_RADIUS = 0.075;

export interface Bubble {
  id: number;
  x: number; y: number; px: number; py: number;
  vx: number; vy: number;
  radius: number; phase: number;
  // A symmetric, area-preserving deformation tensor: its magnitude is
  // log(stretch), and half its angle gives the ellipse's major axis.
  qx: number; qy: number; pqx: number; pqy: number;
  dqx: number; dqy: number;
  contactX: number; contactY: number;
}

export interface BubbleSettings {
  flow: number;
  rise: number;
  size: number;
  release: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export class BubbleSimulation {
  readonly bubbles: Bubble[] = [];
  readonly settings: BubbleSettings = { flow: 0.75, rise: 1, size: 1, release: 5.5 };
  readonly pointer = { x: 0.5, y: 0.5, targetX: 0.5, targetY: 0.5, vx: 0, vy: 0, active: false };
  time = 0;
  accumulator = 0;
  aspect: number;
  private seed = 0;
  private nextId = 0;
  private releaseAccum = 0;

  constructor(aspect: number, seed = 0x91d26a) {
    this.aspect = Math.max(aspect, 0.15);
    this.reset(seed);
  }

  private random() {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }

  reset(seed = 0x91d26a) {
    this.seed = seed >>> 0;
    this.nextId = 0;
    this.time = 0;
    this.accumulator = 0;
    this.releaseAccum = 0;
    this.pointer.active = false;
    this.pointer.vx = this.pointer.vy = 0;
    this.bubbles.length = 0;
    // Begin with a developed stream instead of an empty loading interval.
    for (let i = 0; i < 22; i++) {
      const b = this.emit(this.aspect * (0.08 + this.random() * 0.84), this.random());
      if (b) b.vy = this.riseSpeed(b.radius);
    }
    this.solveContacts();
    for (const b of this.bubbles) { b.px = b.x; b.py = b.y; }
  }

  resize(aspect: number) {
    const next = Math.max(aspect, 0.15), scale = next / this.aspect;
    for (const b of this.bubbles) { b.x *= scale; b.px *= scale; }
    this.pointer.x *= scale;
    this.pointer.targetX *= scale;
    this.aspect = next;
  }

  setSize(size: number) {
    const next = clamp(size, 0.6, 1.6), ratio = next / this.settings.size;
    this.settings.size = next;
    for (const b of this.bubbles) b.radius = clamp(b.radius * ratio, 0.008, 0.085);
  }

  setPointer(x: number, y: number, active: boolean) {
    const p = this.pointer;
    if (active && !p.active) { p.x = x; p.y = y; p.vx = p.vy = 0; }
    p.targetX = x; p.targetY = y; p.active = active;
  }

  emit(x: number, y: number, radius?: number): Bubble | null {
    if (this.bubbles.length >= MAX_BUBBLES) return null;
    const r = radius ?? (0.012 + Math.pow(this.random(), 0.7) * 0.029) * this.settings.size;
    const b: Bubble = {
      id: this.nextId++, x, y, px: x, py: y, vx: 0, vy: 0.055,
      radius: clamp(r, 0.008, 0.085), phase: this.random() * Math.PI * 2,
      qx: 0.055, qy: 0, pqx: 0.055, pqy: 0, dqx: 0, dqy: 0,
      contactX: 0, contactY: 0,
    };
    this.bubbles.push(b);
    return b;
  }

  releaseCluster() {
    const center = this.aspect * (0.25 + this.random() * 0.5);
    for (let i = 0; i < 7; i++) this.emit(center + (i - 3) * 0.035, 0.02 - (i % 2) * 0.04);
  }

  riseSpeed(radius: number) {
    return this.settings.rise * (0.065 + 0.13 * Math.sqrt(radius / 0.03));
  }

  // One smooth, spatially shared flow field. The curl of this stream
  // function bends neighboring paths together instead of shaking each
  // bubble independently. A larger bubble also has a gentle wake sway.
  flowAt(x: number, y: number): [number, number] {
    const t = this.time;
    const a = x * 3.1 + y * 2.4 - t * 0.32;
    const b = x * 5.2 - y * 3.3 + t * 0.23;
    return [this.settings.flow * (0.014 * 2.4 * Math.cos(a) + 0.007 * 3.3 * Math.cos(b)),
      this.settings.flow * (-0.014 * 3.1 * Math.cos(a) + 0.007 * 5.2 * Math.cos(b))];
  }

  advance(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator + 1e-10 >= BUBBLE_STEP) {
      this.step();
      this.accumulator = Math.max(0, this.accumulator - BUBBLE_STEP);
    }
  }

  get interpolation() { return clamp(this.accumulator / BUBBLE_STEP, 0, 1); }

  private step() {
    const h = BUBBLE_STEP;
    this.time += h;
    const p = this.pointer;
    if (p.active) {
      const ox = p.x, oy = p.y, follow = 1 - Math.exp(-h / 0.045);
      p.x += (p.targetX - p.x) * follow;
      p.y += (p.targetY - p.y) * follow;
      p.vx = clamp((p.x - ox) / h, -2.5, 2.5);
      p.vy = clamp((p.y - oy) / h, -2.5, 2.5);
    }
    this.releaseAccum += this.settings.release * h;
    while (this.releaseAccum >= 1) {
      this.releaseAccum -= 1;
      // Several broad sources, with a slowly wandering outlet.
      const vent = Math.floor(this.random() * 3);
      const x = this.aspect * ((vent + 0.5) / 3) + (this.random() - 0.5) * Math.min(0.18, this.aspect * 0.25);
      this.emit(x, -0.055);
    }

    for (const b of this.bubbles) {
      b.px = b.x; b.py = b.y; b.pqx = b.qx; b.pqy = b.qy;
      b.contactX = b.contactY = 0;
      const [fx, fy] = this.flowAt(b.x, b.y);
      const wake = 0.024 * Math.pow(b.radius / 0.03, 1.4)
        * Math.sin(this.time * (2.8 + 0.25 * b.phase) + b.phase);
      let tx = fx + wake, ty = fy + this.riseSpeed(b.radius);
      if (p.active) {
        const d2 = (b.x - p.x) ** 2 + (b.y - p.y) ** 2;
        const influence = Math.exp(-d2 / 0.035);
        tx += p.vx * influence * 0.8;
        ty += p.vy * influence * 0.8;
      }
      // Exact relaxation over the fixed step provides damped, size-aware
      // terminal rise without the old per-frame friction/correction drift.
      const response = 1 - Math.exp(-h * (4.5 + 0.025 / b.radius));
      b.vx += (tx - b.vx) * response;
      b.vy += (ty - b.vy) * response;
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
    this.solveContacts();
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      if (b.y > 1.12 + b.radius || b.y < -0.35) { this.bubbles.splice(i, 1); continue; }
      // Large, fast bubbles flatten; side acceleration tilts the long axis.
      // Contacts compress along their normals and leave a damped recovery.
      const tqx = clamp(0.025 + 0.10 * b.radius / 0.035 + b.contactX, -0.26, 0.26);
      const tqy = clamp(-b.vx * 0.55 + b.contactY, -0.23, 0.23);
      b.dqx += ((tqx - b.qx) * 190 - b.dqx * 18) * h;
      b.dqy += ((tqy - b.qy) * 190 - b.dqy * 18) * h;
      b.qx += b.dqx * h; b.qy += b.dqy * h;
      const q = Math.hypot(b.qx, b.qy);
      if (q > 0.30) { b.qx *= 0.30 / q; b.qy *= 0.30 / q; b.dqx *= 0.5; b.dqy *= 0.5; }
    }
  }

  // Support radius of the same ellipse used by the vertex shader.
  support(b: Bubble, nx: number, ny: number) {
    const q = Math.hypot(b.qx, b.qy);
    const angle = 0.5 * Math.atan2(b.qy, b.qx), c = Math.cos(angle), s = Math.sin(angle);
    const x = nx * c + ny * s, y = -nx * s + ny * c;
    return b.radius * Math.sqrt(x * x * Math.exp(2 * q) + y * y * Math.exp(-2 * q));
  }

  private solveContacts() {
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < this.bubbles.length; i++) {
        const a = this.bubbles[i];
        for (let j = i + 1; j < this.bubbles.length; j++) {
          const b = this.bubbles[j], dx = b.x - a.x, dy = b.y - a.y;
          if (Math.abs(dx) > (a.radius + b.radius) * 1.36 || Math.abs(dy) > (a.radius + b.radius) * 1.36) continue;
          const distance = Math.hypot(dx, dy), nx = distance > 1e-9 ? dx / distance : 1;
          const ny = distance > 1e-9 ? dy / distance : 0;
          const target = this.support(a, nx, ny) + this.support(b, nx, ny);
          if (distance >= target) continue;
          const wa = 1 / (a.radius * a.radius), wb = 1 / (b.radius * b.radius), sum = wa + wb;
          const gap = target - distance, correction = gap * 0.82 / sum;
          a.x -= nx * correction * wa; a.y -= ny * correction * wa;
          b.x += nx * correction * wb; b.y += ny * correction * wb;
          const speed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (speed < 0) {
            const impulse = -speed / sum;
            a.vx -= nx * impulse * wa; a.vy -= ny * impulse * wa;
            b.vx += nx * impulse * wb; b.vy += ny * impulse * wb;
          }
          if (pass === 0) {
            const stress = Math.min(0.20, gap / Math.min(a.radius, b.radius) * 0.45);
            const qx = -(nx * nx - ny * ny) * stress, qy = -2 * nx * ny * stress;
            a.contactX += qx; a.contactY += qy; b.contactX += qx; b.contactY += qy;
          }
        }
        const side = this.support(a, 1, 0);
        // Narrow portrait windows can be smaller than a diameter.
        if (this.aspect < side * 2) a.x = this.aspect / 2;
        else if (a.x < side) { a.x = side; a.vx = Math.max(0, a.vx); }
        else if (a.x > this.aspect - side) { a.x = this.aspect - side; a.vx = Math.min(0, a.vx); }
        if (this.pointer.active) this.solvePointer(a, pass === 0);
      }
    }
  }

  private solvePointer(b: Bubble, record: boolean) {
    const p = this.pointer, dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy);
    const nx = d > 1e-9 ? dx / d : 0, ny = d > 1e-9 ? dy / d : -1;
    const support = this.support(b, nx, ny), target = PADDLE_RADIUS + support;
    if (d >= target) return;
    const overlap = target - d;
    b.x += nx * overlap * 0.86; b.y += ny * overlap * 0.86;
    const approach = (b.vx - p.vx) * nx + (b.vy - p.vy) * ny;
    if (approach < 0) { b.vx -= nx * approach; b.vy -= ny * approach; }
    if (record) {
      const stress = Math.min(0.23, overlap / b.radius * 0.6);
      b.contactX -= (nx * nx - ny * ny) * stress;
      b.contactY -= 2 * nx * ny * stress;
    }
  }
}
