import { Plugin } from '../../plugin/Plugin';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import computeSrc from './compute.glsl';
import displaySrc from './display.glsl';
import seedSrc from './seed.glsl';

const PRESETS = [
  { id: 'maze', label: 'Golden maze · original', feed: 0.037, kill: 0.060 },
  { id: 'coral', label: 'Coral', feed: 0.0545, kill: 0.062 },
  { id: 'spots', label: 'Dappled', feed: 0.030, kill: 0.062 },
  { id: 'divide', label: 'Dividing spots', feed: 0.0367, kill: 0.0649 },
];

type Color = [number, number, number];
const PALETTES: { id: string; label: string; paper: Color; ink: Color }[] = [
  { id: 'gold', label: 'Gold / midnight · original', paper: [0.85, 0.72, 0.20], ink: [0.05, 0.06, 0.12] },
  { id: 'paper', label: 'Bone / charcoal', paper: [0.92, 0.88, 0.77], ink: [0.12, 0.15, 0.16] },
  { id: 'tide', label: 'Deep sea / seafoam', paper: [0.035, 0.14, 0.19], ink: [0.51, 0.91, 0.78] },
  { id: 'clay', label: 'Clay / aubergine', paper: [0.90, 0.49, 0.34], ink: [0.23, 0.10, 0.22] },
];

export class TuringPatternsPlugin implements Plugin {
  readonly name = 'Turing Patterns';

  private pingPong!: PingPongFBO;
  private computeProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private seedProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private sliders!: ParamSlider;

  // Keep the original chemistry, palette and evolution speed as the default.
  private feed = 0.037;
  private kill = 0.06;
  private iterations = 12;
  private paused = false;
  private pendingSteps = 0;
  private palette = PALETTES[0];
  private seedLayout = 'scatter';
  private seedDensity = 0.35;
  private brushMode = 'seed';
  private brushSize = 7;
  private brushFrom: [number, number] = [0.5, 0.5];
  private brushTo: [number, number] = [0.5, 0.5];
  private dragging = false;
  private brushPending = false;

  init(ctx: EngineContext) {
    const { gl } = ctx;
    this.computeProgram = createProgram(gl, quadVert, computeSrc);
    this.displayProgram = createProgram(gl, quadVert, displaySrc);
    this.seedProgram = createProgram(gl, quadVert, seedSrc);
    this.vao = gl.createVertexArray()!;
    this.pingPong = new PingPongFBO(gl, Math.max(1, Math.floor(ctx.width / 2)), Math.max(1, Math.floor(ctx.height / 2)));
    this.seedState(ctx);
    this.buildUI(ctx);
  }

  private buildUI(ctx: EngineContext) {
    const s = this.sliders = new ParamSlider();
    s.addSection('Pattern studio');
    s.addNote('Tap or drag to plant a pattern. Erase restores the empty field.');
    const presetSelect = s.addSelect({
      label: 'Recipe', value: 'maze',
      options: [...PRESETS.map(p => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom chemistry' }],
      onChange: value => {
        const preset = PRESETS.find(p => p.id === value);
        if (!preset) return;
        this.feed = preset.feed;
        this.kill = preset.kill;
        s.setValue('Feed rate', this.feed);
        s.setValue('Removal rate', this.kill);
        this.seedState(ctx);
      },
    });
    s.addSelect({
      label: 'Palette', value: 'gold',
      options: PALETTES.map(p => ({ value: p.id, label: p.label })),
      onChange: value => { this.palette = PALETTES.find(p => p.id === value)!; },
    });
    s.addSelect({
      label: 'Brush', value: this.brushMode,
      options: [{ value: 'seed', label: 'Plant' }, { value: 'erase', label: 'Erase' }],
      onChange: value => { this.brushMode = value; },
    });
    s.addSlider({
      label: 'Brush size %', min: 1, max: 20, value: this.brushSize, step: 0.5,
      onChange: value => { this.brushSize = value; },
    });

    s.addSection('Growth');
    const playback = s.addSelect({
      label: 'Playback', value: 'live',
      options: [{ value: 'live', label: 'Growing' }, { value: 'paused', label: 'Paused' }],
      onChange: value => { this.paused = value === 'paused'; },
    });
    s.addSlider({
      label: 'Growth / frame', min: 1, max: 24, value: this.iterations, step: 1,
      onChange: value => { this.iterations = value; },
    });
    s.addSlider({
      label: 'Feed rate', min: 0.010, max: 0.080, value: this.feed, step: 0.0001,
      onChange: value => { this.feed = value; presetSelect.value = 'custom'; },
    });
    s.addSlider({
      label: 'Removal rate', min: 0.040, max: 0.075, value: this.kill, step: 0.0001,
      onChange: value => { this.kill = value; presetSelect.value = 'custom'; },
    });
    s.addNote('Recipes restart the field. Custom rates can fade out; plant more or choose a recipe.');

    s.addSection('Starting field');
    s.addSelect({
      label: 'Seeds', value: this.seedLayout,
      options: [
        { value: 'scatter', label: 'Scattered islands' },
        { value: 'center', label: 'Single island' },
        { value: 'ring', label: 'Ring of islands' },
      ],
      onChange: value => { this.seedLayout = value; this.seedState(ctx); },
    });
    s.addSlider({
      label: 'Scatter density', min: 0.10, max: 0.80, value: this.seedDensity, step: 0.05,
      onChange: value => { this.seedDensity = value; },
    });
    s.addButtons([
      { label: 'Step', onClick: () => {
        this.paused = true;
        playback.value = 'paused';
        this.pendingSteps += this.iterations;
      } },
      { label: 'Reseed', onClick: () => this.seedState(ctx) },
      { label: 'Clear', onClick: () => this.seedState(ctx, true) },
    ]);
    s.addNote('Step advances one growth batch. Drawing also works while paused. Density applies on Reseed.');
  }

  private seedState(ctx: EngineContext, clear = false) {
    const { gl } = ctx;
    this.dragging = false;
    this.brushPending = false;
    this.pendingSteps = 0;
    gl.useProgram(this.seedProgram);
    gl.uniform1f(gl.getUniformLocation(this.seedProgram, 'u_seed'), Math.random() * 100.0);
    gl.uniform1f(gl.getUniformLocation(this.seedProgram, 'u_density'), this.seedDensity);
    gl.uniform1f(gl.getUniformLocation(this.seedProgram, 'u_aspect'), this.pingPong.width / this.pingPong.height);
    gl.uniform1i(gl.getUniformLocation(this.seedProgram, 'u_layout'), clear ? -1 : this.seedLayout === 'center' ? 1 : this.seedLayout === 'ring' ? 2 : 0);
    gl.bindVertexArray(this.vao);
    // Both textures must agree: otherwise the old field returns on the next swap.
    for (let i = 0; i < 2; i++) {
      this.pingPong.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.pingPong.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(ctx: EngineContext) {
    this.pingPong.resize(ctx.gl, Math.max(1, Math.floor(ctx.width / 2)), Math.max(1, Math.floor(ctx.height / 2)));
    this.seedState(ctx);
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    const painting = this.dragging || this.brushPending;
    const growthSteps = this.paused ? this.pendingSteps : this.iterations + this.pendingSteps;
    const passes = Math.max(growthSteps, painting ? 1 : 0);
    gl.bindVertexArray(this.vao);

    if (passes > 0) {
      gl.useProgram(this.computeProgram);
      gl.uniform2f(gl.getUniformLocation(this.computeProgram, 'u_texelSize'), 1 / this.pingPong.width, 1 / this.pingPong.height);
      gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_feed'), this.feed);
      gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_kill'), this.kill);
      gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_dt'), growthSteps > 0 ? 1 : 0);
      gl.uniform2f(gl.getUniformLocation(this.computeProgram, 'u_mouseFrom'), this.brushFrom[0], 1 - this.brushFrom[1]);
      gl.uniform2f(gl.getUniformLocation(this.computeProgram, 'u_mouse'), this.brushTo[0], 1 - this.brushTo[1]);
      gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_aspect'), ctx.width / ctx.height);
      gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_brushRadius'), this.brushSize / 200);
      gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_erase'), this.brushMode === 'erase' ? 1 : 0);
      gl.uniform1i(gl.getUniformLocation(this.computeProgram, 'u_state'), 0);
      for (let i = 0; i < passes; i++) {
        // Apply the brush once per frame, independent of the growth-rate control.
        gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_mouseDown'), painting && i === 0 ? 1 : 0);
        this.pingPong.bindRead(gl, 0);
        this.pingPong.bindWrite(gl);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.pingPong.swap();
      }
    }
    this.pendingSteps = 0;
    this.brushPending = false;
    this.brushFrom = [...this.brushTo];

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.displayProgram);
    this.pingPong.bindRead(gl, 0);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, 'u_state'), 0);
    gl.uniform3fv(gl.getUniformLocation(this.displayProgram, 'u_paper'), this.palette.paper);
    gl.uniform3fv(gl.getUniformLocation(this.displayProgram, 'u_ink'), this.palette.ink);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    const pos: [number, number] = [event.pos.x, event.pos.y];
    if (event.type === 'tap' || event.type === 'drag-start') this.brushFrom = pos;
    this.brushTo = pos;
    this.dragging = event.type === 'drag-start' || event.type === 'drag-move';
    this.brushPending = true;
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.computeProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteProgram(this.seedProgram);
    gl.deleteVertexArray(this.vao);
    this.pingPong.destroy(gl);
    this.sliders.destroy();
  }
}
