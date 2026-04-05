import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import wakeSimFrag from './wake-sim.glsl';
import displayFrag from './display.glsl';

// ── Constants ───────────────────────────────────────────────────────
const SIM_SCALE = 0.5;

export class BoatWakePlugin implements Plugin {
  readonly name = 'Boat Wake';

  private simProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private fbo!: PingPongFBO;
  private sliders!: ParamSlider;

  // Uniforms
  private simU!: Record<string, WebGLUniformLocation | null>;
  private dispU!: Record<string, WebGLUniformLocation | null>;

  // Parameters
  private boatSpeed = 0.5;
  private foamDecay = 0.985;
  private curlIntensity = 1.0;
  private strokeBoldness = 1.0;
  private cameraZoom = 3.5;
  private whorlIntensity = 1.0;

  // Boat state
  private boatPos: [number, number] = [0.5, 0.5];
  private boatVel: [number, number] = [0, 0];
  private boatDir: [number, number] = [1, 0];
  private userControlled = false;
  private targetPos: [number, number] | null = null;

  // Auto-pilot
  private autoTime = 0;

  init(ctx: EngineContext) {
    const { gl } = ctx;

    this.simProgram = createProgram(gl, quadVert, wakeSimFrag);
    this.displayProgram = createProgram(gl, quadVert, displayFrag);
    this.vao = gl.createVertexArray()!;

    const simW = Math.floor(ctx.width * SIM_SCALE);
    const simH = Math.floor(ctx.height * SIM_SCALE);
    this.fbo = new PingPongFBO(gl, simW, simH);

    this.simU = this.getUniforms(gl, this.simProgram, [
      'u_prevFoam', 'u_resolution', 'u_boatPos', 'u_boatDir',
      'u_boatSpeed', 'u_foamDecay', 'u_curlIntensity', 'u_time',
    ]);
    this.dispU = this.getUniforms(gl, this.displayProgram, [
      'u_foam', 'u_resolution', 'u_time', 'u_strokeBoldness', 'u_boatPos',
      'u_boatDir', 'u_zoom', 'u_aspect', 'u_whorlIntensity', 'u_boatSpeed',
    ]);

    this.sliders = new ParamSlider();
    this.sliders.addSlider({
      label: 'Boat Speed', min: 0.1, max: 1.5, value: this.boatSpeed,
      onChange: (v) => { this.boatSpeed = v; },
    });
    this.sliders.addSlider({
      label: 'Foam Decay', min: 0.95, max: 1.0, value: this.foamDecay, step: 0.001,
      onChange: (v) => { this.foamDecay = v; },
    });
    this.sliders.addSlider({
      label: 'Curl Intensity', min: 0.0, max: 3.0, value: this.curlIntensity,
      onChange: (v) => { this.curlIntensity = v; },
    });
    this.sliders.addSlider({
      label: 'Stroke Bold', min: 0.2, max: 3.0, value: this.strokeBoldness,
      onChange: (v) => { this.strokeBoldness = v; },
    });
    this.sliders.addSlider({
      label: 'Camera Zoom', min: 2.0, max: 6.0, value: this.cameraZoom,
      onChange: (v) => { this.cameraZoom = v; },
    });
    this.sliders.addSlider({
      label: 'Whorl Intensity', min: 0.0, max: 2.0, value: this.whorlIntensity,
      onChange: (v) => { this.whorlIntensity = v; },
    });
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    const dt = Math.min(ctx.dt, 0.05);

    this.updateBoat(dt, ctx.time);

    gl.bindVertexArray(this.vao);

    // ── Simulation pass ──
    gl.useProgram(this.simProgram);
    this.fbo.bindRead(gl, 0);
    gl.uniform1i(this.simU.u_prevFoam, 0);
    gl.uniform2f(this.simU.u_resolution, this.fbo.width, this.fbo.height);
    gl.uniform2f(this.simU.u_boatPos, this.boatPos[0], this.boatPos[1]);
    gl.uniform2f(this.simU.u_boatDir, this.boatDir[0], this.boatDir[1]);
    gl.uniform1f(this.simU.u_boatSpeed, this.boatSpeed);
    gl.uniform1f(this.simU.u_foamDecay, this.foamDecay);
    gl.uniform1f(this.simU.u_curlIntensity, this.curlIntensity);
    gl.uniform1f(this.simU.u_time, ctx.time);

    this.fbo.bindWrite(gl);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.fbo.swap();

    // ── Display pass ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);

    gl.useProgram(this.displayProgram);
    this.fbo.bindRead(gl, 0);
    // Smooth sampling and clamp for zoomed display
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.uniform1i(this.dispU.u_foam, 0);
    gl.uniform2f(this.dispU.u_resolution, ctx.width, ctx.height);
    gl.uniform1f(this.dispU.u_time, ctx.time);
    gl.uniform1f(this.dispU.u_strokeBoldness, this.strokeBoldness);
    gl.uniform2f(this.dispU.u_boatPos, this.boatPos[0], this.boatPos[1]);
    gl.uniform2f(this.dispU.u_boatDir, this.boatDir[0], this.boatDir[1]);
    gl.uniform1f(this.dispU.u_zoom, this.cameraZoom);
    gl.uniform1f(this.dispU.u_aspect, ctx.width / ctx.height);
    gl.uniform1f(this.dispU.u_whorlIntensity, this.whorlIntensity);
    gl.uniform1f(this.dispU.u_boatSpeed, this.boatSpeed);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Restore texture params for next sim pass
    this.fbo.bindRead(gl, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  }

  onGesture(ctx: EngineContext, event: GestureEvent) {
    const screenToSim = (sx: number, sy: number): [number, number] => {
      const aspect = ctx.width / ctx.height;
      let dx = (sx - 0.5) * aspect / this.cameraZoom;
      let dy = (sy - 0.85) / this.cameraZoom;
      // Rotate by +boatAngle (inverse of display rotation)
      const cosA = this.boatDir[1];
      const sinA = this.boatDir[0];
      return [
        this.boatPos[0] + cosA * dx - sinA * dy,
        this.boatPos[1] + sinA * dx + cosA * dy,
      ];
    };

    if (event.type === 'drag-start' || event.type === 'drag-move') {
      this.userControlled = true;
      this.targetPos = screenToSim(event.pos.x, 1.0 - event.pos.y);
    } else if (event.type === 'drag-end') {
      this.userControlled = false;
      this.targetPos = null;
    } else if (event.type === 'tap') {
      this.targetPos = screenToSim(event.pos.x, 1.0 - event.pos.y);
      this.userControlled = true;
      setTimeout(() => { this.userControlled = false; this.targetPos = null; }, 2000);
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

  private updateBoat(dt: number, time: number) {
    if (this.targetPos) {
      // Steer toward target
      const dx = this.targetPos[0] - this.boatPos[0];
      const dy = this.targetPos[1] - this.boatPos[1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0.01) {
        this.boatDir = [dx / dist, dy / dist];
        const speed = this.boatSpeed * 0.3;
        this.boatPos[0] += this.boatDir[0] * speed * dt;
        this.boatPos[1] += this.boatDir[1] * speed * dt;
      }
    } else {
      // Auto-pilot: gentle S-curve
      this.autoTime += dt;
      const t = this.autoTime;
      const speed = this.boatSpeed * 0.15;

      // S-curve path
      const pathX = 0.5 + 0.3 * Math.sin(t * 0.3);
      const pathY = 0.5 + 0.25 * Math.sin(t * 0.2 + 1.0);

      const dx = pathX - this.boatPos[0];
      const dy = pathY - this.boatPos[1];
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > 0.001) {
        this.boatDir = [dx / dist, dy / dist];
      }

      this.boatPos[0] += this.boatDir[0] * speed * dt;
      this.boatPos[1] += this.boatDir[1] * speed * dt;

      // Wrap around edges
      if (this.boatPos[0] < 0.05) this.boatPos[0] = 0.05;
      if (this.boatPos[0] > 0.95) this.boatPos[0] = 0.95;
      if (this.boatPos[1] < 0.05) this.boatPos[1] = 0.05;
      if (this.boatPos[1] > 0.95) this.boatPos[1] = 0.95;
    }
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
