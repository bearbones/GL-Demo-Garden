import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import drawingSrc from './display.glsl';
import marksVert from './marks.vert';
import plateSrc from './plate.glsl';
import paintingSrc from './painting.glsl';
import photographSrc from './photograph.glsl';

const MAX_RIPPLES = 160; // Includes airborne drops at the maximum rain/lifetime settings.
const KIND_SMALL = 0;
const KIND_TAP = 1;
const KIND_SPIRAL = 2;
const RAIN_MAX_DROPS_PER_SEC = 16;
const RAIN_FALL_TIME = 1.15; // Starts above the image for every landing height.
const DRAG_SPAWN_SPACING = 0.07;

interface Ripple {
  x: number;
  y: number;
  birth: number; // Arrival at the water; negative age is the falling stroke.
  w: number; // kind + fractional seed
}

type Locations = Record<string, WebGLUniformLocation | null>;

/** Inked marks over a held painting, then a separate photographic exposure. */
export class RippleDropPlugin implements Plugin {
  readonly name = 'Ripple Drop';
  private drawing!: WebGLProgram;
  private painting!: WebGLProgram;
  private copying!: WebGLProgram;
  private copyBackground!: WebGLUniformLocation | null;
  private photograph!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private marksVao!: WebGLVertexArrayObject;
  private instanceBuffer!: WebGLBuffer;
  private plate!: WebGLTexture;
  private framebuffer!: WebGLFramebuffer;
  private background!: WebGLTexture;
  private backgroundFbo!: WebGLFramebuffer;
  private diffused!: WebGLTexture;
  private diffusionFbo!: WebGLFramebuffer;
  private paintingDirty = true;
  private artWidth = 1;
  private artHeight = 1;
  private backgroundWidth = 1;
  private backgroundHeight = 1;
  private drawingLocs!: Locations;
  private paintingLocs!: Locations;
  private photoLocs!: Locations;
  private sliders!: ParamSlider;
  private ripples: Ripple[] = [];
  private rippleData = new Float32Array(MAX_RIPPLES * 4);

  private time = 0;
  private playing = true;
  private photographed = true;
  private rain = 0.4;
  private squash = 0.35;
  private life = 4.5;
  private strokeWidth = 2.2;
  private handDrawn = 0.85;
  private lineBoil = 0.35;
  private softness = 0.55;
  private grain = 0.45;
  private weave = 0.35;
  private palette = 0;
  private mark: 'rings' | 'spiral' = 'rings';
  private rainAccum = 0;
  private lastDragSpawn: [number, number] | null = null;

  init(ctx: EngineContext) {
    const { gl } = ctx;
    this.drawing = createProgram(gl, marksVert, drawingSrc);
    this.copying = createProgram(gl, quadVert, plateSrc);
    this.copyBackground = gl.getUniformLocation(this.copying, 'u_background');
    this.painting = createProgram(gl, quadVert, paintingSrc);
    this.photograph = createProgram(gl, quadVert, photographSrc);
    const locate = (program: WebGLProgram, names: string[]): Locations => Object.fromEntries(
      names.map(name => [name, gl.getUniformLocation(program, name)]));
    this.drawingLocs = locate(this.drawing, ['u_resolution', 'u_time', 'u_squash', 'u_life',
      'u_strokeWidth', 'u_handDrawn', 'u_lineBoil', 'u_palette']);
    this.photoLocs = locate(this.photograph, ['u_scene', 'u_resolution', 'u_artResolution',
      'u_time', 'u_softness', 'u_grain', 'u_weave', 'u_blurAxis', 'u_finish', 'u_sourceLinear']);
    this.paintingLocs = locate(this.painting, ['u_resolution', 'u_palette']);
    this.vao = gl.createVertexArray()!;
    this.marksVao = gl.createVertexArray()!;
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindVertexArray(this.marksVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.rippleData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.bindVertexArray(null);
    this.plate = gl.createTexture()!;
    this.framebuffer = gl.createFramebuffer()!;
    this.background = gl.createTexture()!;
    this.backgroundFbo = gl.createFramebuffer()!;
    this.diffused = gl.createTexture()!;
    this.diffusionFbo = gl.createFramebuffer()!;
    for (const texture of [this.plate, this.background, this.diffused]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.resize(ctx);
    // Open on a continuous shower, including drops already on their way down.
    const interval = 1 / (this.rain * RAIN_MAX_DROPS_PER_SEC);
    for (let release = -this.life - RAIN_FALL_TIME + interval * 0.5; release < 0; release += interval) {
      this.releaseRain(release);
    }
    this.buildControls();
  }

  private buildControls() {
    this.sliders = new ParamSlider();
    this.sliders.addNote('Falling strokes land in their own ripples. Pause to study a cel; Clear pond removes the rain too.');
    this.sliders.addSelect({ label: 'Playback', value: 'live',
      options: [{ value: 'live', label: 'Playing' }, { value: 'paused', label: 'Paused cel' }],
      onChange: value => { this.playing = value === 'live'; } });
    this.sliders.addSelect({ label: 'Mark', value: this.mark,
      options: [{ value: 'rings', label: 'Rings' }, { value: 'spiral', label: 'Spiral' }],
      onChange: value => { this.mark = value === 'spiral' ? 'spiral' : 'rings'; } });
    this.sliders.addButtons([
      { label: 'Clear pond', onClick: () => {
        this.ripples = [];
        this.rainAccum = 0;
        this.lastDragSpawn = null;
        this.rain = 0;
        this.sliders.setValue('Rain', 0);
      } },
      { label: 'Shower', onClick: () => {
        for (let i = 0; i < 7; i++) this.releaseRain(this.time, true);
      } },
    ]);
    this.sliders.addSection('Painted pond');
    this.sliders.addSelect({ label: 'Palette', value: 'dusk', options: [
      { value: 'dusk', label: 'Blue hour' }, { value: 'moss', label: 'Moss & ivory' },
      { value: 'rain', label: 'Rain grey' }],
      onChange: value => {
        this.palette = value === 'moss' ? 1 : value === 'rain' ? 2 : 0;
        this.paintingDirty = true;
      } });
    this.sliders.addSlider({ label: 'Rain', min: 0, max: 1, value: this.rain, step: 0.05,
      onChange: value => { this.rain = value; } });
    this.sliders.addSlider({ label: 'Perspective', min: 0.15, max: 1, value: this.squash, step: 0.01,
      onChange: value => { this.squash = value; } });
    this.sliders.addSlider({ label: 'Lifetime', min: 2, max: 8, value: this.life, step: 0.1,
      onChange: value => { this.life = value; } });
    this.sliders.addSection('Cel linework');
    this.sliders.addSlider({ label: 'Stroke width', min: 1, max: 4, value: this.strokeWidth, step: 0.1,
      onChange: value => { this.strokeWidth = value; } });
    this.sliders.addSlider({ label: 'Hand drawn', min: 0, max: 1, value: this.handDrawn, step: 0.05,
      onChange: value => { this.handDrawn = value; } });
    this.sliders.addSlider({ label: 'Line boil', min: 0, max: 1, value: this.lineBoil, step: 0.05,
      onChange: value => { this.lineBoil = value; } });
    this.sliders.addSection('Cel photography');
    this.sliders.addSelect({ label: 'Finish', value: 'photographed', options: [
      { value: 'photographed', label: 'Photographed cels' }, { value: 'drawing', label: 'Clean drawing' }],
      onChange: value => { this.photographed = value === 'photographed'; } });
    this.sliders.addSlider({ label: 'Optical softness', min: 0, max: 1, value: this.softness, step: 0.05,
      onChange: value => { this.softness = value; } });
    this.sliders.addSlider({ label: 'Film grain', min: 0, max: 1, value: this.grain, step: 0.05,
      onChange: value => { this.grain = value; } });
    this.sliders.addSlider({ label: 'Gate weave', min: 0, max: 1, value: this.weave, step: 0.05,
      onChange: value => { this.weave = value; } });
  }

  resize(ctx: EngineContext) {
    const { gl } = ctx;
    // Only the broad held painting is bounded. Thin ink and optical diffusion
    // use native display pixels; enlarging a 720p ink raster causes stair steps.
    this.artWidth = ctx.width;
    this.artHeight = ctx.height;
    const scale = Math.min(1, 1280 / ctx.width, 720 / ctx.height);
    this.backgroundWidth = Math.max(1, Math.round(ctx.width * scale));
    this.backgroundHeight = Math.max(1, Math.round(ctx.height * scale));
    // sRGB storage makes coverage blend in linear light without sacrificing
    // dark-paint precision. Sampling this ink target automatically decodes it.
    const targets: [WebGLTexture, WebGLFramebuffer, number, number, number][] = [
      [this.plate, this.framebuffer, this.artWidth, this.artHeight, gl.SRGB8_ALPHA8],
      [this.diffused, this.diffusionFbo, this.artWidth, this.artHeight, gl.RGBA8],
      [this.background, this.backgroundFbo, this.backgroundWidth, this.backgroundHeight, gl.RGBA8],
    ];
    for (const [texture, framebuffer, width, height, format] of targets) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Ripple painting framebuffer is incomplete');
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.paintingDirty = true;
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    if (this.playing) {
      this.time += ctx.dt;
      const rate = this.rain * RAIN_MAX_DROPS_PER_SEC;
      this.rainAccum += rate * ctx.dt;
      while (this.rainAccum >= 1) {
        this.rainAccum -= 1;
        this.releaseRain(this.time - this.rainAccum / rate);
      }
      this.ripples = this.ripples.filter(r => this.time - r.birth <= this.life);
    }
    for (let i = 0; i < this.ripples.length; i++) {
      const r = this.ripples[i], j = i * 4;
      this.rippleData[j] = r.x;
      this.rippleData[j + 1] = r.y;
      this.rippleData[j + 2] = r.birth;
      this.rippleData[j + 3] = r.w;
    }
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    if (this.paintingDirty) {
      // Held backgrounds are painted only on palette changes or resize.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.backgroundFbo);
      gl.viewport(0, 0, this.backgroundWidth, this.backgroundHeight);
      gl.useProgram(this.painting);
      gl.uniform2f(this.paintingLocs.u_resolution, this.backgroundWidth, this.backgroundHeight);
      gl.uniform1i(this.paintingLocs.u_palette, this.palette);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.paintingDirty = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.artWidth, this.artHeight);
    gl.useProgram(this.copying);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.background);
    gl.uniform1i(this.copyBackground, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Each instance shades only its small conservative footprint. Native ink
    // therefore avoids a full-screen loop over every drop at retina density.
    gl.useProgram(this.drawing);
    const d = this.drawingLocs;
    gl.uniform2f(d.u_resolution, this.artWidth, this.artHeight);
    gl.uniform1f(d.u_time, this.time);
    gl.uniform1f(d.u_squash, this.squash);
    gl.uniform1f(d.u_life, this.life);
    gl.uniform1f(d.u_strokeWidth, this.strokeWidth);
    gl.uniform1f(d.u_handDrawn, this.handDrawn);
    gl.uniform1f(d.u_lineBoil, this.lineBoil);
    gl.uniform1i(d.u_palette, this.palette);
    gl.bindVertexArray(this.marksVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.rippleData, 0, this.ripples.length * 4);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.ripples.length);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.photograph);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.plate);
    const p = this.photoLocs;
    gl.uniform1i(p.u_scene, 0);
    gl.uniform1i(p.u_sourceLinear, 1);
    gl.uniform2f(p.u_resolution, ctx.width, ctx.height);
    gl.uniform2f(p.u_artResolution, this.artWidth, this.artHeight);
    gl.uniform1f(p.u_time, this.time);
    gl.uniform1f(p.u_softness, this.photographed ? this.softness : 0);
    gl.uniform1f(p.u_grain, this.photographed ? this.grain : 0);
    gl.uniform1f(p.u_weave, this.photographed ? this.weave : 0);
    if (this.photographed && this.softness > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.diffusionFbo);
      gl.uniform2f(p.u_blurAxis, 1, 0);
      gl.uniform1i(p.u_finish, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, this.diffused);
      gl.uniform1i(p.u_sourceLinear, 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.uniform2f(p.u_blurAxis, 0, 1);
    gl.uniform1i(p.u_finish, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(ctx: EngineContext, event: GestureEvent) {
    const x = event.pos.x, y = 1 - event.pos.y;
    const kind = this.mark === 'spiral' ? KIND_SPIRAL : KIND_TAP;
    // A tiny head start leaves visible ink even when placing a paused cel.
    const birth = this.time - (this.playing ? 0.025 : 0.45);
    if (event.type === 'tap' || event.type === 'drag-start') {
      this.spawn(x, y, kind, birth);
      if (event.type === 'drag-start') this.lastDragSpawn = [x, y];
    } else if (event.type === 'drag-move' && this.lastDragSpawn) {
      // Measure spacing in canvas-height units so portrait gestures do not bunch.
      const dx = (x - this.lastDragSpawn[0]) * ctx.width / ctx.height;
      const dy = y - this.lastDragSpawn[1];
      if (Math.hypot(dx, dy) > DRAG_SPAWN_SPACING) {
        this.spawn(x, y, this.mark === 'spiral' ? KIND_SPIRAL : KIND_SMALL, birth);
        this.lastDragSpawn = [x, y];
      }
    } else if (event.type === 'drag-end') this.lastDragSpawn = null;
  }

  private releaseRain(time: number, showInFlight = false) {
    const x = 0.03 + Math.random() * 0.94, y = 0.08 + Math.random() * 0.84;
    const seed = 0.05 + Math.random() * 0.9;
    // Shower previews the drop partway down, including when playback is paused.
    const flight = showInFlight ? (0.97 - y) * 0.55 / (0.95 + seed * 0.45) : RAIN_FALL_TIME;
    this.spawn(x, y, KIND_SMALL, time + flight, seed);
  }

  private spawn(x: number, y: number, kind: number, birth: number, seed = 0.05 + Math.random() * 0.9) {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x, y, birth, w: kind + seed });
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.drawing);
    gl.deleteProgram(this.painting);
    gl.deleteProgram(this.copying);
    gl.deleteProgram(this.photograph);
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.marksVao);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteTexture(this.plate);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.background);
    gl.deleteFramebuffer(this.backgroundFbo);
    gl.deleteTexture(this.diffused);
    gl.deleteFramebuffer(this.diffusionFbo);
    this.sliders.destroy();
    this.ripples = [];
  }
}
