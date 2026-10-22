import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import background from './display.glsl';
import meshVert from './mesh.vert';
import meshFrag from './mesh.frag';
import { contains, distance, lerp, makeSlab, Point, randomSource, Slab, strikeDistances } from './geometry';

type Color = [number, number, number, number];
const ROTATION = -0.035;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };

export class StoneBreakPlugin implements Plugin {
  readonly name = 'Stone Break';
  private controls!: ParamSlider;
  private backgroundProgram!: WebGLProgram;
  private meshProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private quadVao!: WebGLVertexArrayObject;
  private buffer!: WebGLBuffer;
  private slab!: Slab;
  private aspect = 1;
  private count = 14;
  private roughness = 0.8;
  private strength = 1;
  private material = 0;
  private seed = 4817;
  private now = 0;
  private damage = 0;
  private phase: 'intact' | 'opening' | 'broken' | 'repairing' = 'intact';
  private breakAt = Infinity;
  private repairAt = 0;
  private repairFrom = 0;
  private progress = 0;
  private arrival: number[][] = [];
  private strikePoint: Point = { x: 0, y: 0 };
  private strikeAt = -100;
  private poses: { x: number; y: number; angle: number }[] = [];
  private vertices: number[] = [];
  private locations = new Map<string, WebGLUniformLocation | null>();

  init(ctx: EngineContext) {
    const { gl } = ctx;
    this.backgroundProgram = createProgram(gl, quadVert, background);
    this.meshProgram = createProgram(gl, meshVert, meshFrag);
    for (const name of ['u_aspect', 'u_seed', 'u_material']) this.locations.set(name, gl.getUniformLocation(this.meshProgram, name));
    this.locations.set('u_resolution', gl.getUniformLocation(this.backgroundProgram, 'u_resolution'));
    this.quadVao = gl.createVertexArray()!;
    this.vao = gl.createVertexArray()!;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (const [index, size, offset] of [[0, 2, 0], [1, 2, 2], [2, 4, 4], [3, 1, 8]]) {
      gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, size, gl.FLOAT, false, 9 * 4, offset * 4);
    }
    this.resize(ctx);
    this.controls = new ParamSlider();
    this.controls.addNote('Tap the stone to grow a fracture. Several strikes open the slab along those same seams. Tap the pieces to reassemble.');
    this.controls.addSection('The stone');
    this.controls.addSelect({ label: 'Material', value: '0', options: [
      { value: '0', label: 'Warm limestone' }, { value: '1', label: 'Blue slate' }, { value: '2', label: 'Rose granite' },
    ], onChange: value => { this.material = Number(value); } });
    this.controls.addSelect({ label: 'Fragments', value: '14', options: [
      { value: '10', label: 'Large · 10 pieces' }, { value: '14', label: 'Medium · 14 pieces' }, { value: '18', label: 'Small · 18 pieces' },
    ], onChange: value => { this.count = Number(value); this.newStone(false); } });
    this.controls.addSlider({ label: 'Edge roughness', min: 0.2, max: 1, value: this.roughness, step: 0.05,
      onChange: value => { this.roughness = value; this.newStone(false); } });
    this.controls.addSlider({ label: 'Strike force', min: 0.6, max: 1.6, value: this.strength, step: 0.1,
      onChange: value => { this.strength = value; } });
    this.controls.addButtons([
      { label: 'Reassemble', onClick: () => this.reassemble() },
      { label: 'New stone', onClick: () => this.newStone(true) },
    ]);
  }

  resize(ctx: EngineContext) { this.aspect = ctx.width / ctx.height; this.newStone(false); }

  private newStone(next: boolean) {
    if (next) this.seed += 7919;
    const width = Math.min(2.15, this.aspect * 1.48);
    const height = Math.min(1.3, width / 1.35);
    this.slab = makeSlab(width, height, this.count, this.roughness, this.seed);
    this.arrival = this.slab.seams.map(edge => edge.points.map(() => Infinity));
    this.phase = 'intact'; this.damage = 0; this.progress = 0; this.breakAt = Infinity; this.strikeAt = -100;
    const random = randomSource(this.seed + 37);
    this.poses = this.slab.fragments.map(piece => {
      // A gentle dilation opens neighboring pieces apart consistently;
      // independent normalized kicks can make near-center fragments collide.
      return { x: piece.center.x * 0.23, y: piece.center.y * 0.27 - 0.035, angle: (random() - 0.5) * 0.075 };
    });
  }

  private reassemble() {
    if (this.phase === 'repairing') return;
    if (this.progress < 0.001) { this.newStone(false); return; }
    this.repairFrom = this.progress; this.repairAt = this.now; this.phase = 'repairing';
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    if (event.type !== 'tap') return;
    if (this.phase === 'broken') { this.reassemble(); return; }
    if (this.phase !== 'intact') return;
    const x = (event.pos.x * 2 - 1) * this.aspect, y = 1 - event.pos.y * 2 - 0.04;
    const point = { x: x * Math.cos(ROTATION) + y * Math.sin(ROTATION), y: -x * Math.sin(ROTATION) + y * Math.cos(ROTATION) };
    if (!contains(this.slab.outline, point)) return;
    this.strikePoint = point; this.strikeAt = this.now;
    this.damage = Math.min(1, this.damage + 0.235 * this.strength);
    const distances = strikeDistances(this.slab, point);
    const reach = 0.32 + this.damage * 1.5;
    let finish = this.now;
    distances.forEach((edge, i) => edge.forEach((d, j) => {
      if (!Number.isFinite(d) || (this.damage < 1 && d > reach)) return;
      const arrival = this.now + 0.025 + d / (this.damage >= 1 ? 3.8 : 1.9);
      this.arrival[i][j] = Math.min(this.arrival[i][j], arrival);
      finish = Math.max(finish, this.arrival[i][j]);
    }));
    if (this.damage >= 1) { this.breakAt = finish + 0.16; this.phase = 'opening'; }
  }

  private transform(p: Point, piece: number, extra = 0): Point {
    const fragment = this.slab.fragments[piece], pose = this.poses[piece];
    const angle = pose.angle * this.progress, c = Math.cos(angle), s = Math.sin(angle);
    const dx = p.x - fragment.center.x, dy = p.y - fragment.center.y;
    const lift = this.phase === 'opening' ? Math.sin(Math.min(1, Math.max(0, this.now - this.breakAt) / 0.65) * Math.PI) * 0.065 : 0;
    const x = fragment.center.x + dx * c - dy * s + pose.x * this.progress;
    const y = fragment.center.y + dx * s + dy * c + pose.y * this.progress + lift;
    const shake = Math.exp(-Math.max(0, this.now - this.strikeAt) * 14) * 0.006;
    return { x: x * Math.cos(ROTATION) - y * Math.sin(ROTATION) + Math.sin(this.now * 83) * shake,
      y: x * Math.sin(ROTATION) + y * Math.cos(ROTATION) + 0.04 + extra + Math.sin(this.now * 71) * shake };
  }

  private vertex(p: Point, uv: Point, color: Color, kind = 0) { this.vertices.push(p.x, p.y, uv.x, uv.y, ...color, kind); }
  private triangle(a: Point, b: Point, c: Point, color: Color, kind = 0, uv = [a, b, c]) {
    this.vertex(a, uv[0], color, kind); this.vertex(b, uv[1], color, kind); this.vertex(c, uv[2], color, kind);
  }
  private line(a: Point, b: Point, width: number, color: Color) {
    const length = distance(a, b); if (length < 1e-8) return;
    const dx = -(b.y - a.y) / length * width * 0.5, dy = (b.x - a.x) / length * width * 0.5;
    const p = { x: a.x + dx, y: a.y + dy }, q = { x: b.x + dx, y: b.y + dy };
    const r = { x: b.x - dx, y: b.y - dy }, s = { x: a.x - dx, y: a.y - dy };
    this.triangle(p, q, r, color); this.triangle(p, r, s, color);
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;
    this.now += ctx.dt;
    if (this.phase === 'opening' && this.now >= this.breakAt) {
      const elapsed = this.now - this.breakAt;
      this.progress = 1 - Math.exp(-elapsed * 5.2) * Math.cos(elapsed * 5);
      if (elapsed >= 1.4) { this.phase = 'broken'; this.progress = 1; }
    } else if (this.phase === 'repairing') {
      this.progress = this.repairFrom * (1 - smooth((this.now - this.repairAt) / 0.85));
      if (this.now - this.repairAt >= 0.85) this.newStone(false);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, ctx.width, ctx.height);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(this.backgroundProgram); gl.bindVertexArray(this.quadVao);
    gl.uniform2f(this.locations.get('u_resolution')!, ctx.width, ctx.height); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.vertices = [];
    // Soft contact shadows are drawn before every side and top surface.
    this.slab.fragments.forEach((piece, id) => {
      for (let layer = 4; layer >= 0; layer--) {
        const points = piece.boundary.map(p => {
          const q = { x: piece.center.x + (p.x - piece.center.x) * (1 + layer * 0.012), y: piece.center.y + (p.y - piece.center.y) * (1 + layer * 0.012) };
          const v = this.transform(q, id, -0.067 - layer * 0.007); v.x += 0.015; return v;
        });
        for (let i = 0; i < piece.triangles.length; i += 3) this.triangle(points[piece.triangles[i]], points[piece.triangles[i + 1]], points[piece.triangles[i + 2]], [0.015, 0.022, 0.023, 0.11]);
      }
    });
    this.slab.fragments.forEach((piece, id) => {
      for (const { id: edgeId, forward } of piece.edges) {
        const edge = this.slab.seams[edgeId];
        // An intact slab has one continuous outer sidewall. Interior faces
        // become visible only when the matching fracture opens.
        if (edge.owners.length === 2 && this.progress < 0.005) continue;
        const points = forward ? edge.points : edge.points.slice().reverse();
        for (let j = 1; j < points.length; j++) {
          const a = this.transform(points[j - 1], id), b = this.transform(points[j], id);
          const c = { x: b.x + 0.008, y: b.y - 0.046 }, d = { x: a.x + 0.008, y: a.y - 0.046 };
          const light = 0.46 + 0.13 * (b.x - a.x) / (distance(a, b) || 1);
          const color: Color = [light, light, light, 1];
          this.triangle(a, b, c, color, 1, [points[j - 1], points[j], points[j]]);
          this.triangle(a, c, d, color, 1, [points[j - 1], points[j], points[j - 1]]);
        }
      }
    });
    this.slab.fragments.forEach((piece, id) => {
      const points = piece.boundary.map(p => this.transform(p, id));
      for (let i = 0; i < piece.triangles.length; i += 3) {
        const [a, b, c] = piece.triangles.slice(i, i + 3);
        this.triangle(points[a], points[b], points[c], [1.13, 1.13, 1.13, 1], 1, [piece.boundary[a], piece.boundary[b], piece.boundary[c]]);
      }
      for (const { id: edgeId, forward } of piece.edges) {
        const edge = this.slab.seams[edgeId];
        if (edge.owners.length === 2 && this.progress < 0.005) continue;
        const path = forward ? edge.points : edge.points.slice().reverse();
        for (let j = 1; j < path.length; j++) {
          const a = this.transform(path[j - 1], id), b = this.transform(path[j], id);
          const light = clamp(0.5 + (a.x - b.x + a.y - b.y) / (distance(a, b) || 1) * 0.3);
          this.line(a, b, 0.0032, [0.95, 0.87, 0.70, light * 0.35]);
        }
      }
    });
    if (this.progress < 0.005) this.slab.seams.forEach((edge, id) => {
      if (edge.owners.length !== 2) return;
      for (let j = 1; j < edge.points.length; j++) {
        const ta = this.arrival[id][j - 1], tb = this.arrival[id][j];
        if (Math.min(ta, tb) > this.now) continue;
        let a = edge.points[j - 1], b = edge.points[j];
        if (this.now < tb) b = lerp(a, b, clamp((this.now - ta) / (tb - ta)));
        if (this.now < ta) a = lerp(b, a, clamp((this.now - tb) / (ta - tb)));
        a = this.transform(a, edge.owners[0]); b = this.transform(b, edge.owners[0]);
        const opacity = this.phase === 'repairing' ? 1 - smooth((this.now - this.repairAt) / 0.85) : 1;
        this.line(a, b, 0.011, [0.13, 0.12, 0.10, 0.25 * opacity]);
        this.line(a, b, 0.0045, [0.035, 0.037, 0.033, 0.92 * opacity]);
      }
    });
    const age = this.now - this.strikeAt;
    if (age >= 0 && age < 0.38) {
      const center = this.transform(this.strikePoint, 0), radius = 0.015 + age * 0.20;
      for (let j = 0; j < 24; j++) {
        const a = j / 24 * Math.PI * 2, b = (j + 1) / 24 * Math.PI * 2;
        this.line({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius }, { x: center.x + Math.cos(b) * radius, y: center.y + Math.sin(b) * radius }, 0.002, [0.88, 0.79, 0.61, (1 - age / 0.38) * 0.5]);
      }
    }
    gl.useProgram(this.meshProgram); gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.vertices), gl.DYNAMIC_DRAW);
    gl.uniform1f(this.locations.get('u_aspect')!, this.aspect);
    gl.uniform1f(this.locations.get('u_seed')!, this.seed);
    gl.uniform1i(this.locations.get('u_material')!, this.material);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertices.length / 9); gl.disable(gl.BLEND);
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.backgroundProgram); gl.deleteProgram(this.meshProgram);
    gl.deleteVertexArray(this.vao); gl.deleteVertexArray(this.quadVao); gl.deleteBuffer(this.buffer);
    this.controls.destroy();
  }
}
