import { Plugin } from '../../plugin/Plugin';
import { EngineContext } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import quadVert from '../../shaders/fullscreen-quad.vert';
import backgroundFrag from './background.glsl';
import bubbleVert from './bubble.vert';
import bubbleFrag from './bubble.frag';

// ── Tuning constants ────────────────────────────────────────────────
// MAX_BUBBLES sits above the steady-state count (≈ SPAWN_RATE / v_term * height)
// so the spawner never hits the cap and emits in bursts.
const MAX_BUBBLES = 900;
const SPAWN_RATE_PER_SEC = 200;     // framerate-independent
const BUBBLE_MIN_R = 2.5;
const BUBBLE_MAX_R = 7;

// Forces (px/s²)
const BUOYANCY = 340;               // dominant upward force
const DRAG_COEF = 1.2;               // linear F = -k·v (replaces multiplicative drag)
const WOBBLE_FREQ = 2.5;
const WOBBLE_AMP = 55;              // primary lateral wobble

// Turbulence: slower, per-bubble lateral drift (plus a touch of vertical)
const TURBULENCE_FREQ = 0.9;
const TURBULENCE_AMP = 40;
const TURBULENCE_VY_AMP = 14;

// Initial launch velocity
const INIT_VY_MIN = 40;
const INIT_VY_SPREAD = 60;
const INIT_VX_SPREAD = 40;

// Cursor circle interaction
const CURSOR_CIRCLE_R = 70;         // CSS px
const ADHESION_RANGE = 22;          // px outside surface
const ADHESION_STRENGTH = 210;      // < BUOYANCY so only the bottom pole holds
const REPULSE_DEPTH = 6;            // px scale of the interior wall
const REPULSE_STRENGTH = 2000;      // stiff wall to keep bubbles outside the circle

// Bubble-bubble cohesion / contact
const COHESION_RADIUS = 16;
const COHESION_STRENGTH = 32;
// Contact is inelastic: kinetic energy is absorbed by deformation rather than
// stored in a spring and returned as a bounce. We resolve overlap by direct
// position correction (no spring) and kill the approaching normal velocity.
const COLLISION_RESTITUTION = 0.0;  // 0 ⇒ no bounce; all collision energy absorbed
const TANGENT_DAMPING = 0.4;        // viscous shear at the contact film
const POSITION_CORRECTION = 0.8;    // fraction of overlap resolved per step (≤1)

// ── Bubble data ─────────────────────────────────────────────────────

interface Bubble {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  wobblePhase: number;
  opacity: number;
}

export class BubblePhysicsPlugin implements Plugin {
  readonly name = 'Bubble Physics';

  // GL resources
  private bgProgram!: WebGLProgram;
  private bubbleProgram!: WebGLProgram;
  private bgVao!: WebGLVertexArrayObject;
  private bubbleVao!: WebGLVertexArrayObject;
  private instanceBuffer!: WebGLBuffer;

  // Particle state
  private bubbles: Bubble[] = [];
  private instanceData = new Float32Array(MAX_BUBBLES * 4);

  // Force accumulators (reused each frame)
  private fxBuf = new Float32Array(MAX_BUBBLES);
  private fyBuf = new Float32Array(MAX_BUBBLES);

  // Spawn accumulator for rate-per-second spawning
  private spawnAccum = 0;

  // Pointer state (own listeners for hold-in-place support)
  private pointerActive = false;
  private pointerPx: [number, number] = [0, 0]; // pixel coords
  private circleR = CURSOR_CIRCLE_R;

  // Bound listeners for cleanup
  private onDown!: (e: PointerEvent) => void;
  private onMove!: (e: PointerEvent) => void;
  private onUp!: (e: PointerEvent) => void;

  // ── Init ────────────────────────────────────────────────────────

  init(ctx: EngineContext) {
    const { gl, canvas } = ctx;

    // Scale circle radius by DPR
    this.circleR = CURSOR_CIRCLE_R * (window.devicePixelRatio || 1);

    // ── Compile programs ──
    this.bgProgram = createProgram(gl, quadVert, backgroundFrag);
    this.bubbleProgram = createProgram(gl, bubbleVert, bubbleFrag);

    // ── Background VAO (attribute-less fullscreen triangle) ──
    this.bgVao = gl.createVertexArray()!;

    // ── Bubble VAO ──
    this.bubbleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.bubbleVao);

    // Static quad corners (two triangles)
    const corners = new Float32Array([
      -1, -1,  1, -1,  1, 1,
      -1, -1,  1,  1, -1, 1,
    ]);
    const cornerBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Dynamic instance buffer
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1); // per-instance

    gl.bindVertexArray(null);

    // ── Pointer listeners ──
    this.onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointerActive = true;
      this.updatePointerPx(e, canvas);
    };
    this.onMove = (e: PointerEvent) => {
      this.updatePointerPx(e, canvas);
    };
    this.onUp = (_e: PointerEvent) => {
      this.pointerActive = false;
    };

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.style.touchAction = 'none';

    this.bubbles = [];
    this.spawnAccum = 0;
  }

  private updatePointerPx(e: PointerEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.pointerPx = [
      (e.clientX - rect.left) * dpr,
      (e.clientY - rect.top) * dpr,
    ];
  }

  // ── Render (called every frame) ─────────────────────────────────

  render(ctx: EngineContext) {
    const { gl } = ctx;

    this.spawnBubbles(ctx);
    this.updatePhysics(ctx);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Draw background
    gl.bindVertexArray(this.bgVao);
    gl.useProgram(this.bgProgram);
    gl.uniform1f(gl.getUniformLocation(this.bgProgram, 'u_time'), ctx.time);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Draw bubbles
    const count = this.bubbles.length;
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const b = this.bubbles[i];
        const j = i * 4;
        this.instanceData[j] = b.x;
        this.instanceData[j + 1] = b.y;
        this.instanceData[j + 2] = b.radius;
        this.instanceData[j + 3] = b.opacity;
      }

      gl.bindVertexArray(this.bubbleVao);
      gl.useProgram(this.bubbleProgram);
      gl.uniform2f(
        gl.getUniformLocation(this.bubbleProgram, 'u_resolution'),
        ctx.width,
        ctx.height,
      );

      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData, 0, count * 4);

      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    }

    gl.disable(gl.BLEND);
  }

  // ── Spawn ───────────────────────────────────────────────────────

  private spawnBubbles(ctx: EngineContext) {
    this.spawnAccum += SPAWN_RATE_PER_SEC * ctx.dt;
    // Cap backlog so hidden tabs don't unleash a flood on return
    if (this.spawnAccum > 5) this.spawnAccum = 5;

    while (this.spawnAccum >= 1 && this.bubbles.length < MAX_BUBBLES) {
      this.spawnAccum -= 1;
      const radius = BUBBLE_MIN_R + Math.random() * (BUBBLE_MAX_R - BUBBLE_MIN_R);
      this.bubbles.push({
        x: Math.random() * ctx.width,
        y: ctx.height + radius,
        vx: (Math.random() - 0.5) * INIT_VX_SPREAD,
        vy: -(INIT_VY_MIN + Math.random() * INIT_VY_SPREAD),
        radius,
        wobblePhase: Math.random() * Math.PI * 2,
        opacity: 0.25 + Math.random() * 0.4,
      });
    }
  }

  // ── Physics ─────────────────────────────────────────────────────

  private updatePhysics(ctx: EngineContext) {
    const dt = Math.min(ctx.dt, 0.033);
    const [cx, cy] = this.pointerPx;
    const cr = this.circleR;
    const bubbles = this.bubbles;
    const n = bubbles.length;
    const fx = this.fxBuf;
    const fy = this.fyBuf;

    // Zero force buffers
    for (let i = 0; i < n; i++) { fx[i] = 0; fy[i] = 0; }

    // 1. Buoyancy + wobble + turbulence + linear drag
    for (let i = 0; i < n; i++) {
      const b = bubbles[i];
      fy[i] -= BUOYANCY;
      fx[i] += Math.sin(ctx.time * WOBBLE_FREQ + b.wobblePhase) * WOBBLE_AMP;
      // Slower, decorrelated lateral drift for a more natural rise
      fx[i] += Math.sin(ctx.time * TURBULENCE_FREQ + b.wobblePhase * 1.7) * TURBULENCE_AMP;
      fy[i] += Math.cos(ctx.time * TURBULENCE_FREQ * 0.6 + b.wobblePhase * 2.3) * TURBULENCE_VY_AMP;
      fx[i] -= DRAG_COEF * b.vx;
      fy[i] -= DRAG_COEF * b.vy;
    }

    // 2. Pointer adhesion (outside surface) + interior repulsion
    if (this.pointerActive) {
      for (let i = 0; i < n; i++) {
        const b = bubbles[i];
        const dx = b.x - cx;
        const dy = b.y - cy;
        const d = Math.hypot(dx, dy) || 1e-4;
        const surfGap = d - (cr + b.radius);
        const nx = dx / d;
        const ny = dy / d;

        if (surfGap < 0) {
          // Stiff interior wall — bubbles should not enter the circle
          const push = REPULSE_STRENGTH * (-surfGap / REPULSE_DEPTH + 1);
          fx[i] += nx * push;
          fy[i] += ny * push;
        } else if (surfGap < ADHESION_RANGE) {
          // Weak attraction toward the surface, fading with distance
          const pull = ADHESION_STRENGTH * (1 - surfGap / ADHESION_RANGE);
          fx[i] -= nx * pull;
          fy[i] -= ny * pull;
        }
      }
    }

    // 3. Cohesion + separation + contact damping (O(n²) with cheap early-out)
    for (let i = 0; i < n; i++) {
      const a = bubbles[i];
      for (let j = i + 1; j < n; j++) {
        const b = bubbles[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const rSum = a.radius + b.radius;
        const cohR = COHESION_RADIUS + rSum;
        if (d2 > cohR * cohR) continue;
        const d = Math.sqrt(d2) || 1e-4;
        const nx = dx / d;
        const ny = dy / d;

        if (d < rSum) {
          // Inelastic contact: resolve overlap in position (no spring to store
          // elastic energy) and absorb the approaching component of relative
          // velocity — the "squish" takes the momentum.
          const corr = (rSum - d) * POSITION_CORRECTION * 0.5;
          a.x -= nx * corr; a.y -= ny * corr;
          b.x += nx * corr; b.y += ny * corr;

          const rvx = b.vx - a.vx;
          const rvy = b.vy - a.vy;
          const vn = rvx * nx + rvy * ny;
          if (vn < 0) {
            // Approaching each other: damp normal velocity (restitution ≈ 0)
            const jn = vn * (1 + COLLISION_RESTITUTION) * 0.5;
            a.vx += nx * jn; a.vy += ny * jn;
            b.vx -= nx * jn; b.vy -= ny * jn;
          }
          // Tangential (shear) damping — simulates viscous film at the contact
          const tvx = rvx - nx * vn;
          const tvy = rvy - ny * vn;
          const jt = TANGENT_DAMPING * 0.5;
          a.vx += tvx * jt; a.vy += tvy * jt;
          b.vx -= tvx * jt; b.vy -= tvy * jt;
        } else {
          // Soft cohesion in the near band
          const c = COHESION_STRENGTH * (1 - (d - rSum) / COHESION_RADIUS);
          fx[i] += nx * c; fy[i] += ny * c;
          fx[j] -= nx * c; fy[j] -= ny * c;
        }
      }
    }

    // 4. Integrate
    for (let i = n - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.vx += fx[i] * dt;
      b.vy += fy[i] * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Wrap horizontally
      if (b.x < -b.radius) b.x = ctx.width + b.radius;
      if (b.x > ctx.width + b.radius) b.x = -b.radius;

      // Remove if above top
      if (b.y < -b.radius * 2) {
        bubbles.splice(i, 1);
      }
    }
  }

  // ── Destroy ─────────────────────────────────────────────────────

  destroy(ctx: EngineContext) {
    const { gl, canvas } = ctx;
    gl.deleteProgram(this.bgProgram);
    gl.deleteProgram(this.bubbleProgram);
    gl.deleteVertexArray(this.bgVao);
    gl.deleteVertexArray(this.bubbleVao);
    gl.deleteBuffer(this.instanceBuffer);

    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onUp);

    this.bubbles = [];
  }
}
