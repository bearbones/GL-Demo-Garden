import { Plugin } from '../../plugin/Plugin';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import quadVert from '../../shaders/fullscreen-quad.vert';
import computeSrc from './compute.glsl';
import displaySrc from './display.glsl';

export class TuringPatternsPlugin implements Plugin {
  readonly name = 'Turing Patterns';

  private pingPong!: PingPongFBO;
  private computeProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private mousePos: [number, number] = [0.5, 0.5];
  private mouseDown = 0;

  // Gray-Scott parameters — "coral growth" preset
  private feed = 0.0545;
  private kill = 0.062;

  init(ctx: EngineContext) {
    const { gl } = ctx;

    this.computeProgram = createProgram(gl, quadVert, computeSrc);
    this.displayProgram = createProgram(gl, quadVert, displaySrc);
    this.vao = gl.createVertexArray()!;

    // Use half resolution for performance
    const simW = Math.floor(ctx.width / 2);
    const simH = Math.floor(ctx.height / 2);

    this.pingPong = new PingPongFBO(gl, simW, simH);

    // Seed initial state: A=1 everywhere, B=0 with random patches
    this.seedState(ctx);
  }

  private seedState(ctx: EngineContext) {
    const { gl } = ctx;
    const w = this.pingPong.width;
    const h = this.pingPong.height;

    // Create initial data on a temporary framebuffer
    // A=1.0, B=0.0 everywhere, then add random seeds of B
    const seedProgram = createProgram(gl, quadVert, `#version 300 es
      precision highp float;
      in vec2 v_uv;
      out vec4 fragColor;
      uniform vec2 u_resolution;
      uniform float u_seed;
      // Simple hash
      float hash(vec2 p) {
        return fract(sin(dot(p + u_seed, vec2(127.1, 311.7))) * 43758.5453);
      }
      void main() {
        float A = 1.0;
        float B = 0.0;
        // Random scattered seeds
        vec2 cell = floor(v_uv * 20.0);
        float r = hash(cell);
        if (r > 0.85) {
          float d = length(fract(v_uv * 20.0) - 0.5);
          B = smoothstep(0.4, 0.1, d);
        }
        fragColor = vec4(A, B, 0.0, 1.0);
      }
    `);

    gl.useProgram(seedProgram);
    gl.uniform2f(gl.getUniformLocation(seedProgram, 'u_resolution'), w, h);
    gl.uniform1f(gl.getUniformLocation(seedProgram, 'u_seed'), Math.random() * 100.0);

    // Render seed into both FBO textures
    gl.bindVertexArray(this.vao);
    for (let i = 0; i < 2; i++) {
      this.pingPong.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.pingPong.swap();
    }

    gl.deleteProgram(seedProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    const stepsPerFrame = 12;

    gl.bindVertexArray(this.vao);

    // Compute passes
    gl.useProgram(this.computeProgram);
    gl.uniform2f(
      gl.getUniformLocation(this.computeProgram, 'u_texelSize'),
      1.0 / this.pingPong.width,
      1.0 / this.pingPong.height,
    );
    gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_feed'), this.feed);
    gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_kill'), this.kill);
    gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_dt'), 1.0);
    gl.uniform2f(
      gl.getUniformLocation(this.computeProgram, 'u_mouse'),
      this.mousePos[0],
      1.0 - this.mousePos[1], // Flip Y: shader UV is bottom-up
    );
    gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_mouseDown'), this.mouseDown);
    gl.uniform1i(gl.getUniformLocation(this.computeProgram, 'u_state'), 0);

    for (let i = 0; i < stepsPerFrame; i++) {
      this.pingPong.bindRead(gl, 0);
      this.pingPong.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.pingPong.swap();
    }

    // Display pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.displayProgram);
    this.pingPong.bindRead(gl, 0);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, 'u_state'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    this.mousePos = [event.pos.x, event.pos.y];
    this.mouseDown = (event.type === 'drag-start' || event.type === 'drag-move' || event.type === 'tap') ? 1 : 0;
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.computeProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteVertexArray(this.vao);
    this.pingPong.destroy(gl);
  }
}
