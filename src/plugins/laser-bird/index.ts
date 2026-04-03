import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { ParamSlider } from '../../engine/ParamSlider';

import quadVert from '../../shaders/fullscreen-quad.vert';
import birdFrag from './bird.glsl';
import blurFrag from './blur.glsl';
import compositeFrag from './composite.glsl';

// --- Constants ---
const BLOOM_SCALE = 0.5;        // bloom computed at half resolution
const BLUR_PASSES = 3;          // number of horizontal+vertical blur passes
const DEFAULT_GLOW_INTENSITY = 1.8;
const DEFAULT_GLOW_RADIUS = 2.5;
const DEFAULT_WING_SPREAD = 0.8;
const DEFAULT_PARTICLE_DENSITY = 1.0;

export class LaserBirdPlugin implements Plugin {
  readonly name = 'Laser Bird';

  private birdProgram: WebGLProgram | null = null;
  private blurProgram: WebGLProgram | null = null;
  private compositeProgram: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  // FBOs: scene at full res, bloom at half res
  private sceneFBO: WebGLFramebuffer | null = null;
  private sceneTex: WebGLTexture | null = null;
  private bloomFBO: PingPongFBO | null = null;

  private sliders: ParamSlider | null = null;
  private birdPos: [number, number] = [0.5, 0.45];
  private sceneWidth = 0;
  private sceneHeight = 0;

  init(ctx: EngineContext) {
    const { gl } = ctx;

    this.birdProgram = createProgram(gl, quadVert, birdFrag);
    this.blurProgram = createProgram(gl, quadVert, blurFrag);
    this.compositeProgram = createProgram(gl, quadVert, compositeFrag);
    this.vao = gl.createVertexArray();

    this.sceneWidth = ctx.width;
    this.sceneHeight = ctx.height;

    // Scene FBO (full resolution)
    this.sceneTex = this.createFloatTexture(gl, ctx.width, ctx.height);
    this.sceneFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);

    // Bloom FBO (half resolution)
    const bloomW = Math.floor(ctx.width * BLOOM_SCALE);
    const bloomH = Math.floor(ctx.height * BLOOM_SCALE);
    this.bloomFBO = new PingPongFBO(gl, bloomW, bloomH);

    // Sliders
    this.sliders = new ParamSlider();
    this.sliders.add({ label: 'Glow', min: 0.5, max: 4.0, step: 0.1, value: DEFAULT_GLOW_INTENSITY });
    this.sliders.add({ label: 'Glow Radius', min: 0.5, max: 5.0, step: 0.1, value: DEFAULT_GLOW_RADIUS });
    this.sliders.add({ label: 'Wing Spread', min: 0.3, max: 1.4, step: 0.01, value: DEFAULT_WING_SPREAD });
    this.sliders.add({ label: 'Particles', min: 0.0, max: 2.0, step: 0.1, value: DEFAULT_PARTICLE_DENSITY });
  }

  private createFloatTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('EXT_color_buffer_float not supported');
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    if (!this.birdProgram || !this.blurProgram || !this.compositeProgram ||
        !this.vao || !this.sceneFBO || !this.bloomFBO || !this.sliders) return;

    const wingSpread = this.sliders.get('Wing Spread');
    const glowRadius = this.sliders.get('Glow Radius');
    const glowIntensity = this.sliders.get('Glow');

    gl.bindVertexArray(this.vao);

    // --- Pass 1: Render bird to scene FBO ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFBO);
    gl.viewport(0, 0, this.sceneWidth, this.sceneHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.birdProgram);

    gl.uniform2f(gl.getUniformLocation(this.birdProgram, 'u_resolution'), this.sceneWidth, this.sceneHeight);
    gl.uniform1f(gl.getUniformLocation(this.birdProgram, 'u_time'), ctx.time);
    gl.uniform2f(gl.getUniformLocation(this.birdProgram, 'u_birdPos'), this.birdPos[0], this.birdPos[1]);
    gl.uniform1f(gl.getUniformLocation(this.birdProgram, 'u_wingSpread'), wingSpread);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- Pass 2: Multi-pass bloom blur ---
    // First, copy scene to bloom FBO (downsampled)
    gl.useProgram(this.blurProgram);
    const bloomW = this.bloomFBO.width;
    const bloomH = this.bloomFBO.height;

    for (let pass = 0; pass < BLUR_PASSES; pass++) {
      const radius = glowRadius * (1.0 + pass * 0.5);

      // Horizontal blur
      if (pass === 0) {
        // First pass reads from scene texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.sceneTex!);
      } else {
        this.bloomFBO.bindRead(gl, 0);
      }
      gl.uniform1i(gl.getUniformLocation(this.blurProgram, 'u_source'), 0);
      gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_direction'), 1.0 / bloomW, 0.0);
      gl.uniform1f(gl.getUniformLocation(this.blurProgram, 'u_radius'), radius);
      this.bloomFBO.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.bloomFBO.swap();

      // Vertical blur
      this.bloomFBO.bindRead(gl, 0);
      gl.uniform1i(gl.getUniformLocation(this.blurProgram, 'u_source'), 0);
      gl.uniform2f(gl.getUniformLocation(this.blurProgram, 'u_direction'), 0.0, 1.0 / bloomH);
      gl.uniform1f(gl.getUniformLocation(this.blurProgram, 'u_radius'), radius);
      this.bloomFBO.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.bloomFBO.swap();
    }

    // --- Pass 3: Composite ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.compositeProgram);

    // Bind scene texture to unit 0
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex!);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, 'u_scene'), 0);

    // Bind bloom texture to unit 1
    this.bloomFBO.bindRead(gl, 1);
    gl.uniform1i(gl.getUniformLocation(this.compositeProgram, 'u_bloom'), 1);

    gl.uniform2f(gl.getUniformLocation(this.compositeProgram, 'u_resolution'), ctx.width, ctx.height);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_time'), ctx.time);
    gl.uniform1f(gl.getUniformLocation(this.compositeProgram, 'u_glowIntensity'), glowIntensity);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    const x = event.pos.x;
    const y = 1.0 - event.pos.y;

    switch (event.type) {
      case 'tap':
        // Pulse effect could be added here
        break;
      case 'drag-start':
      case 'drag-move':
        this.birdPos = [x, y];
        break;
    }
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    if (this.birdProgram) gl.deleteProgram(this.birdProgram);
    if (this.blurProgram) gl.deleteProgram(this.blurProgram);
    if (this.compositeProgram) gl.deleteProgram(this.compositeProgram);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.sceneFBO) gl.deleteFramebuffer(this.sceneFBO);
    if (this.sceneTex) gl.deleteTexture(this.sceneTex);
    if (this.bloomFBO) this.bloomFBO.destroy(gl);
    if (this.sliders) this.sliders.destroy();
    this.birdProgram = null;
    this.blurProgram = null;
    this.compositeProgram = null;
    this.vao = null;
    this.sceneFBO = null;
    this.sceneTex = null;
    this.bloomFBO = null;
    this.sliders = null;
  }
}
