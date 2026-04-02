import { Plugin } from '../../plugin/Plugin';
import { EngineContext } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import quadVert from '../../shaders/fullscreen-quad.vert';
import backgroundFrag from './background.glsl';
import bubbleVert from './bubble.vert';
import bubbleFrag from './bubble.frag';

// ── Tuning constants ────────────────────────────────────────────────
const MAX_BUBBLES = 400;
const SPAWN_RATE = 3;              // bubbles per frame
const BUBBLE_MIN_R = 2.5;
const BUBBLE_MAX_R = 7;
const BUOYANCY = 60;               // px/s²
const WOBBLE_FREQ = 2.5;
const WOBBLE_AMP = 18;             // px/s
const DRAG = 0.985;
const CURSOR_CIRCLE_R = 70;        // px (CSS)
const REPULSE_RANGE = 1.6;         // × circle radius
const REPULSE_STRENGTH = 400;      // px/s²
const STICK_ANGLE_MAX = Math.PI / 3;  // 60° from bottom
const DETACH_SPEED = 40;           // px/s upward kick on release

// ── Bubble data ─────────────────────────────────────────────────────

interface Bubble {
  x: number; y: number;
  vx: number; vy: number;
  radius: number;
  wobblePhase: number;
  opacity: number;
  stuck: boolean;
  /** 'circle' = stuck to cursor circle, or index of layer-1 bubble */
  stuckTo: 'circle' | number;
  /** Angle on the parent where this bubble is attached (0 = straight down) */
  stuckAngle: number;
  /** 0 = free, 1 = on circle, 2 = on a layer-1 bubble */
  stuckLayer: 0 | 1 | 2;
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
      this.releaseBubbles();
    };

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.style.touchAction = 'none';

    this.bubbles = [];
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
    if (this.bubbles.length >= MAX_BUBBLES) return;
    for (let i = 0; i < SPAWN_RATE; i++) {
      if (this.bubbles.length >= MAX_BUBBLES) break;
      const radius = BUBBLE_MIN_R + Math.random() * (BUBBLE_MAX_R - BUBBLE_MIN_R);
      this.bubbles.push({
        x: Math.random() * ctx.width,
        y: ctx.height + radius, // start just below bottom edge
        vx: (Math.random() - 0.5) * 10,
        vy: -(20 + Math.random() * 30), // initial upward speed
        radius,
        wobblePhase: Math.random() * Math.PI * 2,
        opacity: 0.25 + Math.random() * 0.4,
        stuck: false,
        stuckTo: 'circle',
        stuckAngle: 0,
        stuckLayer: 0,
      });
    }
  }

  // ── Physics ─────────────────────────────────────────────────────

  private updatePhysics(ctx: EngineContext) {
    const dt = Math.min(ctx.dt, 0.05); // clamp large dt
    const [cx, cy] = this.pointerPx;
    const cr = this.circleR;

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];

      if (b.stuck) {
        this.updateStuckBubble(b, i);
        continue;
      }

      // Buoyancy
      b.vy -= BUOYANCY * dt;

      // Wobble
      b.vx += Math.sin(ctx.time * WOBBLE_FREQ + b.wobblePhase) * WOBBLE_AMP * dt;

      // Drag
      b.vx *= DRAG;
      b.vy *= DRAG;

      // Pointer interaction
      if (this.pointerActive) {
        const dx = b.x - cx;
        const dy = b.y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const touchDist = cr + b.radius;
        const repulseDist = cr * REPULSE_RANGE;

        // Check sticking: bubble is below cursor and rising toward it
        if (b.vy < 0 && dy > 0 && dist < touchDist + 4) {
          // Angle from cursor center to bubble, measured from straight down (0 = directly below)
          const angle = Math.atan2(dx, dy); // note: atan2(x, y) gives angle from +y axis
          if (Math.abs(angle) < STICK_ANGLE_MAX) {
            if (this.tryStickToCircle(b, i, angle)) continue;
          }
        }

        // Check sticking to layer-1 bubbles (forming layer 2)
        if (b.vy < 0 && this.pointerActive) {
          if (this.tryStickToLayer1(b, i)) continue;
        }

        // Repulsion (push away from circle)
        if (dist < repulseDist && dist > 0.1) {
          const force = REPULSE_STRENGTH * (1.0 - dist / repulseDist);
          b.vx += (dx / dist) * force * dt;
          b.vy += (dy / dist) * force * dt;
        }
      }

      // Integrate position
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Wrap horizontally
      if (b.x < -b.radius) b.x = ctx.width + b.radius;
      if (b.x > ctx.width + b.radius) b.x = -b.radius;

      // Remove if above top
      if (b.y < -b.radius * 2) {
        this.bubbles.splice(i, 1);
      }
    }
  }

  private tryStickToCircle(b: Bubble, _index: number, angle: number): boolean {
    // Count how many layer-1 bubbles are near this angle
    let nearby = 0;
    for (const other of this.bubbles) {
      if (other.stuck && other.stuckLayer === 1) {
        const angleDiff = Math.abs(other.stuckAngle - angle);
        // Check if too close to existing stuck bubble
        if (angleDiff < (b.radius + other.radius) / this.circleR * 0.9) {
          nearby++;
        }
      }
    }
    // Don't stack too densely
    if (nearby > 0) return false;

    b.stuck = true;
    b.stuckTo = 'circle';
    b.stuckAngle = angle;
    b.stuckLayer = 1;
    b.vx = 0;
    b.vy = 0;
    return true;
  }

  private tryStickToLayer1(b: Bubble, _index: number): boolean {
    const [cx, cy] = this.pointerPx;

    for (let j = 0; j < this.bubbles.length; j++) {
      const parent = this.bubbles[j];
      if (!parent.stuck || parent.stuckLayer !== 1) continue;

      const dx = b.x - parent.x;
      const dy = b.y - parent.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const touchDist = b.radius + parent.radius;

      if (dist < touchDist + 3 && dy > 0 && b.vy < 0) {
        // Angle from parent center to bubble, from straight down
        const angle = Math.atan2(dx, dy);
        if (Math.abs(angle) > STICK_ANGLE_MAX) continue;

        // Check the contact point relative to the cursor circle is still
        // in the lower hemisphere (tangent near horizontal)
        const contactX = parent.x + Math.sin(angle) * touchDist;
        const contactY = parent.y + Math.cos(angle) * touchDist;
        const dcx = contactX - cx;
        const dcy = contactY - cy;
        const contactAngle = Math.atan2(dcx, dcy);
        if (Math.abs(contactAngle) > STICK_ANGLE_MAX * 1.2) continue;

        // Check layer-2 density near this parent
        let layer2Count = 0;
        for (const o of this.bubbles) {
          if (o.stuck && o.stuckLayer === 2 && o.stuckTo === j) layer2Count++;
        }
        if (layer2Count >= 2) continue;

        b.stuck = true;
        b.stuckTo = j;
        b.stuckAngle = angle;
        b.stuckLayer = 2;
        b.vx = 0;
        b.vy = 0;
        return true;
      }
    }
    return false;
  }

  private updateStuckBubble(b: Bubble, index: number) {
    if (b.stuckLayer === 1) {
      // Attached to cursor circle
      const [cx, cy] = this.pointerPx;
      const dist = this.circleR + b.radius;
      // stuckAngle: 0 = directly below, positive = right
      b.x = cx + Math.sin(b.stuckAngle) * dist;
      b.y = cy + Math.cos(b.stuckAngle) * dist;
    } else if (b.stuckLayer === 2 && typeof b.stuckTo === 'number') {
      const parent = this.bubbles[b.stuckTo];
      if (!parent || !parent.stuck) {
        // Parent detached — detach this too
        b.stuck = false;
        b.stuckLayer = 0;
        b.vy = -(DETACH_SPEED * 0.5);
        return;
      }
      const dist = parent.radius + b.radius;
      b.x = parent.x + Math.sin(b.stuckAngle) * dist;
      b.y = parent.y + Math.cos(b.stuckAngle) * dist;
    }

    // If pointer released while iterating, unstick was already called,
    // but guard against stale index references
    if (!this.pointerActive && b.stuck) {
      b.stuck = false;
      b.stuckLayer = 0;
      b.vy = -(DETACH_SPEED + Math.random() * 15);
      b.vx = (Math.random() - 0.5) * 20;
    }
  }

  private releaseBubbles() {
    for (const b of this.bubbles) {
      if (!b.stuck) continue;
      b.stuck = false;
      b.stuckLayer = 0;
      b.vy = -(DETACH_SPEED + Math.random() * 20);
      b.vx = (Math.random() - 0.5) * 30;
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
