import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { ParamSlider } from '../../engine/ParamSlider';

import quadVert from '../../shaders/fullscreen-quad.vert';
import wakeSim from './wake-sim.glsl';
import displayFrag from './display.glsl';

// --- Constants ---
const SIM_SCALE = 0.5;
const STEPS_PER_FRAME = 2;

// Auto-pilot S-curve parameters
const AUTOPILOT_SPEED = 0.08;       // units/sec
const AUTOPILOT_AMPLITUDE = 0.15;   // horizontal sway
const AUTOPILOT_FREQ = 0.3;         // sway frequency

// Default slider values
const DEFAULT_BOAT_SPEED = 0.10;
const DEFAULT_FOAM_DECAY = 1.5;
const DEFAULT_CURL_INTENSITY = 1.0;
const DEFAULT_STROKE_BOLD = 0.5;

export class BoatWakePlugin implements Plugin {
  readonly name = 'Boat Wake';

  private simProgram: WebGLProgram | null = null;
  private displayProgram: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private fbo: PingPongFBO | null = null;
  private sliders: ParamSlider | null = null;

  // Boat state
  private boatPos: [number, number] = [0.5, 0.3];
  private boatVel: [number, number] = [0.0, 0.05];
  private isManual = false;
  private manualTarget: [number, number] = [0.5, 0.5];
  private idleTimer = 0;

  init(ctx: EngineContext) {
    const { gl } = ctx;

    this.simProgram = createProgram(gl, quadVert, wakeSim);
    this.displayProgram = createProgram(gl, quadVert, displayFrag);
    this.vao = gl.createVertexArray();

    const simW = Math.floor(ctx.width * SIM_SCALE);
    const simH = Math.floor(ctx.height * SIM_SCALE);
    this.fbo = new PingPongFBO(gl, simW, simH);

    this.sliders = new ParamSlider();
    this.sliders.add({ label: 'Boat Speed', min: 0.02, max: 0.25, step: 0.01, value: DEFAULT_BOAT_SPEED });
    this.sliders.add({ label: 'Foam Decay', min: 0.3, max: 4.0, step: 0.1, value: DEFAULT_FOAM_DECAY });
    this.sliders.add({ label: 'Curl', min: 0.0, max: 3.0, step: 0.1, value: DEFAULT_CURL_INTENSITY });
    this.sliders.add({ label: 'Stroke Bold', min: 0.1, max: 1.5, step: 0.05, value: DEFAULT_STROKE_BOLD });
  }

  private updateBoat(dt: number, time: number) {
    if (!this.sliders) return;
    const speed = this.sliders.get('Boat Speed');

    if (this.isManual) {
      // Steer toward manual target
      const dx = this.manualTarget[0] - this.boatPos[0];
      const dy = this.manualTarget[1] - this.boatPos[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.005) {
        this.boatVel[0] = (dx / dist) * speed;
        this.boatVel[1] = (dy / dist) * speed;
      }
    } else {
      // Auto-pilot: gentle S-curve moving upward
      const headingY = speed;
      const headingX = Math.cos(time * AUTOPILOT_FREQ * Math.PI * 2) * AUTOPILOT_AMPLITUDE * speed;
      this.boatVel[0] = headingX;
      this.boatVel[1] = headingY;
    }

    this.boatPos[0] += this.boatVel[0] * dt;
    this.boatPos[1] += this.boatVel[1] * dt;

    // Wrap: when boat goes off top, reappear at bottom
    if (this.boatPos[1] > 1.05) {
      this.boatPos[1] = -0.05;
    }
    if (this.boatPos[1] < -0.05) {
      this.boatPos[1] = 1.05;
    }
    // Wrap horizontal
    if (this.boatPos[0] > 1.1) this.boatPos[0] = -0.1;
    if (this.boatPos[0] < -0.1) this.boatPos[0] = 1.1;
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    if (!this.simProgram || !this.displayProgram || !this.fbo || !this.vao || !this.sliders) return;

    const dt = Math.min(ctx.dt, 0.05);

    // Update idle timer
    if (this.isManual) {
      this.idleTimer += dt;
      if (this.idleTimer > 3.0) {
        this.isManual = false;
      }
    }

    this.updateBoat(dt, ctx.time);

    const speed = Math.sqrt(this.boatVel[0] ** 2 + this.boatVel[1] ** 2);
    const foamDecay = this.sliders.get('Foam Decay');
    const curlIntensity = this.sliders.get('Curl');

    gl.bindVertexArray(this.vao);

    // --- Simulation passes ---
    gl.useProgram(this.simProgram);
    const simW = this.fbo.width;
    const simH = this.fbo.height;

    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      this.fbo.bindRead(gl, 0);
      gl.uniform1i(gl.getUniformLocation(this.simProgram, 'u_state'), 0);
      gl.uniform2f(gl.getUniformLocation(this.simProgram, 'u_resolution'), simW, simH);
      gl.uniform1f(gl.getUniformLocation(this.simProgram, 'u_time'), ctx.time);
      gl.uniform1f(gl.getUniformLocation(this.simProgram, 'u_dt'), dt / STEPS_PER_FRAME);
      gl.uniform2f(gl.getUniformLocation(this.simProgram, 'u_boatPos'), this.boatPos[0], this.boatPos[1]);
      gl.uniform2f(gl.getUniformLocation(this.simProgram, 'u_boatVel'), this.boatVel[0], this.boatVel[1]);
      gl.uniform1f(gl.getUniformLocation(this.simProgram, 'u_boatSpeed'), speed);
      gl.uniform1f(gl.getUniformLocation(this.simProgram, 'u_foamDecay'), foamDecay);
      gl.uniform1f(gl.getUniformLocation(this.simProgram, 'u_curlIntensity'), curlIntensity);

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
    gl.uniform1f(gl.getUniformLocation(this.displayProgram, 'u_strokeBoldness'), this.sliders.get('Stroke Bold'));
    gl.uniform2f(gl.getUniformLocation(this.displayProgram, 'u_boatPos'), this.boatPos[0], this.boatPos[1]);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    const x = event.pos.x;
    const y = 1.0 - event.pos.y;

    switch (event.type) {
      case 'tap':
        this.manualTarget = [x, y];
        this.isManual = true;
        this.idleTimer = 0;
        break;
      case 'drag-start':
      case 'drag-move':
        this.manualTarget = [x, y];
        this.isManual = true;
        this.idleTimer = 0;
        break;
      case 'drag-end':
        this.idleTimer = 0;
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
