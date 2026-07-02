import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { ParamSlider } from '../../engine/ParamSlider';
import fragmentSrc from './display.glsl';

// ── Ripple entities ─────────────────────────────────────────────────
// The Windaria look is not a wave simulation: each ripple is a discrete
// hand-inked ellipse (or spiral) drawn on a flat painted pond. We keep a
// small list of ripples on the CPU and evaluate them analytically in a
// single fragment pass — no ping-pong FBO, no heightfield.

const MAX_RIPPLES = 48; // must match display.glsl

const KIND_SMALL = 0;  // rain drop: 2 small rings
const KIND_TAP = 1;    // tap: 3 larger rings
const KIND_SPIRAL = 2; // anime spiral shorthand for dense concentric rings

const SPIRAL_TAP_CHANCE = 0.3;
const RAIN_MAX_DROPS_PER_SEC = 10;
const DRAG_SPAWN_SPACING = 0.07; // UV distance between drops along a drag

interface Ripple {
  x: number;      // UV, origin bottom-left
  y: number;
  birth: number;  // engine time (seconds)
  w: number;      // kind + fractional seed, decoded in the shader
}

export class RippleDropPlugin extends FragmentShaderPlugin {
  readonly name = 'Ripple Drop';

  private sliders!: ParamSlider;
  private ripples: Ripple[] = [];
  private rippleData = new Float32Array(MAX_RIPPLES * 4);
  private locs: Record<string, WebGLUniformLocation | null> | null = null;

  // Parameters (live-adjustable)
  private rain = 0.45;
  private squash = 0.35;
  private life = 4.5;
  private strokeWidth = 2.6;

  // Spawn state
  private rainAccum = 0;
  private lastDragSpawn: [number, number] | null = null;

  protected fragmentSource() {
    return fragmentSrc;
  }

  init(ctx: EngineContext) {
    super.init(ctx);
    this.ripples = [];
    this.rainAccum = 0;
    this.locs = null;

    this.sliders = new ParamSlider();
    this.sliders.addSlider({
      label: 'Rain', min: 0.0, max: 1.0, value: this.rain, step: 0.05,
      onChange: (v) => { this.rain = v; },
    });
    this.sliders.addSlider({
      label: 'Perspective', min: 0.15, max: 1.0, value: this.squash, step: 0.01,
      onChange: (v) => { this.squash = v; },
    });
    this.sliders.addSlider({
      label: 'Lifetime', min: 2.0, max: 8.0, value: this.life, step: 0.1,
      onChange: (v) => { this.life = v; },
    });
    this.sliders.addSlider({
      label: 'Stroke Width', min: 1.0, max: 4.0, value: this.strokeWidth, step: 0.1,
      onChange: (v) => { this.strokeWidth = v; },
    });
  }

  render(ctx: EngineContext) {
    // Ambient rain: Poisson-ish spawning, framerate-independent
    this.rainAccum += this.rain * RAIN_MAX_DROPS_PER_SEC * ctx.dt;
    while (this.rainAccum >= 1) {
      this.rainAccum -= 1;
      this.spawn(0.03 + Math.random() * 0.94, 0.08 + Math.random() * 0.87, KIND_SMALL, ctx.time);
    }

    // Prune expired ripples
    if (this.ripples.length > 0 && ctx.time - this.ripples[0].birth > this.life) {
      this.ripples = this.ripples.filter((r) => ctx.time - r.birth <= this.life);
    }

    super.render(ctx);
  }

  protected setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, _ctx: EngineContext) {
    if (!this.locs) {
      this.locs = {
        u_ripples: gl.getUniformLocation(program, 'u_ripples[0]'),
        u_count: gl.getUniformLocation(program, 'u_count'),
        u_squash: gl.getUniformLocation(program, 'u_squash'),
        u_life: gl.getUniformLocation(program, 'u_life'),
        u_strokeWidth: gl.getUniformLocation(program, 'u_strokeWidth'),
        u_rain: gl.getUniformLocation(program, 'u_rain'),
      };
    }

    const n = this.ripples.length;
    for (let i = 0; i < n; i++) {
      const r = this.ripples[i];
      const j = i * 4;
      this.rippleData[j] = r.x;
      this.rippleData[j + 1] = r.y;
      this.rippleData[j + 2] = r.birth;
      this.rippleData[j + 3] = r.w;
    }

    gl.uniform4fv(this.locs.u_ripples, this.rippleData);
    gl.uniform1i(this.locs.u_count, n);
    gl.uniform1f(this.locs.u_squash, this.squash);
    gl.uniform1f(this.locs.u_life, this.life);
    gl.uniform1f(this.locs.u_strokeWidth, this.strokeWidth);
    gl.uniform1f(this.locs.u_rain, this.rain);
  }

  onGesture(ctx: EngineContext, event: GestureEvent) {
    const x = event.pos.x;
    const y = 1.0 - event.pos.y; // shader UV origin is bottom-left

    if (event.type === 'tap') {
      const kind = Math.random() < SPIRAL_TAP_CHANCE ? KIND_SPIRAL : KIND_TAP;
      this.spawn(x, y, kind, ctx.time);
    } else if (event.type === 'drag-start') {
      this.spawn(x, y, KIND_TAP, ctx.time);
      this.lastDragSpawn = [x, y];
    } else if (event.type === 'drag-move' && this.lastDragSpawn) {
      const dx = x - this.lastDragSpawn[0];
      const dy = y - this.lastDragSpawn[1];
      if (Math.hypot(dx, dy) > DRAG_SPAWN_SPACING) {
        this.spawn(x, y, KIND_SMALL, ctx.time);
        this.lastDragSpawn = [x, y];
      }
    } else if (event.type === 'drag-end') {
      this.lastDragSpawn = null;
    }
  }

  private spawn(x: number, y: number, kind: number, time: number) {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    // Seed lives in the fractional part; keep it away from 0/1 so
    // floor()/fract() in the shader decode the kind reliably.
    this.ripples.push({ x, y, birth: time, w: kind + 0.05 + Math.random() * 0.9 });
  }

  destroy(ctx: EngineContext) {
    super.destroy(ctx);
    this.sliders.destroy();
    this.ripples = [];
  }
}
