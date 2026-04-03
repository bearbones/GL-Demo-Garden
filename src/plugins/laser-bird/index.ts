import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import birdFrag from './bird.glsl';
import blurFrag from './blur.glsl';
import compositeFrag from './composite.glsl';

// ── Constants ───────────────────────────────────────────────────────
const BLOOM_SCALE = 0.5; // bloom FBO at half res
const BLUR_PASSES = 3;   // number of H+V blur passes

export class LaserBirdPlugin implements Plugin {
  readonly name = 'Laser Bird';

  private birdProgram!: WebGLProgram;
  private blurProgram!: WebGLProgram;
  private compositeProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;

  // FBOs
  private sceneFBO!: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number };
  private bloomFBO!: PingPongFBO;

  // Uniforms
  private birdU!: Record<string, WebGLUniformLocation | null>;
  private blurU!: Record<string, WebGLUniformLocation | null>;
  private compU!: Record<string, WebGLUniformLocation | null>;

  // Parameters
  private glowIntensity = 1.5;
  private glowRadius = 2.0;
  private particleDensity = 0.6;
  private wingSpread = 0.5;

  // Interaction
  private birdPos: [number, number] = [0.5, 0.5];
  private sliders!: ParamSlider;

  init(ctx: EngineContext) {
    const { gl } = ctx;

    this.birdProgram = createProgram(gl, quadVert, birdFrag);
    this.blurProgram = createProgram(gl, quadVert, blurFrag);
    this.compositeProgram = createProgram(gl, quadVert, compositeFrag);
    this.vao = gl.createVertexArray()!;

    // Scene FBO (full res)
    this.sceneFBO = this.createFBO(gl, ctx.width, ctx.height);

    // Bloom FBO (half res)
    const bw = Math.floor(ctx.width * BLOOM_SCALE);
    const bh = Math.floor(ctx.height * BLOOM_SCALE);
    this.bloomFBO = new PingPongFBO(gl, bw, bh);

    // Cache uniforms
    this.birdU = this.getUniforms(gl, this.birdProgram, [
      'u_resolution', 'u_time', 'u_birdPos', 'u_wingSpread',
    ]);
    this.blurU = this.getUniforms(gl, this.blurProgram, [
      'u_source', 'u_direction', 'u_glowRadius',
    ]);
    this.compU = this.getUniforms(gl, this.compositeProgram, [
      'u_scene', 'u_bloom', 'u_resolution', 'u_time',
      'u_glowIntensity', 'u_particleDensity',
    ]);

    // Sliders
    this.sliders = new ParamSlider();
    this.sliders.addSlider({
      label: 'Glow Intensity', min: 0.3, max: 4.0, value: this.glowIntensity,
      onChange: (v) => { this.glowIntensity = v; },
    });
    this.sliders.addSlider({
      label: 'Glow Radius', min: 0.5, max: 5.0, value: this.glowRadius,
      onChange: (v) => { this.glowRadius = v; },
    });
    this.sliders.addSlider({
      label: 'Particles', min: 0.0, max: 1.0, value: this.particleDensity,
      onChange: (v) => { this.particleDensity = v; },
    });
    this.sliders.addSlider({
      label: 'Wing Spread', min: 0.0, max: 1.0, value: this.wingSpread,
      onChange: (v) => { this.wingSpread = v; },
    });
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    gl.bindVertexArray(this.vao);

    // ── Pass 1: Render bird to scene FBO ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO.fbo);
    gl.viewport(0, 0, this.sceneFBO.w, this.sceneFBO.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.birdProgram);
    gl.uniform2f(this.birdU.u_resolution, this.sceneFBO.w, this.sceneFBO.h);
    gl.uniform1f(this.birdU.u_time, ctx.time);
    gl.uniform2f(this.birdU.u_birdPos, this.birdPos[0], this.birdPos[1]);
    gl.uniform1f(this.birdU.u_wingSpread, this.wingSpread);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── Pass 2: Bloom — downsample scene to bloom FBO, then blur ──
    // First blit scene into bloom FBO as starting point
    this.bloomFBO.bindWrite(gl);
    gl.useProgram(this.blurProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex);
    gl.uniform1i(this.blurU.u_source, 0);
    gl.uniform2f(this.blurU.u_direction, 0.0, 0.0); // no blur on first pass (just downsample)
    gl.uniform1f(this.blurU.u_glowRadius, 1.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.bloomFBO.swap();

    // Multi-pass separable blur
    const bw = this.bloomFBO.width;
    const bh = this.bloomFBO.height;
    for (let i = 0; i < BLUR_PASSES; i++) {
      const scale = this.glowRadius * (1.0 + i * 0.5);

      // Horizontal
      this.bloomFBO.bindRead(gl, 0);
      gl.uniform1i(this.blurU.u_source, 0);
      gl.uniform2f(this.blurU.u_direction, scale / bw, 0.0);
      gl.uniform1f(this.blurU.u_glowRadius, 1.0);
      this.bloomFBO.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.bloomFBO.swap();

      // Vertical
      this.bloomFBO.bindRead(gl, 0);
      gl.uniform1i(this.blurU.u_source, 0);
      gl.uniform2f(this.blurU.u_direction, 0.0, scale / bh);
      this.bloomFBO.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.bloomFBO.swap();
    }

    // ── Pass 3: Composite ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);

    gl.useProgram(this.compositeProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneFBO.tex);
    gl.uniform1i(this.compU.u_scene, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomFBO.readTexture);
    gl.uniform1i(this.compU.u_bloom, 1);

    gl.uniform2f(this.compU.u_resolution, ctx.width, ctx.height);
    gl.uniform1f(this.compU.u_time, ctx.time);
    gl.uniform1f(this.compU.u_glowIntensity, this.glowIntensity);
    gl.uniform1f(this.compU.u_particleDensity, this.particleDensity);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    if (event.type === 'drag-move' || event.type === 'drag-start') {
      this.birdPos = [event.pos.x, 1.0 - event.pos.y];
    } else if (event.type === 'tap') {
      // Pulse effect handled by time-based oscillation already
      this.birdPos = [event.pos.x, 1.0 - event.pos.y];
    }
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.birdProgram);
    gl.deleteProgram(this.blurProgram);
    gl.deleteProgram(this.compositeProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteFramebuffer(this.sceneFBO.fbo);
    gl.deleteTexture(this.sceneFBO.tex);
    this.bloomFBO.destroy(gl);
    this.sliders.destroy();
  }

  private createFBO(gl: WebGL2RenderingContext, w: number, h: number) {
    gl.getExtension('EXT_color_buffer_float');

    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

    return { fbo, tex, w, h };
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
