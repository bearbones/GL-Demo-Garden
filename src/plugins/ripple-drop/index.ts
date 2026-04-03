import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { ParamSlider } from '../../engine/ParamSlider';

import quadVert from '../../shaders/fullscreen-quad.vert';
import simulateFrag from './simulate.glsl';
import displayFrag from './display.glsl';

// --- Tunable Constants ---
const SIM_SCALE = 0.5;            // simulation runs at half resolution
const STEPS_PER_FRAME = 3;        // simulation substeps per render frame
const DROP_STRENGTH = 0.4;        // impulse strength for click/tap
const CONTINUOUS_STRENGTH = 0.15; // impulse strength during drag

// --- Default slider values ---
const DEFAULT_STROKE_WIDTH = 0.45;
const DEFAULT_BREAK_FREQ = 3.5;
const DEFAULT_DAMPING = 0.996;
const DEFAULT_WAVE_SPEED = 0.35;

export class RippleDropPlugin implements Plugin {
  readonly name = 'Ripple Drop';

  private simProgram: WebGLProgram | null = null;
  private displayProgram: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private fbo: PingPongFBO | null = null;
  private sliders: ParamSlider | null = null;

  // Pending drop position (normalized 0–1), or null if no drop this frame
  private pendingDrop: [number, number] | null = null;
  private isDragging = false;
  private dragPos: [number, number] = [0.5, 0.5];

  init(ctx: EngineContext) {
    const { gl } = ctx;

    this.simProgram = createProgram(gl, quadVert, simulateFrag);
    this.displayProgram = createProgram(gl, quadVert, displayFrag);
    this.vao = gl.createVertexArray();

    const simW = Math.floor(ctx.width * SIM_SCALE);
    const simH = Math.floor(ctx.height * SIM_SCALE);
    this.fbo = new PingPongFBO(gl, simW, simH);

    // Set up sliders
    this.sliders = new ParamSlider();
    this.sliders.add({ label: 'Stroke Width', min: 0.1, max: 1.0, step: 0.01, value: DEFAULT_STROKE_WIDTH });
    this.sliders.add({ label: 'Break Freq', min: 0.5, max: 8.0, step: 0.1, value: DEFAULT_BREAK_FREQ });
    this.sliders.add({ label: 'Damping', min: 0.980, max: 0.999, step: 0.001, value: DEFAULT_DAMPING });
    this.sliders.add({ label: 'Wave Speed', min: 0.1, max: 0.6, step: 0.01, value: DEFAULT_WAVE_SPEED });
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    if (!this.simProgram || !this.displayProgram || !this.fbo || !this.vao || !this.sliders) return;

    const simW = this.fbo.width;
    const simH = this.fbo.height;

    const damping = this.sliders.get('Damping');
    const waveSpeed = this.sliders.get('Wave Speed');

    // --- Simulation passes ---
    gl.useProgram(this.simProgram);
    gl.bindVertexArray(this.vao);

    const uStateSim = gl.getUniformLocation(this.simProgram, 'u_state');
    const uResSim = gl.getUniformLocation(this.simProgram, 'u_resolution');
    const uDamping = gl.getUniformLocation(this.simProgram, 'u_damping');
    const uWaveSpeed = gl.getUniformLocation(this.simProgram, 'u_waveSpeed');
    const uDropPos = gl.getUniformLocation(this.simProgram, 'u_dropPos');
    const uDropStrength = gl.getUniformLocation(this.simProgram, 'u_dropStrength');

    gl.uniform2f(uResSim, simW, simH);
    gl.uniform1f(uDamping, damping);
    gl.uniform1f(uWaveSpeed, waveSpeed);

    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      // Only add drop on first substep
      if (i === 0) {
        if (this.pendingDrop) {
          gl.uniform2f(uDropPos, this.pendingDrop[0], this.pendingDrop[1]);
          gl.uniform1f(uDropStrength, DROP_STRENGTH);
          this.pendingDrop = null;
        } else if (this.isDragging) {
          gl.uniform2f(uDropPos, this.dragPos[0], this.dragPos[1]);
          gl.uniform1f(uDropStrength, CONTINUOUS_STRENGTH);
        } else {
          gl.uniform2f(uDropPos, -1.0, -1.0); // no drop
          gl.uniform1f(uDropStrength, 0.0);
        }
      } else {
        gl.uniform2f(uDropPos, -1.0, -1.0);
        gl.uniform1f(uDropStrength, 0.0);
      }

      this.fbo.bindRead(gl, 0);
      gl.uniform1i(uStateSim, 0);
      this.fbo.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.fbo.swap();
    }

    // --- Display pass ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.displayProgram);

    this.fbo.bindRead(gl, 0);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, 'u_state'), 0);
    gl.uniform2f(gl.getUniformLocation(this.displayProgram, 'u_resolution'), ctx.width, ctx.height);
    gl.uniform1f(gl.getUniformLocation(this.displayProgram, 'u_time'), ctx.time);
    gl.uniform1f(gl.getUniformLocation(this.displayProgram, 'u_strokeWidth'), this.sliders.get('Stroke Width'));
    gl.uniform1f(gl.getUniformLocation(this.displayProgram, 'u_breakFrequency'), this.sliders.get('Break Freq'));
    gl.uniform1f(gl.getUniformLocation(this.displayProgram, 'u_damping'), damping);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    // Flip y: PointerPos has y=0 at top, but our UVs have y=0 at bottom
    const x = event.pos.x;
    const y = 1.0 - event.pos.y;

    switch (event.type) {
      case 'tap':
        this.pendingDrop = [x, y];
        break;
      case 'drag-start':
        this.isDragging = true;
        this.dragPos = [x, y];
        this.pendingDrop = [x, y];
        break;
      case 'drag-move':
        this.dragPos = [x, y];
        break;
      case 'drag-end':
        this.isDragging = false;
        break;
    }
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    if (this.simProgram) gl.deleteProgram(this.simProgram);
    if (this.displayProgram) gl.deleteProgram(this.displayProgram);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.fbo) this.fbo.destroy(gl);
    if (this.sliders) this.sliders.destroy();
    this.simProgram = null;
    this.displayProgram = null;
    this.vao = null;
    this.fbo = null;
    this.sliders = null;
  }
}
