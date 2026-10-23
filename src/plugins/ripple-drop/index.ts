import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import drawingSrc from './display.glsl';
import paintingSrc from './painting.glsl';
import photographSrc from './photograph.glsl';

const MAX_RIPPLES = 48; // Must match display.glsl.
const KIND_SMALL = 0;
const KIND_TAP = 1;
const KIND_SPIRAL = 2;
const RAIN_MAX_DROPS_PER_SEC = 10;
const DRAG_SPAWN_SPACING = 0.07;

interface Ripple {
  x: number;
  y: number;
  birth: number;
  w: number; // kind + fractional seed
}

type Locations = Record<string, WebGLUniformLocation | null>;

/** Inked marks over a held painting, then a separate photographic exposure. */
export class RippleDropPlugin implements Plugin {
  readonly name = 'Ripple Drop';
  private drawing!: WebGLProgram;
  private painting!: WebGLProgram;
  private photograph!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private plate!: WebGLTexture;
  private framebuffer!: WebGLFramebuffer;
  private background!: WebGLTexture;
  private backgroundFbo!: WebGLFramebuffer;
  private paintingDirty = true;
  private artWidth = 1;
  private artHeight = 1;
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
    this.drawing = createProgram(gl, quadVert, drawingSrc);
    this.painting = createProgram(gl, quadVert, paintingSrc);
    this.photograph = createProgram(gl, quadVert, photographSrc);
    const locate = (program: WebGLProgram, names: string[]): Locations => Object.fromEntries(
      names.map(name => [name, gl.getUniformLocation(program, name === 'u_ripples' ? 'u_ripples[0]' : name)]));
    this.drawingLocs = locate(this.drawing, ['u_background', 'u_resolution', 'u_time', 'u_ripples', 'u_count',
      'u_squash', 'u_life', 'u_strokeWidth', 'u_rain', 'u_handDrawn', 'u_lineBoil', 'u_palette']);
    this.photoLocs = locate(this.photograph, ['u_scene', 'u_resolution', 'u_artResolution',
      'u_time', 'u_softness', 'u_grain', 'u_weave']);
    this.paintingLocs = locate(this.painting, ['u_resolution', 'u_palette']);
    this.vao = gl.createVertexArray()!;
    this.plate = gl.createTexture()!;
    this.framebuffer = gl.createFramebuffer()!;
    this.background = gl.createTexture()!;
    this.backgroundFbo = gl.createFramebuffer()!;
    for (const texture of [this.plate, this.background]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    this.resize(ctx);
    // Open on an established shot instead of waiting for the first rain rings.
    for (let i = 0; i < 7; i++) {
      this.spawn(0.08 + Math.random() * 0.84, 0.12 + Math.random() * 0.76,
        KIND_SMALL, -0.35 - Math.random() * 2.8);
    }
    this.buildControls();
  }

  private buildControls() {
    this.sliders = new ParamSlider();
    this.sliders.addNote('Pause to study a cel. Clear pond also stops the rain; Shower adds a few drops.');
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
        for (let i = 0; i < 7; i++) this.spawn(0.08 + Math.random() * 0.84,
          0.12 + Math.random() * 0.76, KIND_SMALL, this.time - 0.15 - Math.random() * 1.3);
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
    // A bounded photographic plate keeps retina screens from multiplying
    // the expensive ink work. The finish is still sampled at display density.
    const scale = Math.min(1, 1280 / ctx.width, 720 / ctx.height);
    this.artWidth = Math.max(1, Math.round(ctx.width * scale));
    this.artHeight = Math.max(1, Math.round(ctx.height * scale));
    for (const [texture, framebuffer] of [[this.plate, this.framebuffer], [this.background, this.backgroundFbo]]) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.artWidth, this.artHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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
        this.spawn(0.03 + Math.random() * 0.94, 0.08 + Math.random() * 0.87,
          KIND_SMALL, this.time - this.rainAccum / rate);
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
    gl.viewport(0, 0, this.artWidth, this.artHeight);
    if (this.paintingDirty) {
      // Held backgrounds are painted only on palette changes or resize.
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.backgroundFbo);
      gl.useProgram(this.painting);
      gl.uniform2f(this.paintingLocs.u_resolution, this.artWidth, this.artHeight);
      gl.uniform1i(this.paintingLocs.u_palette, this.palette);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.paintingDirty = false;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.useProgram(this.drawing);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.background);
    const d = this.drawingLocs;
    gl.uniform1i(d.u_background, 0);
    gl.uniform2f(d.u_resolution, this.artWidth, this.artHeight);
    gl.uniform1f(d.u_time, this.time);
    gl.uniform4fv(d.u_ripples, this.rippleData);
    gl.uniform1i(d.u_count, this.ripples.length);
    gl.uniform1f(d.u_squash, this.squash);
    gl.uniform1f(d.u_life, this.life);
    gl.uniform1f(d.u_strokeWidth, this.strokeWidth);
    gl.uniform1f(d.u_rain, this.rain);
    gl.uniform1f(d.u_handDrawn, this.handDrawn);
    gl.uniform1f(d.u_lineBoil, this.lineBoil);
    gl.uniform1i(d.u_palette, this.palette);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.photograph);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.plate);
    const p = this.photoLocs;
    gl.uniform1i(p.u_scene, 0);
    gl.uniform2f(p.u_resolution, ctx.width, ctx.height);
    gl.uniform2f(p.u_artResolution, this.artWidth, this.artHeight);
    gl.uniform1f(p.u_time, this.time);
    gl.uniform1f(p.u_softness, this.photographed ? this.softness : 0);
    gl.uniform1f(p.u_grain, this.photographed ? this.grain : 0);
    gl.uniform1f(p.u_weave, this.photographed ? this.weave : 0);
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

  private spawn(x: number, y: number, kind: number, birth: number) {
    if (this.ripples.length >= MAX_RIPPLES) this.ripples.shift();
    this.ripples.push({ x, y, birth, w: kind + 0.05 + Math.random() * 0.9 });
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.drawing);
    gl.deleteProgram(this.painting);
    gl.deleteProgram(this.photograph);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.plate);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteTexture(this.background);
    gl.deleteFramebuffer(this.backgroundFbo);
    this.sliders.destroy();
    this.ripples = [];
  }
}
