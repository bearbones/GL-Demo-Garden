import { Plugin } from './Plugin';
import { EngineContext, GestureEvent } from '../engine/types';
import { createProgram } from '../engine/gl-utils';
import quadVert from '../shaders/fullscreen-quad.vert';

export abstract class FragmentShaderPlugin implements Plugin {
  abstract readonly name: string;
  protected abstract fragmentSource(): string;

  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uResolution: WebGLUniformLocation | null = null;
  private uMouse: WebGLUniformLocation | null = null;
  protected mousePos: [number, number] = [0.5, 0.5];

  protected setUniforms?(gl: WebGL2RenderingContext, program: WebGLProgram, ctx: EngineContext): void;

  init(ctx: EngineContext) {
    const { gl } = ctx;
    this.program = createProgram(gl, quadVert, this.fragmentSource());
    this.uTime = gl.getUniformLocation(this.program, 'u_time');
    this.uResolution = gl.getUniformLocation(this.program, 'u_resolution');
    this.uMouse = gl.getUniformLocation(this.program, 'u_mouse');
    this.vao = gl.createVertexArray();
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.program);
    gl.uniform1f(this.uTime, ctx.time);
    gl.uniform2f(this.uResolution, ctx.width, ctx.height);
    gl.uniform2f(this.uMouse, this.mousePos[0], this.mousePos[1]);
    if (this.setUniforms && this.program) {
      this.setUniforms(gl, this.program, ctx);
    }
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    this.mousePos = [event.pos.x, event.pos.y];
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    if (this.program) gl.deleteProgram(this.program);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.program = null;
    this.vao = null;
  }
}
