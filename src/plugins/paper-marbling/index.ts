import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import traceSrc from './trace.glsl';
import displaySrc from './display.glsl';
import { PALETTES, RECIPES, Recipe, StrokeTool, Vec2, buildRecipe } from './recipes';

// ── Paper marbling (ebru / suminagashi) ───────────────────────────────
// The bath is an ordered list of ops — ink drops and stylus/comb strokes —
// each an exactly invertible deformation of the floating paint. trace.glsl
// replays the inverse maps per pixel, so nothing is ever resampled and
// combed lines stay sharp. To keep the per-frame replay short, an exact
// bake of all settled ops is rebuilt a few rows per frame in the
// background; the live pass only replays ops newer than the bake.

const OPS_PER_ROW = 512;  // must match trace.glsl
const OP_FLOATS = 12;     // 3 RGBA32F texels per op
const MAX_OPS = 4096;
const FLATTEN_AT = 1536;  // past this, the bake becomes a flattened base layer
const BAKE_MIN_OPS = 12;  // settled ops that trigger a new bake...
const BAKE_QUIET = 0.25;  // ...or any settled ops once the bath is this quiet (s)
const MARGIN_BU = 0.12;   // bake covers the screen plus this margin (bath units)
const CHORD_TOL_PX = 0.6; // a stroke op grows while the path stays this straight
const MIN_SEG_PX = 1.0;
const COMB_LOCK_PX = 14;  // comb direction locks after this much travel
const TOOL_SMOOTH = 0.025; // pointer smoothing time constant (s)
const LAY_TIME = 1.1;
const FLIP_TIME = 1.0;
const ROD_DEFAULT = 0.0045;

function stylusTool(size: number, kappa: number): StrokeTool {
  return { tines: 1, spacing: 0, size, kappa, axis: [0, 1] };
}

type Tool = 'stylus' | 'comb' | 'drops';

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

/** A stroke being drawn: the open op keeps growing while the path is straight */
interface ActiveStroke {
  tool: StrokeTool;
  anchor: Vec2;  // start of the open op
  last: Vec2;
  pts: Vec2[];   // tool positions since the anchor, for the straightness test
  op: number;    // open op index, −1 until the tool has moved far enough
}

interface RecipeRun {
  recipe: Recipe;
  t: number;
  dropIdx: number;
  strokeIdx: number;
  stroke: ActiveStroke | null;
}

export class PaperMarblingPlugin implements Plugin {
  readonly name = 'Paper Marbling';

  private traceProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private opsTex!: WebGLTexture;
  private traceLocs: Record<string, WebGLUniformLocation | null> = {};
  private displayLocs: Record<string, WebGLUniformLocation | null> = {};

  // Op list, laid out exactly as the op texture rows
  private ops = new Float32Array(MAX_OPS * OP_FLOATS);
  private opCount = 0;
  private dirtyLo = MAX_OPS;
  private dirtyHi = 0;
  private cumCost = new Float64Array(MAX_OPS + 1);
  private lastOpChange = 0;

  private paint!: Target;
  private bakes: Target[] = [];
  private bakeCur = 0;
  private bakeCount = 0;
  private building: { target: number; row: number } | null = null;
  private bakeBudget = 6e7; // op·pixel evaluations per frame, adapted to frame time
  private flat: Target | null = null;
  private pendingFlatDelete: Target | null = null; // freed on the next frame (needs gl)
  private flatRect: [number, number, number, number] = [0, 0, 0, 0];
  private paintDirty = true;
  private pxPerBU = 1;
  private aspect = 1;
  private bakeRect: [number, number, number, number] = [0, 0, 1, 1];
  private paintRect: [number, number, number, number] = [0, 0, 1, 1];

  // Interaction
  private sliders!: ParamSlider;
  private patternSelect!: HTMLSelectElement;
  private paletteSelect!: HTMLSelectElement;
  private tool: Tool = 'stylus';
  private paletteId = 'ottoman';
  private dropSize = 0.06;
  private drag = 0.9;
  private rodSize = ROD_DEFAULT;
  private combSpacing = 0.05;
  private colorIndex = 0;
  private time = 0;

  private dragging = false;
  private pointer: Vec2 = [0, 0];
  private toolPos: Vec2 = [0, 0];
  private userStroke: ActiveStroke | null = null;
  private combStart: Vec2 | null = null;
  private combDir: Vec2 | null = null;
  private sprinkleTravel = 0;
  private toolAlpha = 0;
  private shownTool: StrokeTool = stylusTool(ROD_DEFAULT, 0.9);
  private recipe: RecipeRun | null = null;

  private printPhase = 0; // 0 bath, 1 laying, 2 flipping, 3 viewing
  private printT = 0;
  private hint: HTMLDivElement | null = null;

  init(ctx: EngineContext) {
    const { gl } = ctx;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not supported');
    this.traceProgram = createProgram(gl, quadVert, traceSrc);
    this.displayProgram = createProgram(gl, quadVert, displaySrc);
    this.vao = gl.createVertexArray()!;
    for (const name of ['u_ops', 'u_opEnd', 'u_bakeCount', 'u_bake', 'u_bakeRect', 'u_flat', 'u_flatRect',
      'u_targetRect', 'u_pxPerBU', 'u_time']) {
      this.traceLocs[name] = gl.getUniformLocation(this.traceProgram, name);
    }
    for (const name of ['u_paint', 'u_resolution', 'u_time', 'u_toolPos', 'u_toolAxis', 'u_toolGeo',
      'u_printPhase', 'u_printT']) {
      this.displayLocs[name] = gl.getUniformLocation(this.displayProgram, name);
    }

    this.opsTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.opsTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, OPS_PER_ROW * 3, MAX_OPS / OPS_PER_ROW, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    this.allocTargets(ctx);
    this.buildUI();
    this.startRecipe('bullseye', true);
  }

  // ── Render targets ──────────────────────────────────────────────────

  private createTarget(gl: WebGL2RenderingContext, w: number, h: number): Target {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.clearColor(0, 0, 0, 1);
    return { tex, fbo, w, h };
  }

  private deleteTarget(gl: WebGL2RenderingContext, t: Target | null) {
    if (!t) return;
    gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
  }

  /**
   * Paint and bake share one texel grid (bake = paint + whole-texel margin),
   * so an untouched pixel samples the bake exactly at a texel centre.
   * Very dense screens trace at 2× density instead of native.
   */
  private allocTargets(ctx: EngineContext) {
    const { gl } = ctx;
    this.deleteTarget(gl, this.paint);
    this.bakes.forEach((b) => this.deleteTarget(gl, b));
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const dpr = window.devicePixelRatio || 1;
    const scale = dpr > 2 ? 2 / dpr : 1;
    let pw = Math.max(1, Math.round(ctx.width * scale));
    let ph = Math.max(1, Math.round(ctx.height * scale));
    let margin = Math.round(MARGIN_BU * ph);
    const fit = Math.min(1, (maxTex - 2) / (Math.max(pw, ph) + 2 * margin));
    pw = Math.max(1, Math.floor(pw * fit));
    ph = Math.max(1, Math.floor(ph * fit));
    margin = Math.round(MARGIN_BU * ph);

    this.pxPerBU = ph;
    this.aspect = pw / ph;
    this.paintRect = [-this.aspect / 2, -0.5, this.aspect, 1];
    this.bakeRect = [-this.aspect / 2 - margin / ph, -0.5 - margin / ph, (pw + 2 * margin) / ph, (ph + 2 * margin) / ph];
    this.paint = this.createTarget(gl, pw, ph);
    this.bakes = [
      this.createTarget(gl, pw + 2 * margin, ph + 2 * margin),
      this.createTarget(gl, pw + 2 * margin, ph + 2 * margin),
    ];
    this.bakeCur = 0;
    this.bakeCount = 0;
    this.building = null;
    this.paintDirty = true;
  }

  resize(ctx: EngineContext) {
    this.allocTargets(ctx);
  }

  // ── Op list ─────────────────────────────────────────────────────────

  private reserveOp(ctx: EngineContext): number {
    if (this.opCount >= MAX_OPS) {
      // The background bake fell far behind: settle everything now
      this.bakeNow(ctx);
      this.flatten(ctx);
      if (this.opCount >= MAX_OPS) return -1;
    }
    const i = this.opCount++;
    this.ops.fill(0, i * OP_FLOATS, (i + 1) * OP_FLOATS);
    return i;
  }

  private markDirty(i: number) {
    this.dirtyLo = Math.min(this.dirtyLo, i);
    this.dirtyHi = Math.max(this.dirtyHi, i + 1);
    this.paintDirty = true;
    this.lastOpChange = this.time;
  }

  private updateCost(i: number) {
    const o = i * OP_FLOATS;
    const w = this.ops[o] < 0.5 ? 1 : this.ops[o + 3] > 1.5 ? 6 : 3;
    this.cumCost[i + 1] = this.cumCost[i] + w;
  }

  private addDrop(ctx: EngineContext, x: number, y: number, r: number, rgb: [number, number, number], alpha: number) {
    const i = this.reserveOp(ctx);
    if (i < 0) return;
    const o = i * OP_FLOATS;
    const jitter = 1 + (Math.random() - 0.5) * 0.07;
    this.ops.set([0, x, y, r, this.time, 0.05 + Math.random() * 0.9, alpha, 0.35 + 4 * r,
      rgb[0] * jitter, rgb[1] * jitter, rgb[2] * jitter, 0], o);
    this.updateCost(i);
    this.markDirty(i);
  }

  private addStroke(ctx: EngineContext, a: Vec2, b: Vec2, tool: StrokeTool): number {
    const i = this.reserveOp(ctx);
    if (i < 0) return -1;
    this.ops.set([1, a[0], a[1], tool.tines, b[0], b[1], tool.spacing, tool.size,
      tool.axis[0], tool.axis[1], tool.kappa, 0], i * OP_FLOATS);
    this.updateCost(i);
    this.markDirty(i);
    return i;
  }

  /** Ops below the first one still changing (open stroke, spreading drop) */
  private settledCount(): number {
    const open = new Set<number>();
    if (this.userStroke) open.add(this.userStroke.op);
    if (this.recipe?.stroke) open.add(this.recipe.stroke.op);
    let i = this.bakeCount;
    for (; i < this.opCount; i++) {
      const o = i * OP_FLOATS;
      if (open.has(i)) break;
      if (this.ops[o] < 0.5 && this.time < this.ops[o + 4] + this.ops[o + 7]) break;
    }
    return i;
  }

  // ── Strokes ─────────────────────────────────────────────────────────

  private beginStroke(at: Vec2, tool: StrokeTool): ActiveStroke {
    return { tool, anchor: at, last: at, pts: [], op: -1 };
  }

  private strokeTo(ctx: EngineContext, s: ActiveStroke, pos: Vec2, tolPx = CHORD_TOL_PX) {
    if (Math.hypot(pos[0] - s.last[0], pos[1] - s.last[1]) < 1e-7) return;
    s.last = pos;
    const minSeg = MIN_SEG_PX / this.pxPerBU;
    if (s.op < 0) {
      if (Math.hypot(pos[0] - s.anchor[0], pos[1] - s.anchor[1]) < minSeg) return;
      s.op = this.addStroke(ctx, s.anchor, pos, s.tool);
      s.pts = [pos];
      return;
    }
    // Grow the open op while every point since its anchor stays on the chord;
    // a straight stroke split anywhere composes exactly, so this is lossless
    const tol = tolPx / this.pxPerBU;
    const dx = pos[0] - s.anchor[0];
    const dy = pos[1] - s.anchor[1];
    const len = Math.hypot(dx, dy);
    let straight = len > minSeg && s.pts.length < 512;
    for (let k = 0; straight && k < s.pts.length; k++) {
      const rx = s.pts[k][0] - s.anchor[0];
      const ry = s.pts[k][1] - s.anchor[1];
      const along = (rx * dx + ry * dy) / len;
      const across = Math.abs(rx * dy - ry * dx) / len;
      if (across > tol || along < -tol || along > len + tol) straight = false;
    }
    if (straight) {
      s.pts.push(pos);
      const o = s.op * OP_FLOATS;
      this.ops[o + 4] = pos[0];
      this.ops[o + 5] = pos[1];
      this.markDirty(s.op);
      return;
    }
    // Close the op at its current end and start the next from there
    const end: Vec2 = s.pts[s.pts.length - 1];
    s.anchor = end;
    s.pts = [];
    s.op = -1;
    s.last = end;
    this.strokeTo(ctx, s, pos, tolPx);
  }

  private userTool(): StrokeTool {
    if (this.tool === 'comb' && this.combDir) {
      const axis: Vec2 = [-this.combDir[1], this.combDir[0]];
      const span = 2 * Math.hypot(this.aspect, 1) + 0.4;
      return { tines: Math.ceil(span / this.combSpacing) + 1, spacing: this.combSpacing, size: this.rodSize, kappa: this.drag, axis };
    }
    return stylusTool(this.rodSize, this.drag);
  }

  // ── Recipes ─────────────────────────────────────────────────────────

  private startRecipe(id: string, fresh: boolean) {
    if (fresh) this.clearBath();
    const palette = PALETTES[this.paletteId];
    this.recipe = {
      recipe: buildRecipe(id, this.aspect, palette.colors.length, Math.random),
      t: 0, dropIdx: 0, strokeIdx: 0, stroke: null,
    };
  }

  private spatter() {
    const n = 36;
    const drops = [];
    for (let k = 0; k < n; k++) {
      drops.push({
        at: Math.random() * 1.2,
        x: (Math.random() - 0.5) * this.aspect,
        y: Math.random() - 0.5,
        r: this.dropSize * (0.35 + 0.55 * Math.random()),
        color: -2, // random palette colour
      });
    }
    drops.sort((a, b) => a.at - b.at);
    this.recipe = { recipe: { drops, strokes: [], end: 1.2 }, t: 0, dropIdx: 0, strokeIdx: 0, stroke: null };
  }

  private stepRecipe(ctx: EngineContext, dt: number) {
    const run = this.recipe;
    if (!run) return;
    run.t += dt;
    const { drops, strokes } = run.recipe;
    const palette = PALETTES[this.paletteId];
    while (run.dropIdx < drops.length && drops[run.dropIdx].at <= run.t) {
      const d = drops[run.dropIdx++];
      const color = d.color === -2 ? Math.floor(Math.random() * palette.colors.length) : d.color;
      if (color < 0) this.addDrop(ctx, d.x, d.y, d.r, [0, 0, 0], 0);
      else this.addDrop(ctx, d.x, d.y, d.r, palette.colors[color % palette.colors.length], 1);
    }
    const spec = strokes[run.strokeIdx];
    if (spec && run.t >= spec.start) {
      const u = Math.min(1, (run.t - spec.start) / spec.dur);
      const pos = spec.path(u);
      if (!run.stroke) run.stroke = this.beginStroke(spec.path(0), spec.tool);
      this.strokeTo(ctx, run.stroke, pos, spec.tool.tines > 1 ? 2.0 : CHORD_TOL_PX);
      this.shownTool = spec.tool;
      this.toolPos = pos;
      if (u >= 1) {
        run.stroke = null;
        run.strokeIdx++;
      }
    }
    if (run.t >= run.recipe.end && run.dropIdx >= drops.length && run.strokeIdx >= strokes.length) {
      this.recipe = null;
    }
  }

  // ── Bake scheduling ─────────────────────────────────────────────────

  private bindTrace(gl: WebGL2RenderingContext, opEnd: number, bakeCount: number, rect: number[]) {
    const L = this.traceLocs;
    gl.useProgram(this.traceProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.opsTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bakes[this.bakeCur].tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.flat ? this.flat.tex : this.bakes[this.bakeCur].tex);
    gl.uniform1i(L.u_ops, 0);
    gl.uniform1i(L.u_bake, 1);
    gl.uniform1i(L.u_flat, 2);
    gl.uniform1i(L.u_opEnd, opEnd);
    gl.uniform1i(L.u_bakeCount, bakeCount);
    gl.uniform4fv(L.u_bakeRect, this.bakeRect);
    gl.uniform4fv(L.u_flatRect, this.flat ? this.flatRect : [0, 0, 0, 0]);
    gl.uniform4fv(L.u_targetRect, rect);
    gl.uniform1f(L.u_pxPerBU, this.pxPerBU);
    gl.uniform1f(L.u_time, this.time);
    gl.bindVertexArray(this.vao);
  }

  private uploadOps(gl: WebGL2RenderingContext) {
    if (this.dirtyHi <= this.dirtyLo) return;
    const rowLo = Math.floor(this.dirtyLo / OPS_PER_ROW);
    const rowHi = Math.ceil(this.dirtyHi / OPS_PER_ROW);
    const rowFloats = OPS_PER_ROW * OP_FLOATS;
    gl.bindTexture(gl.TEXTURE_2D, this.opsTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, rowLo, OPS_PER_ROW * 3, rowHi - rowLo, gl.RGBA, gl.FLOAT,
      this.ops.subarray(rowLo * rowFloats, rowHi * rowFloats));
    this.dirtyLo = MAX_OPS;
    this.dirtyHi = 0;
  }

  /** Trace `rows` rows of the in-progress bake, scissored to a strip */
  private bakeRows(gl: WebGL2RenderingContext, target: number, row: number, rows: number) {
    const dst = this.bakes[1 - this.bakeCur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
    gl.viewport(0, 0, dst.w, dst.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, row, dst.w, rows);
    this.bindTrace(gl, target, 0, this.bakeRect);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }

  private stepBake(ctx: EngineContext) {
    const { gl } = ctx;
    if (!this.building) {
      const settled = this.settledCount();
      const pending = settled - this.bakeCount;
      if (pending >= BAKE_MIN_OPS || (pending > 0 && this.time - this.lastOpChange > BAKE_QUIET)) {
        this.building = { target: settled, row: 0 };
      } else if (this.bakeCount >= FLATTEN_AT) {
        this.flatten(ctx);
      }
    }
    const b = this.building;
    if (!b) return;
    // Hold the frame rate: shrink the per-frame strip when frames run long
    if (ctx.dt > 1 / 40) this.bakeBudget = Math.max(2e6, this.bakeBudget * 0.85);
    else if (ctx.dt < 1 / 55) this.bakeBudget = Math.min(4e8, this.bakeBudget * 1.05);
    const dst = this.bakes[1 - this.bakeCur];
    const cost = Math.max(1, this.cumCost[b.target]);
    const rows = Math.max(2, Math.min(dst.h - b.row, Math.floor(this.bakeBudget / (dst.w * cost))));
    this.bakeRows(gl, b.target, b.row, rows);
    b.row += rows;
    if (b.row >= dst.h) {
      this.bakeCur = 1 - this.bakeCur;
      this.bakeCount = b.target;
      this.building = null;
    }
  }

  /** Synchronously bake every settled op (only when the op list is full) */
  private bakeNow(ctx: EngineContext) {
    const { gl } = ctx;
    this.uploadOps(gl);
    const target = this.settledCount();
    const dst = this.bakes[1 - this.bakeCur];
    this.bakeRows(gl, target, 0, dst.h);
    this.bakeCur = 1 - this.bakeCur;
    this.bakeCount = target;
    this.building = null;
  }

  /**
   * Fold the bake into a flattened base layer and drop the ops it absorbed.
   * The one place paint is resampled — once per FLATTEN_AT ops.
   */
  private flatten(ctx: EngineContext) {
    const { gl } = ctx;
    const n = this.bakeCount;
    if (n === 0) return;
    this.deleteTarget(gl, this.flat);
    const done = this.bakes[this.bakeCur];
    this.flat = done;
    this.flatRect = [...this.bakeRect];
    this.bakes[this.bakeCur] = this.createTarget(gl, done.w, done.h);
    this.ops.copyWithin(0, n * OP_FLOATS, this.opCount * OP_FLOATS);
    this.opCount -= n;
    this.bakeCount = 0;
    this.building = null;
    for (const s of [this.userStroke, this.recipe?.stroke]) {
      if (s && s.op >= 0) s.op -= n;
    }
    for (let i = 0; i < this.opCount; i++) this.updateCost(i);
    this.dirtyLo = 0;
    this.dirtyHi = Math.max(1, this.opCount);
  }

  private clearBath() {
    this.opCount = 0;
    this.bakeCount = 0;
    this.building = null;
    this.userStroke = null;
    this.recipe = null;
    this.flatRect = [0, 0, 0, 0];
    this.pendingFlatDelete = this.flat;
    this.flat = null;
    this.paintDirty = true;
    this.lastOpChange = this.time;
  }

  // ── Frame ───────────────────────────────────────────────────────────

  render(ctx: EngineContext) {
    const { gl } = ctx;
    const dt = ctx.dt;
    this.time = ctx.time;
    if (this.pendingFlatDelete) {
      this.deleteTarget(gl, this.pendingFlatDelete);
      this.pendingFlatDelete = null;
    }

    if (this.printPhase > 0) {
      this.stepPrint(dt);
    } else {
      this.stepRecipe(ctx, dt);
      this.stepUser(ctx, dt);
    }

    this.uploadOps(gl);
    this.stepBake(ctx);
    this.uploadOps(gl);

    // Spreading drops keep the paint changing frame to frame
    const settled = this.settledCount();
    if (settled < this.opCount) this.paintDirty = true;
    if (this.paintDirty) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.paint.fbo);
      gl.viewport(0, 0, this.paint.w, this.paint.h);
      this.bindTrace(gl, this.opCount, this.bakeCount, this.paintRect);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.paintDirty = false;
    }

    // Composite to screen
    const showTool = this.dragging && this.tool !== 'drops' && (this.tool !== 'comb' || this.combDir !== null);
    const target = showTool || this.recipe?.stroke ? 1 : 0;
    this.toolAlpha += (target - this.toolAlpha) * (1 - Math.exp(-dt / 0.08));
    if (target === 0 && this.toolAlpha < 0.01) this.toolAlpha = 0;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    const D = this.displayLocs;
    gl.useProgram(this.displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paint.tex);
    gl.uniform1i(D.u_paint, 0);
    gl.uniform2f(D.u_resolution, ctx.width, ctx.height);
    gl.uniform1f(D.u_time, this.time);
    const t = this.shownTool;
    gl.uniform2f(D.u_toolPos, this.toolPos[0], this.toolPos[1]);
    gl.uniform2f(D.u_toolAxis, t.axis[0], t.axis[1]);
    gl.uniform4f(D.u_toolGeo, t.tines, t.spacing, t.size, this.toolAlpha);
    gl.uniform1i(D.u_printPhase, this.printPhase);
    gl.uniform1f(D.u_printT, this.printT);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private stepUser(ctx: EngineContext, dt: number) {
    if (!this.dragging || this.tool === 'drops') return;
    let target = this.pointer;
    if (this.tool === 'comb') {
      // A rake is pulled straight: lock its heading after a little travel
      if (!this.combStart) return;
      if (!this.combDir) {
        const dx = target[0] - this.combStart[0];
        const dy = target[1] - this.combStart[1];
        const len = Math.hypot(dx, dy);
        if (len * this.pxPerBU < COMB_LOCK_PX) return;
        this.combDir = [dx / len, dy / len];
        this.toolPos = this.combStart;
        this.userStroke = this.beginStroke(this.combStart, this.userTool());
        this.shownTool = this.userStroke.tool;
      }
      const along = (target[0] - this.combStart[0]) * this.combDir[0] + (target[1] - this.combStart[1]) * this.combDir[1];
      target = [this.combStart[0] + this.combDir[0] * along, this.combStart[1] + this.combDir[1] * along];
    }
    const k = 1 - Math.exp(-dt / TOOL_SMOOTH);
    this.toolPos = [this.toolPos[0] + (target[0] - this.toolPos[0]) * k, this.toolPos[1] + (target[1] - this.toolPos[1]) * k];
    if (this.userStroke) this.strokeTo(ctx, this.userStroke, this.toolPos);
  }

  // ── Input ───────────────────────────────────────────────────────────

  private toBath(e: GestureEvent): Vec2 {
    return [(e.pos.x - 0.5) * this.aspect, 0.5 - e.pos.y];
  }

  private nextColor(): { rgb: [number, number, number]; alpha: number } {
    const palette = PALETTES[this.paletteId];
    const k = this.colorIndex++;
    if (palette.alternateClear) {
      if (k % 2 === 1) return { rgb: [0, 0, 0], alpha: 0 };
      return { rgb: palette.colors[(k >> 1) % palette.colors.length], alpha: 1 };
    }
    return { rgb: palette.colors[k % palette.colors.length], alpha: 1 };
  }

  onGesture(ctx: EngineContext, event: GestureEvent) {
    this.time = ctx.time;
    if (this.printPhase > 0) {
      if (this.printPhase === 3 && event.type === 'tap') this.endPrint();
      return;
    }
    const pos = this.toBath(event);
    if (event.type === 'tap') {
      const c = this.nextColor();
      this.addDrop(ctx, pos[0], pos[1], this.dropSize * (0.9 + 0.2 * Math.random()), c.rgb, c.alpha);
      return;
    }
    if (event.type === 'drag-start') {
      this.recipe = null;
      this.dragging = true;
      this.pointer = pos;
      this.toolPos = pos;
      this.sprinkleTravel = 0;
      this.combStart = this.tool === 'comb' ? pos : null;
      this.combDir = null;
      if (this.tool === 'stylus') {
        this.userStroke = this.beginStroke(pos, this.userTool());
        this.shownTool = this.userStroke.tool;
      }
      return;
    }
    if (event.type === 'drag-move') {
      if (this.tool === 'drops') {
        this.sprinkleTravel += Math.hypot(pos[0] - this.pointer[0], pos[1] - this.pointer[1]);
        if (this.sprinkleTravel > this.dropSize * 0.9) {
          this.sprinkleTravel = 0;
          const palette = PALETTES[this.paletteId];
          const c = palette.alternateClear ? this.nextColor()
            : { rgb: palette.colors[Math.floor(Math.random() * palette.colors.length)], alpha: 1 };
          const j = this.dropSize * 0.6;
          this.addDrop(ctx, pos[0] + (Math.random() - 0.5) * j, pos[1] + (Math.random() - 0.5) * j,
            this.dropSize * (0.4 + 0.4 * Math.random()), c.rgb, c.alpha);
        }
      }
      this.pointer = pos;
      return;
    }
    if (event.type === 'drag-end') {
      this.pointer = pos;
      if (this.userStroke) {
        // Land exactly where the pointer let go
        this.stepUser(ctx, 1);
      }
      this.dragging = false;
      this.userStroke = null;
      this.combStart = null;
      this.combDir = null;
    }
  }

  // ── Print ───────────────────────────────────────────────────────────

  private startPrint() {
    if (this.printPhase > 0) return;
    this.recipe = null;
    this.dragging = false;
    this.userStroke = null;
    this.printPhase = 1;
    this.printT = 0;
  }

  private stepPrint(dt: number) {
    if (this.printPhase === 1) {
      this.printT += dt / LAY_TIME;
      if (this.printT >= 1) { this.printPhase = 2; this.printT = 0; }
    } else if (this.printPhase === 2) {
      this.printT += dt / FLIP_TIME;
      if (this.printT >= 1) {
        this.printPhase = 3;
        this.printT = 1;
        this.showHint('Tap to skim the bath and start again');
      }
    }
  }

  private endPrint() {
    this.printPhase = 0;
    this.hideHint();
    this.clearBath();
  }

  private showHint(text: string) {
    this.hideHint();
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'top:64px', 'transform:translateX(-50%)', 'z-index:20',
      'background:rgba(0,0,0,0.6)', 'color:#eee', 'font:12px system-ui,sans-serif',
      'padding:6px 12px', 'border-radius:14px', 'pointer-events:none',
    ].join(';');
    document.body.appendChild(el);
    this.hint = el;
  }

  private hideHint() {
    this.hint?.remove();
    this.hint = null;
  }

  // ── UI ──────────────────────────────────────────────────────────────

  private buildUI() {
    const s = new ParamSlider();
    this.sliders = s;
    s.addSelect({
      label: 'Tool',
      options: [
        { value: 'stylus', label: 'Stylus' },
        { value: 'comb', label: 'Comb (straight)' },
        { value: 'drops', label: 'Sprinkle drops' },
      ],
      value: this.tool,
      onChange: (v) => { this.tool = v as Tool; },
    });
    this.patternSelect = s.addSelect({
      label: 'Pattern',
      options: [{ value: '', label: 'Make a classic…' }, ...RECIPES.map((r) => ({ value: r.id, label: r.label }))],
      value: '',
      onChange: (v) => {
        if (!v || this.printPhase > 0) return;
        if (v === 'suminagashi' && !PALETTES[this.paletteId].alternateClear) this.setPalette('sumi');
        this.startRecipe(v, true);
        this.patternSelect.value = '';
      },
    });
    this.paletteSelect = s.addSelect({
      label: 'Palette',
      options: Object.entries(PALETTES).map(([value, p]) => ({ value, label: p.label })),
      value: this.paletteId,
      onChange: (v) => this.setPalette(v),
    });
    s.addSlider({
      label: 'Drop Size', min: 0.02, max: 0.14, value: this.dropSize, step: 0.005,
      onChange: (v) => { this.dropSize = v; },
    });
    s.addSlider({
      label: 'Drag', min: 0.5, max: 0.97, value: this.drag, step: 0.01,
      onChange: (v) => { this.drag = v; },
    });
    s.addSlider({
      label: 'Rod Size', min: 2, max: 12, value: this.rodSize * 1000, step: 0.5,
      onChange: (v) => { this.rodSize = v / 1000; },
    });
    s.addSlider({
      label: 'Comb Spacing', min: 0.015, max: 0.15, value: this.combSpacing, step: 0.005,
      onChange: (v) => { this.combSpacing = v; },
    });
    s.addButtons([
      { label: 'Spatter', onClick: () => { if (this.printPhase === 0) this.spatter(); } },
      { label: 'Print', onClick: () => this.startPrint() },
      { label: 'Clear', onClick: () => { if (this.printPhase > 0) this.endPrint(); else this.clearBath(); } },
    ]);
  }

  private setPalette(id: string) {
    this.paletteId = id;
    this.colorIndex = 0;
    if (this.paletteSelect) this.paletteSelect.value = id;
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.traceProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.opsTex);
    this.deleteTarget(gl, this.paint);
    this.bakes.forEach((b) => this.deleteTarget(gl, b));
    this.deleteTarget(gl, this.flat);
    this.deleteTarget(gl, this.pendingFlatDelete);
    this.flat = null;
    this.pendingFlatDelete = null;
    this.sliders.destroy();
    this.hideHint();
  }
}
