import { Plugin } from '../../plugin/Plugin';
import { EngineContext } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { ParamSlider } from '../../engine/ParamSlider';
import { BubbleSimulation, MAX_BUBBLES, PADDLE_RADIUS } from './simulation';
import quadVert from '../../shaders/fullscreen-quad.vert';
import backgroundFrag from './background.glsl';
import bubbleVert from './bubble.vert';
import bubbleFrag from './bubble.frag';

export class BubblePhysicsPlugin implements Plugin {
  readonly name = 'Bubble Physics';
  private bgProgram!: WebGLProgram;
  private bubbleProgram!: WebGLProgram;
  private bgVao!: WebGLVertexArrayObject;
  private bubbleVao!: WebGLVertexArrayObject;
  private cornerBuffer!: WebGLBuffer;
  private instanceBuffer!: WebGLBuffer;
  private data = new Float32Array(MAX_BUBBLES * 8);
  private simulation!: BubbleSimulation;
  private sliders!: ParamSlider;
  private playing = true;
  private generation = 0;
  private pointerId: number | null = null;
  private onDown!: (event: PointerEvent) => void;
  private onMove!: (event: PointerEvent) => void;
  private onUp!: (event: PointerEvent) => void;
  private locs = new Map<WebGLProgram, Record<string, WebGLUniformLocation | null>>();

  init(ctx: EngineContext) {
    const { gl, canvas } = ctx;
    this.simulation = new BubbleSimulation(ctx.width / ctx.height);
    this.bgProgram = createProgram(gl, quadVert, backgroundFrag);
    this.bubbleProgram = createProgram(gl, bubbleVert, bubbleFrag);
    for (const program of [this.bgProgram, this.bubbleProgram]) {
      const locations: Record<string, WebGLUniformLocation | null> = {};
      for (const name of ['u_resolution', 'u_time', 'u_pointer']) locations[name] = gl.getUniformLocation(program, name);
      this.locs.set(program, locations);
    }
    this.bgVao = gl.createVertexArray()!;
    this.bubbleVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.bubbleVao);
    this.cornerBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    for (let attribute = 1; attribute <= 2; attribute++) {
      gl.enableVertexAttribArray(attribute);
      gl.vertexAttribPointer(attribute, 4, gl.FLOAT, false, 32, (attribute - 1) * 16);
      gl.vertexAttribDivisor(attribute, 1);
    }
    gl.bindVertexArray(null);

    this.onDown = event => {
      if (this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      this.pointer(event, canvas, true);
    };
    this.onMove = event => {
      if (event.pointerId === this.pointerId) this.pointer(event, canvas, true);
    };
    this.onUp = event => {
      if (event.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.pointer(event, canvas, false);
    };
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointercancel', this.onUp);
    canvas.addEventListener('lostpointercapture', this.onUp);

    const settings = this.simulation.settings;
    this.sliders = new ParamSlider();
    this.sliders.addNote('Hold to shelter bubbles beneath your fingertip. Drag slowly to stir the water, or sweep through the stream.');
    this.sliders.addSelect({
      label: 'Playback', value: 'live',
      options: [{ value: 'live', label: 'Flowing' }, { value: 'paused', label: 'Paused' }],
      onChange: value => { this.playing = value === 'live'; },
    });
    this.sliders.addButtons([
      { label: 'New stream', onClick: () => { this.simulation.reset(0x91d26a + ++this.generation * 173); this.pointerId = null; } },
      { label: 'Release cluster', onClick: () => this.simulation.releaseCluster() },
    ]);
    this.sliders.addSection('Water & air');
    this.sliders.addSlider({ label: 'Water flow', min: 0, max: 2, value: settings.flow, step: 0.05,
      onChange: value => { settings.flow = value; } });
    this.sliders.addSlider({ label: 'Rise speed', min: 0.25, max: 1.75, value: settings.rise, step: 0.05,
      onChange: value => { settings.rise = value; } });
    this.sliders.addSlider({ label: 'Bubble size', min: 0.6, max: 1.6, value: settings.size, step: 0.05,
      onChange: value => this.simulation.setSize(value) });
    this.sliders.addSlider({ label: 'Release rate', min: 0, max: 12, value: settings.release, step: 0.5,
      onChange: value => { settings.release = value; } });
  }

  private pointer(event: PointerEvent, canvas: HTMLCanvasElement, active: boolean) {
    const rect = canvas.getBoundingClientRect();
    this.simulation.setPointer((event.clientX - rect.left) / rect.height,
      1 - (event.clientY - rect.top) / rect.height, active);
  }

  resize(ctx: EngineContext) { this.simulation.resize(ctx.width / ctx.height); }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    if (this.playing) this.simulation.advance(ctx.dt);
    const sim = this.simulation;
    const blend = sim.interpolation;
    const time = Math.max(0, sim.time - (1 - blend) / 120);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.bindVertexArray(this.bgVao);
    gl.useProgram(this.bgProgram);
    this.uniforms(gl, this.bgProgram, ctx, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const count = sim.bubbles.length;
    for (let i = 0; i < count; i++) {
      const b = sim.bubbles[i], k = i * 8;
      this.data[k] = b.px + (b.x - b.px) * blend;
      this.data[k + 1] = b.py + (b.y - b.py) * blend;
      this.data[k + 2] = b.radius;
      this.data[k + 3] = b.phase;
      this.data[k + 4] = b.pqx + (b.qx - b.pqx) * blend;
      this.data[k + 5] = b.pqy + (b.qy - b.pqy) * blend;
      this.data[k + 6] = 0.82 + Math.min(b.radius / 0.05, 1) * 0.18;
      this.data[k + 7] = Math.min(0.035, 0.009 + Math.hypot(b.dqx, b.dqy) * 0.035);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.bubbleVao);
    gl.useProgram(this.bubbleProgram);
    this.uniforms(gl, this.bubbleProgram, ctx, time);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, count * 8);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    gl.disable(gl.BLEND);
  }

  private uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, ctx: EngineContext, time: number) {
    const uniforms = this.locs.get(program)!;
    gl.uniform2f(uniforms.u_resolution, ctx.width, ctx.height);
    gl.uniform1f(uniforms.u_time, time);
    const pointer = this.simulation.pointer;
    gl.uniform4f(uniforms.u_pointer, pointer.x, pointer.y, pointer.active ? 1 : 0, PADDLE_RADIUS);
  }

  destroy(ctx: EngineContext) {
    const { gl, canvas } = ctx;
    gl.deleteProgram(this.bgProgram); gl.deleteProgram(this.bubbleProgram);
    gl.deleteVertexArray(this.bgVao); gl.deleteVertexArray(this.bubbleVao);
    gl.deleteBuffer(this.cornerBuffer); gl.deleteBuffer(this.instanceBuffer);
    canvas.removeEventListener('pointerdown', this.onDown);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerup', this.onUp);
    canvas.removeEventListener('pointercancel', this.onUp);
    canvas.removeEventListener('lostpointercapture', this.onUp);
    this.sliders.destroy();
    this.locs.clear();
  }
}
