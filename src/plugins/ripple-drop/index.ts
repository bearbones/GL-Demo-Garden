import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import simulateFrag from './simulate.glsl';
import displayFrag from './display.glsl';

// ── Constants ───────────────────────────────────────────────────────
const SIM_SCALE = 0.5; // simulation runs at half resolution

export class RippleDropPlugin implements Plugin {
  readonly name = 'Ripple Drop';

  private simProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private fbo!: PingPongFBO;
  private sliders!: ParamSlider;

  // Uniforms
  private simUniforms!: Record<string, WebGLUniformLocation | null>;
  private dispUniforms!: Record<string, WebGLUniformLocation | null>;

  // Parameters (live-adjustable)
  private strokeWidth = 1.0;
  private breakFreq = 6.0;
  private damping = 0.995;
  private waveSpeed = 0.45;

  // Interaction state
  private pendingImpulse: [number, number] | null = null;
  private dragging = false;
  private dragPos: [number, number] = [0, 0];

  init(ctx: EngineContext) {
    const { gl } = ctx;

    this.simProgram = createProgram(gl, quadVert, simulateFrag);
    this.displayProgram = createProgram(gl, quadVert, displayFrag);
    this.vao = gl.createVertexArray()!;

    const simW = Math.floor(ctx.width * SIM_SCALE);
    const simH = Math.floor(ctx.height * SIM_SCALE);
    this.fbo = new PingPongFBO(gl, simW, simH);

    // Cache uniform locations
    this.simUniforms = this.getUniforms(gl, this.simProgram, [
      'u_prevState', 'u_resolution', 'u_damping', 'u_waveSpeed',
      'u_impulsePos', 'u_impulseStrength',
    ]);
    this.dispUniforms = this.getUniforms(gl, this.displayProgram, [
      'u_heightfield', 'u_resolution', 'u_time', 'u_strokeWidth', 'u_breakFreq',
    ]);

    // Slider UI
    this.sliders = new ParamSlider();
    this.sliders.addSlider({
      label: 'Stroke Width', min: 0.2, max: 3.0, value: this.strokeWidth,
      onChange: (v) => { this.strokeWidth = v; },
    });
    this.sliders.addSlider({
      label: 'Break Freq', min: 1.0, max: 15.0, value: this.breakFreq,
      onChange: (v) => { this.breakFreq = v; },
    });
    this.sliders.addSlider({
      label: 'Damping', min: 0.98, max: 1.0, value: this.damping, step: 0.001,
      onChange: (v) => { this.damping = v; },
    });
    this.sliders.addSlider({
      label: 'Wave Speed', min: 0.1, max: 0.8, value: this.waveSpeed,
      onChange: (v) => { this.waveSpeed = v; },
    });
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;

    // ── Simulation pass ──
    gl.useProgram(this.simProgram);
    this.fbo.bindRead(gl, 0);
    gl.uniform1i(this.simUniforms.u_prevState, 0);
    gl.uniform2f(this.simUniforms.u_resolution, this.fbo.width, this.fbo.height);
    gl.uniform1f(this.simUniforms.u_damping, this.damping);
    gl.uniform1f(this.simUniforms.u_waveSpeed, this.waveSpeed);

    // Handle impulse from click/tap
    if (this.pendingImpulse) {
      gl.uniform2f(this.simUniforms.u_impulsePos, this.pendingImpulse[0], this.pendingImpulse[1]);
      gl.uniform1f(this.simUniforms.u_impulseStrength, 0.5);
      this.pendingImpulse = null;
    } else if (this.dragging) {
      gl.uniform2f(this.simUniforms.u_impulsePos, this.dragPos[0], this.dragPos[1]);
      gl.uniform1f(this.simUniforms.u_impulseStrength, 0.15);
    } else {
      gl.uniform2f(this.simUniforms.u_impulsePos, -1.0, -1.0);
      gl.uniform1f(this.simUniforms.u_impulseStrength, 0.0);
    }

    this.fbo.bindWrite(gl);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.fbo.swap();

    // ── Display pass ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.displayProgram);

    this.fbo.bindRead(gl, 0);
    gl.uniform1i(this.dispUniforms.u_heightfield, 0);
    gl.uniform2f(this.dispUniforms.u_resolution, ctx.width, ctx.height);
    gl.uniform1f(this.dispUniforms.u_time, ctx.time);
    gl.uniform1f(this.dispUniforms.u_strokeWidth, this.strokeWidth);
    gl.uniform1f(this.dispUniforms.u_breakFreq, this.breakFreq);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    const uv: [number, number] = [event.pos.x, 1.0 - event.pos.y];
    if (event.type === 'tap') {
      this.pendingImpulse = uv;
    } else if (event.type === 'drag-start') {
      this.dragging = true;
      this.dragPos = uv;
      this.pendingImpulse = uv;
    } else if (event.type === 'drag-move') {
      this.dragPos = uv;
    } else if (event.type === 'drag-end') {
      this.dragging = false;
    }
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.simProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteVertexArray(this.vao);
    this.fbo.destroy(gl);
    this.sliders.destroy();
  }

  private getUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    names: string[],
  ): Record<string, WebGLUniformLocation | null> {
    const out: Record<string, WebGLUniformLocation | null> = {};
    for (const name of names) {
      out[name] = gl.getUniformLocation(program, name);
    }
    return out;
  }
}
