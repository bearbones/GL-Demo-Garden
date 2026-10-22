import { Plugin } from '../../plugin/Plugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import traceSrc from './trace.glsl';
import displaySrc from './display.glsl';
import { DropSpec, PALETTES, RECIPES, Recipe, StrokeTool, SwirlSpec, Vec2, buildRecipe } from './recipes';

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
const BAKE_MAX_FRAMES = 120; // every bake finishes within this many frames
const SS_COST = 2;        // bake supersampling roughly doubles its cost
const RESIZE_SETTLE = 0.2; // s of stable size before bake targets are rebuilt
const MARGIN_BU = 0.12;   // bake covers the screen plus this margin (bath units)
const MAX_TRACE_PX = 5e6; // cap traced pixels on very large screens
const CHORD_TOL_PX = 0.6; // a stroke op grows while the path stays this straight
const COMB_CHORD_TOL_PX = 1.0;
const MIN_SEG_PX = 1.0;
const COMB_LOCK_CSS = 28; // comb heading locks after this much travel (CSS px)...
const COMB_SNAP = 8 * Math.PI / 180; // ...snapping to the tray axes when this close
const TOOL_SMOOTH = 0.025; // pointer smoothing time constant (s)
const RECIPE_STEP = 1 / 120; // recipe tool paths are sampled at least this finely (s)
const WIDE_MIN = 1.8;      // a bake about to become the flattened layer covers at
                          // least this bath width, and both orientations
const LAY_TIME = 1.1;
const FLIP_TIME = 1.0;
const ROD_DEFAULT = 0.0045;

// Stylus shape in units of rod size (must match trace.glsl), used to bound
// the screen area a stylus op can change
const ALONG = 2.6;
const FALL = 3.0;
const SUPPORT = 7.0;

// Op types (must match trace.glsl)
const OP_DROP = 0;
const OP_STROKE = 1;
const OP_SWIRL = 2;

type Tool = 'stylus' | 'comb' | 'drops';
type Rect = [number, number, number, number]; // x, y, w, h in bath units
type Box = [number, number, number, number];  // x0, y0, x1, y1 in bath units

function stylusTool(size: number, kappa: number): StrokeTool {
  return { tines: 1, spacing: 0, size, kappa, axis: [0, 1], falloff: 0 };
}

function unionBox(a: Box, b: Box): Box {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  rect: Rect;     // bath area the texture covers
  wide?: boolean; // built extra wide to become the flattened layer
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
  swirlIdx: number;
  strokeIdx: number;
  stroke: ActiveStroke | null;
  strokeU: number; // path parameter reached by the current stroke
}

export class PaperMarblingPlugin implements Plugin {
  readonly name = 'Paper Marbling';

  private traceProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private opsTex!: WebGLTexture;
  private dummy!: Target; // bound to samplers a pass doesn't read
  private traceLocs: Record<string, WebGLUniformLocation | null> = {};
  private displayLocs: Record<string, WebGLUniformLocation | null> = {};

  // Op list, laid out exactly as the op texture rows
  private ops = new Float32Array(MAX_OPS * OP_FLOATS);
  private opCount = 0;
  private dirtyLo = MAX_OPS;
  private dirtyHi = 0;
  private cumCost = new Float64Array(MAX_OPS + 1);
  private lastOpChange = 0;

  // Paint (screen) and bakes. bakes[bakeCur] is complete, holding the state
  // after bakeCount ops; the other slot is the build target.
  private paint!: Target;
  private bakes: (Target | null)[] = [null, null];
  private bakeCur = 0;
  private bakeCount = 0;
  private building: { target: number; row: number; dst: Target } | null = null;
  private flat: Target | null = null;
  private doomed: Target[] = []; // freed at the start of the next frame
  private pxPerBU = 1;
  private aspect = 1;
  private cssPerBU = 1;
  private paintRect: Rect = [0, 0, 1, 1];
  private bakeRect: Rect = [0, 0, 1, 1];
  private bakeW = 1;
  private bakeH = 1;
  private resizedAt = -Infinity;

  // Paint dirtiness: the whole layer, or just the box a stylus touched
  private dirtyFull = true;
  private dirtyBox: Box | null = null;
  private wasAnimating = false;

  // Bake budget (op·pixel evaluations per frame), sized against the display
  // refresh interval rather than fixed thresholds. Frame times are measured
  // here because the engine caps dt.
  private bakeBudget = 6e7;
  private missCap = 4e8;    // budget ceiling learned from strips that missed vsync
  private lastNow = 0;
  private frameTime = 0;    // real interval (performance.now); dt is capped
  private dtHist = new Float32Array(90); // rAF deltas, vsync-aligned
  private dtIdx = 0;
  private refresh = 1 / 60;
  private lastStripLimited = false;
  private bakeableLive = 0; // live-pass work the next bake would remove

  // Interaction
  private sliders!: ParamSlider;
  private patternSelect!: HTMLSelectElement;
  private paletteSelect!: HTMLSelectElement;
  private tool: Tool = 'stylus';
  private paletteId = 'ottoman';
  private autoSumiFrom: string | null = null; // palette to restore after the suminagashi pattern
  private dropSize = 0.06;
  private drag = 0.9;
  private rodSize = ROD_DEFAULT;
  private combSpacing = 0.05;
  private colorIndex = 0;
  private time = 0;

  private dragging = false;
  private rebaseDrag = false; // a resize moved the bath under a held tool
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
  private hint: HTMLButtonElement | null = null;

  init(ctx: EngineContext) {
    const { gl } = ctx;
    this.traceProgram = createProgram(gl, quadVert, traceSrc);
    this.displayProgram = createProgram(gl, quadVert, displaySrc);
    this.vao = gl.createVertexArray()!;
    for (const name of ['u_ops', 'u_opEnd', 'u_bakeCount', 'u_bake', 'u_bakeRect', 'u_flat', 'u_flatRect',
      'u_targetRect', 'u_pxPerBU', 'u_time', 'u_superSample']) {
      this.traceLocs[name] = gl.getUniformLocation(this.traceProgram, name);
    }
    for (const name of ['u_paint', 'u_resolution', 'u_time', 'u_toolPos', 'u_toolAxis', 'u_toolGeo',
      'u_printPhase', 'u_printT']) {
      this.displayLocs[name] = gl.getUniformLocation(this.displayProgram, name);
    }

    // RGBA32F is only sampled (texelFetch), which is core WebGL2
    this.opsTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.opsTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, OPS_PER_ROW * 3, MAX_OPS / OPS_PER_ROW, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.dummy = this.createTarget(gl, 1, 1, [0, 0, 0, 0]);

    this.allocTargets(ctx);
    this.buildUI();
    this.startRecipe('bullseye', true);
  }

  // ── Render targets ──────────────────────────────────────────────────

  private createTarget(gl: WebGL2RenderingContext, w: number, h: number, rect: Rect): Target {
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
    return { tex, fbo, w, h, rect };
  }

  private deleteTarget(gl: WebGL2RenderingContext, t: Target | null | undefined) {
    if (!t) return;
    gl.deleteFramebuffer(t.fbo);
    gl.deleteTexture(t.tex);
  }

  /**
   * Paint and bake share one texel grid (bake = paint + whole-texel margin),
   * so an untouched pixel samples the bake exactly at a texel centre.
   * Very dense or very large screens trace at reduced density.
   *
   * On a resize the completed bake is kept: it lives in bath units, so it
   * stays a valid stand-in (sampled off-grid) until a bake at the new size
   * lands. Bake targets are only reallocated once the size settles.
   */
  private allocTargets(ctx: EngineContext) {
    const { gl } = ctx;
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(dpr > 2 ? 2 / dpr : 1, Math.sqrt(MAX_TRACE_PX / (ctx.width * ctx.height)));
    let pw = Math.max(1, Math.round(ctx.width * scale));
    let ph = Math.max(1, Math.round(ctx.height * scale));
    let margin = Math.round(MARGIN_BU * ph);
    const fit = Math.min(1, (maxTex - 2) / (Math.max(pw, ph) + 2 * margin));
    pw = Math.max(1, Math.floor(pw * fit));
    ph = Math.max(1, Math.floor(ph * fit));
    margin = Math.round(MARGIN_BU * ph);

    this.pxPerBU = ph;
    this.aspect = pw / ph;
    this.cssPerBU = ctx.canvas.clientHeight || ph;
    this.paintRect = [-this.aspect / 2, -0.5, this.aspect, 1];
    this.bakeW = pw + 2 * margin;
    this.bakeH = ph + 2 * margin;
    this.bakeRect = [-this.aspect / 2 - margin / ph, -0.5 - margin / ph, this.bakeW / ph, this.bakeH / ph];
    if (this.paint) this.doomed.push(this.paint);
    this.paint = this.createTarget(gl, pw, ph, this.paintRect);
    this.building = null;
    this.resizedAt = this.time;
    this.dirtyFull = true;
  }

  resize(ctx: EngineContext) {
    this.allocTargets(ctx);
    // Bath units follow the canvas, so the point under a held finger moved:
    // lift the tool and set it down again on the next move
    if (this.dragging) {
      this.closeOpenStrokes();
      this.rebaseDrag = true;
    }
  }

  /** The bake slot to build into, sized for the current screen (null while a resize settles) */
  private buildTarget(gl: WebGL2RenderingContext): Target | null {
    const slot = 1 - this.bakeCur;
    const t = this.bakes[slot];
    if (t && t.w === this.bakeW && t.h === this.bakeH) {
      t.rect = [...this.bakeRect];
      t.wide = false;
      return t;
    }
    if (this.time - this.resizedAt < RESIZE_SETTLE) return null;
    if (t) this.doomed.push(t);
    const fresh = this.createTarget(gl, this.bakeW, this.bakeH, [...this.bakeRect]);
    this.bakes[slot] = fresh;
    return fresh;
  }

  /**
   * The bake that becomes the flattened layer outlives the ops it absorbs,
   * so it is built wide enough for either orientation (bath units follow the
   * canvas height, so rotating a phone widens the visible bath ~4x).
   */
  private wideTarget(gl: WebGL2RenderingContext): Target | null {
    if (this.time - this.resizedAt < RESIZE_SETTLE) return null;
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const ph = this.pxPerBU;
    const pw = this.paint.w;
    const half = Math.max(this.aspect, 1 / this.aspect, WIDE_MIN) / 2 + MARGIN_BU;
    const mx = Math.max(0, Math.min(Math.round(half * ph - pw / 2), Math.floor((maxTex - 2 - pw) / 2)));
    const w = pw + 2 * mx;
    const slot = 1 - this.bakeCur;
    const rect: Rect = [-this.aspect / 2 - mx / ph, this.bakeRect[1], w / ph, this.bakeRect[3]];
    const t = this.bakes[slot];
    if (t && t.w === w && t.h === this.bakeH) {
      t.rect = rect;
      t.wide = true;
      return t;
    }
    if (t) this.doomed.push(t);
    const fresh = this.createTarget(gl, w, this.bakeH, rect);
    fresh.wide = true;
    this.bakes[slot] = fresh;
    return fresh;
  }

  // ── Op list ─────────────────────────────────────────────────────────

  private reserveOp(): number {
    if (this.opCount >= MAX_OPS && this.bakeCount > 0) {
      // The background bake fell far behind: fold what it has into the
      // flattened layer (no GPU work) rather than stall on a giant bake
      this.flatten();
    }
    if (this.opCount >= MAX_OPS) return -1;
    const i = this.opCount++;
    this.ops.fill(0, i * OP_FLOATS, (i + 1) * OP_FLOATS);
    return i;
  }

  /** Record that op i changed; `box` limits the repaint to that bath-space box */
  private markDirty(i: number, box: Box | null = null) {
    this.dirtyLo = Math.min(this.dirtyLo, i);
    this.dirtyHi = Math.max(this.dirtyHi, i + 1);
    this.lastOpChange = this.time;
    if (!box) this.dirtyFull = true;
    else this.dirtyBox = this.dirtyBox ? unionBox(this.dirtyBox, box) : box;
  }

  private updateCost(i: number) {
    const o = i * OP_FLOATS;
    const type = this.ops[o];
    const w = type === OP_STROKE ? (this.ops[o + 3] > 1.5 ? 6 : 3) : 1;
    this.cumCost[i + 1] = this.cumCost[i] + w;
  }

  /** A drop still spreading or a swirl still turning */
  private animating(i: number): boolean {
    const o = i * OP_FLOATS;
    const type = this.ops[o];
    if (type === OP_DROP) return this.time < this.ops[o + 4] + this.ops[o + 7];
    if (type === OP_SWIRL) return this.time < this.ops[o + 4] + this.ops[o + 5] && this.swirlEase(i) < this.ops[o + 8];
    return false;
  }

  /** Eased progress of a swirl's turn, as in trace.glsl */
  private swirlEase(i: number): number {
    const o = i * OP_FLOATS;
    const u = Math.min(1, Math.max(0, (this.time - this.ops[o + 4]) / this.ops[o + 5]));
    return u * u * (3 - 2 * u);
  }

  /**
   * A drop landing while a swirl turns must be turned by the rest of it.
   * Turns about one centre add, so freeze each turning swirl where it is now
   * and return continuations (the remaining share) to append after the drop.
   */
  private splitSwirls(): number[][] {
    const rest: number[][] = [];
    for (let i = this.bakeCount; i < this.opCount; i++) {
      const o = i * OP_FLOATS;
      if (this.ops[o] !== OP_SWIRL || !this.animating(i)) continue;
      const e = this.swirlEase(i);
      const cont = Array.from(this.ops.subarray(o, o + OP_FLOATS));
      cont[7] = e;
      rest.push(cont);
      this.ops[o + 8] = e;
      this.markDirty(i);
    }
    return rest;
  }

  /**
   * An op appended after an open stroke would be older than the rest of
   * that stroke's motion, so the stroke would never reach it. Close every
   * open stroke first; the next tool step reopens it after the new op (a
   * straight stroke split anywhere composes exactly, so nothing else moves).
   */
  private closeOpenStrokes() {
    for (const s of [this.userStroke, this.recipe?.stroke]) {
      if (s && s.op >= 0) {
        s.anchor = s.last;
        s.pts = [];
        s.op = -1;
      }
    }
  }

  private addDrop(x: number, y: number, r: number, rgb: [number, number, number],
    alpha: number, spread = 0.35 + 4 * r) {
    this.closeOpenStrokes();
    if (this.opCount >= MAX_OPS && this.bakeCount > 0) this.flatten();
    const turning = this.splitSwirls();
    const i = this.reserveOp();
    if (i < 0) return;
    const jitter = 1 + (Math.random() - 0.5) * 0.04;
    this.ops.set([OP_DROP, x, y, r, this.time, 0.05 + Math.random() * 0.9, alpha, spread,
      rgb[0] * jitter, rgb[1] * jitter, rgb[2] * jitter, 0], i * OP_FLOATS);
    this.updateCost(i);
    this.markDirty(i);
    for (const cont of turning) {
      const j = this.reserveOp();
      if (j < 0) break;
      this.ops.set(cont, j * OP_FLOATS);
      this.updateCost(j);
      this.markDirty(j);
    }
  }

  private addStroke(a: Vec2, b: Vec2, tool: StrokeTool): number {
    const i = this.reserveOp();
    if (i < 0) return -1;
    this.ops.set([OP_STROKE, a[0], a[1], tool.tines, b[0], b[1], tool.spacing, tool.size,
      tool.axis[0], tool.axis[1], tool.kappa, tool.falloff], i * OP_FLOATS);
    this.updateCost(i);
    this.markDirty(i, this.strokeBox(a, b, tool));
    return i;
  }

  private addSwirl(w: SwirlSpec) {
    this.closeOpenStrokes();
    const i = this.reserveOp();
    if (i < 0) return;
    // turn eased from 0 to 1 (o+7, o+8); a split narrows that range
    this.ops.set([OP_SWIRL, w.x, w.y, w.radius, this.time, w.dur, w.angle, 0, 1, 0, 0, 0], i * OP_FLOATS);
    this.updateCost(i);
    this.markDirty(i);
  }

  /** Bath-space box a single-tine stroke can change; null (= everything) for combs */
  private strokeBox(a: Vec2, b: Vec2, tool: StrokeTool): Box | null {
    if (tool.tines > 1) return null;
    const along = 6 * ALONG * tool.size;
    const across = SUPPORT * (tool.falloff > 0 ? tool.falloff : FALL * tool.size);
    const r = along + across;
    return [Math.min(a[0], b[0]) - r, Math.min(a[1], b[1]) - r, Math.max(a[0], b[0]) + r, Math.max(a[1], b[1]) + r];
  }

  /** Ops below the first one still changing (open stroke, spreading drop) */
  private settledCount(): number {
    const openA = this.userStroke ? this.userStroke.op : -1;
    const openB = this.recipe?.stroke ? this.recipe.stroke.op : -1;
    let i = this.bakeCount;
    while (i < this.opCount && i !== openA && i !== openB && !this.animating(i)) i++;
    return i;
  }

  private anyAnimating(): boolean {
    for (let i = this.bakeCount; i < this.opCount; i++) if (this.animating(i)) return true;
    return false;
  }

  // ── Strokes ─────────────────────────────────────────────────────────

  private beginStroke(at: Vec2, tool: StrokeTool): ActiveStroke {
    return { tool, anchor: at, last: at, pts: [], op: -1 };
  }

  private strokeTo(s: ActiveStroke, pos: Vec2, tolPx = CHORD_TOL_PX) {
    // Ignore sub-pixel creep (the smoothed tool settling), which would
    // otherwise repaint every frame while the stylus is held still
    if (Math.hypot(pos[0] - s.last[0], pos[1] - s.last[1]) < 0.05 / this.pxPerBU) return;
    // Something else was appended since this op opened (e.g. a tapped drop):
    // continue as a new op after it, so the rest of the motion reaches it
    if (s.op >= 0 && s.op !== this.opCount - 1) {
      s.anchor = s.last;
      s.pts = [];
      s.op = -1;
    }
    s.last = pos;
    const minSeg = MIN_SEG_PX / this.pxPerBU;
    if (s.op < 0) {
      if (Math.hypot(pos[0] - s.anchor[0], pos[1] - s.anchor[1]) < minSeg) return;
      s.op = this.addStroke(s.anchor, pos, s.tool);
      s.pts = [pos];
      return;
    }
    // Grow the open op while every point since its anchor stays on the chord;
    // a straight stroke split anywhere composes exactly, so this is lossless
    const tol = tolPx / this.pxPerBU;
    const dx = pos[0] - s.anchor[0];
    const dy = pos[1] - s.anchor[1];
    const len = Math.hypot(dx, dy);
    let straight = len > minSeg;
    for (let k = 0; straight && k < s.pts.length; k++) {
      const rx = s.pts[k][0] - s.anchor[0];
      const ry = s.pts[k][1] - s.anchor[1];
      const along = (rx * dx + ry * dy) / len;
      const across = Math.abs(rx * dy - ry * dx) / len;
      if (across > tol || along < -tol || along > len + tol) straight = false;
    }
    if (straight) {
      // Keep the straightness test bounded on long, slow pulls
      if (s.pts.length >= 256) s.pts = s.pts.filter((_, k) => k % 2 === 1);
      s.pts.push(pos);
      const o = s.op * OP_FLOATS;
      const oldEnd: Vec2 = [this.ops[o + 4], this.ops[o + 5]];
      this.ops[o + 4] = pos[0];
      this.ops[o + 5] = pos[1];
      // Extending a stroke along its own line only changes the paint near the
      // new piece (splits compose exactly); a slight turn moves the whole op
      const offLine = Math.abs((oldEnd[0] - s.anchor[0]) * dy - (oldEnd[1] - s.anchor[1]) * dx) / len;
      const before = this.strokeBox(s.anchor, oldEnd, s.tool);
      const after = this.strokeBox(s.anchor, pos, s.tool);
      const box = offLine * this.pxPerBU < 0.02
        ? this.strokeBox(oldEnd, pos, s.tool)
        : before && after ? unionBox(before, after) : null;
      this.markDirty(s.op, box);
      return;
    }
    // Close the op at its current end and start the next from there
    const end: Vec2 = s.pts[s.pts.length - 1];
    s.anchor = end;
    s.pts = [];
    s.op = -1;
    s.last = end;
    this.strokeTo(s, pos, tolPx);
  }

  private userTool(): StrokeTool {
    if (this.tool === 'comb' && this.combDir) {
      const axis: Vec2 = [-this.combDir[1], this.combDir[0]];
      const span = 2 * Math.hypot(this.aspect, 1) + 0.4;
      // Tines closer than ~4 rod sizes would pull the paint between them
      // faster than the tines themselves
      const size = Math.min(this.rodSize, this.combSpacing / 4);
      return {
        tines: Math.ceil(span / this.combSpacing) + 1, spacing: this.combSpacing, size, kappa: this.drag, axis,
        falloff: Math.max(FALL * size, 0.22 * this.combSpacing),
      };
    }
    return stylusTool(this.rodSize, this.drag);
  }

  // ── Recipes ─────────────────────────────────────────────────────────

  private startRecipe(id: string, fresh: boolean) {
    if (fresh) this.clearBath();
    if (id === 'suminagashi' && !PALETTES[this.paletteId].alternateClear) {
      this.autoSumiFrom = this.paletteId;
      this.setPalette('sumi');
    } else if (id !== 'suminagashi' && this.autoSumiFrom && this.paletteId === 'sumi') {
      this.setPalette(this.autoSumiFrom);
      this.autoSumiFrom = null;
    }
    const palette = PALETTES[this.paletteId];
    this.recipe = {
      recipe: buildRecipe(id, this.aspect, palette.colors.length, Math.random),
      t: 0, dropIdx: 0, swirlIdx: 0, strokeIdx: 0, stroke: null, strokeU: 0,
    };
  }

  /** Random drops, merged into whatever pattern is playing */
  private spatter() {
    const run = this.recipe;
    const t0 = run ? run.t : 0;
    const drops: DropSpec[] = [];
    for (let k = 0; k < 36; k++) {
      drops.push({
        at: t0 + Math.random() * 1.2,
        x: (Math.random() - 0.5) * this.aspect,
        y: Math.random() - 0.5,
        r: this.dropSize * (0.35 + 0.55 * Math.random()),
        color: -2,
      });
    }
    if (run) {
      const rest = run.recipe.drops.slice(run.dropIdx).concat(drops).sort((a, b) => a.at - b.at);
      run.recipe.drops = run.recipe.drops.slice(0, run.dropIdx).concat(rest);
      run.recipe.end = Math.max(run.recipe.end, t0 + 1.2);
    } else {
      drops.sort((a, b) => a.at - b.at);
      this.recipe = {
        recipe: { drops, strokes: [], swirls: [], end: 1.2 },
        t: 0, dropIdx: 0, swirlIdx: 0, strokeIdx: 0, stroke: null, strokeU: 0,
      };
    }
  }

  private stepRecipe(dt: number) {
    const run = this.recipe;
    if (!run) return;
    run.t += dt;
    const { drops, strokes, swirls } = run.recipe;
    const palette = PALETTES[this.paletteId];
    while (run.swirlIdx < swirls.length && swirls[run.swirlIdx].at <= run.t) this.addSwirl(swirls[run.swirlIdx++]);
    while (run.dropIdx < drops.length && drops[run.dropIdx].at <= run.t) {
      const d = drops[run.dropIdx++];
      const color = d.color === -2 ? Math.floor(Math.random() * palette.colors.length) : d.color;
      const spread = d.spread ?? 0.35 + 4 * d.r;
      if (color < 0) this.addDrop(d.x, d.y, d.r, [0, 0, 0], 0, spread);
      else this.addDrop(d.x, d.y, d.r, palette.colors[color % palette.colors.length], palette.inkAlpha ?? 1, spread);
    }
    const spec = strokes[run.strokeIdx];
    if (spec && run.t >= spec.start) {
      const u = Math.min(1, (run.t - spec.start) / spec.dur);
      if (!run.stroke) {
        run.stroke = this.beginStroke(spec.path(0), spec.tool);
        run.strokeU = 0;
      }
      // Follow the path finely even when frames are slow, so curves stay curves
      const tol = spec.tool.tines > 1 ? COMB_CHORD_TOL_PX : CHORD_TOL_PX;
      const du = RECIPE_STEP / spec.dur;
      while (run.strokeU < u) {
        run.strokeU = Math.min(u, run.strokeU + du);
        this.strokeTo(run.stroke, spec.path(run.strokeU), tol);
      }
      this.shownTool = spec.tool;
      this.toolPos = spec.path(u);
      if (u >= 1) {
        run.stroke = null;
        run.strokeIdx++;
      }
    }
    if (run.t >= run.recipe.end && run.dropIdx >= drops.length && run.swirlIdx >= swirls.length
      && run.strokeIdx >= strokes.length) {
      this.recipe = null;
    }
  }

  /** The user picked up a tool: stop the pattern's own passes, keep its drops */
  private stopRecipeStrokes() {
    const run = this.recipe;
    if (!run) return;
    run.stroke = null;
    run.strokeIdx = run.recipe.strokes.length;
  }

  // ── Bake scheduling ─────────────────────────────────────────────────

  private bindTrace(gl: WebGL2RenderingContext, opEnd: number, bake: Target | null, bakeCount: number,
    rect: Rect, superSample: boolean) {
    const L = this.traceLocs;
    gl.useProgram(this.traceProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.opsTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (bake ?? this.dummy).tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, (this.flat ?? this.dummy).tex);
    gl.uniform1i(L.u_ops, 0);
    gl.uniform1i(L.u_bake, 1);
    gl.uniform1i(L.u_flat, 2);
    gl.uniform1i(L.u_opEnd, opEnd);
    gl.uniform1i(L.u_bakeCount, bake ? bakeCount : 0);
    gl.uniform4fv(L.u_bakeRect, bake ? bake.rect : [0, 0, 1, 1]);
    gl.uniform4fv(L.u_flatRect, this.flat ? this.flat.rect : [0, 0, 0, 0]);
    gl.uniform4fv(L.u_targetRect, rect);
    gl.uniform1f(L.u_pxPerBU, this.pxPerBU);
    gl.uniform1f(L.u_time, this.time);
    gl.uniform1i(L.u_superSample, superSample ? 1 : 0);
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

  private stepBake(ctx: EngineContext) {
    const { gl } = ctx;
    if (!this.building) {
      // Fold a finished bake into the flattened layer as soon as it reaches
      // the cap, before the next (ever longer) rebuild can start
      if (this.bakeCount >= FLATTEN_AT) this.flatten();
      const settled = this.settledCount();
      const pending = settled - this.bakeCount;
      // After a resize the kept bake is sampled off-grid until one at the
      // new size lands, so a size mismatch is pending work too
      const cur = this.bakes[this.bakeCur];
      const stale = this.bakeCount > 0 && !!cur && (cur.h !== this.bakeH || (!cur.wide && cur.w !== this.bakeW));
      const still = pending > 0 && (settled === this.opCount || this.time - this.lastOpChange > BAKE_QUIET);
      if (pending >= BAKE_MIN_OPS || still || stale) {
        const dst = settled >= FLATTEN_AT ? this.wideTarget(gl) : this.buildTarget(gl);
        if (dst) this.building = { target: settled, row: 0, dst };
      }
    }
    const b = this.building;
    if (!b) return;

    // Back off when frames run well past the refresh interval, remembering
    // the level that missed; grow (up to it) only when the last strip was
    // actually held back by the budget
    const ft = this.frameTime;
    if (ft > 1.5 * this.refresh) {
      this.bakeBudget = Math.max(2e6, this.bakeBudget * 0.8);
      this.missCap = this.bakeBudget * 0.9;
    } else if (ft > 0 && ft <= 1.2 * this.refresh && this.lastStripLimited) {
      this.bakeBudget = Math.min(4e8, this.missCap, this.bakeBudget * 1.08);
    }
    this.missCap = Math.min(4e8, Math.max(this.missCap, 2e6) * 1.003);
    // Finishing the bake is what makes the live pass cheap again, so never
    // give it less work than the live replay it will remove is costing
    const budget = Math.min(4e8, Math.max(this.bakeBudget, this.bakeableLive));
    const cost = Math.max(1, this.cumCost[b.target]) * SS_COST;
    const remaining = b.dst.h - b.row;
    const wanted = Math.floor(budget / (b.dst.w * cost));
    this.lastStripLimited = wanted < remaining;
    const rows = Math.min(remaining, Math.max(Math.ceil(b.dst.h / BAKE_MAX_FRAMES), wanted, 1));

    this.uploadOps(gl); // a flatten above may have shifted the op list
    gl.bindFramebuffer(gl.FRAMEBUFFER, b.dst.fbo);
    gl.viewport(0, 0, b.dst.w, b.dst.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, b.row, b.dst.w, rows);
    this.bindTrace(gl, b.target, null, 0, b.dst.rect, true);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    b.row += rows;
    if (b.row >= b.dst.h) {
      this.bakeCur = 1 - this.bakeCur;
      this.bakeCount = b.target;
      this.building = null;
      // Untouched pixels now read the exact (supersampled) bake texel-for-texel
      this.dirtyFull = true;
    }
  }

  /**
   * Fold the bake into a flattened base layer and drop the ops it absorbed.
   * The one place paint is resampled — once per FLATTEN_AT ops.
   */
  private flatten() {
    const n = this.bakeCount;
    const done = this.bakes[this.bakeCur];
    if (n === 0 || !done) return;
    if (this.flat) this.doomed.push(this.flat);
    this.flat = done;
    this.bakes[this.bakeCur] = null;
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
    this.dragging = false;
    this.rebaseDrag = false;
    this.combStart = null;
    this.combDir = null;
    this.recipe = null;
    if (this.flat) this.doomed.push(this.flat);
    this.flat = null;
    this.dirtyFull = true;
    this.lastOpChange = this.time;
  }

  // ── Frame ───────────────────────────────────────────────────────────

  render(ctx: EngineContext) {
    const { gl } = ctx;
    const dt = ctx.dt;
    this.time = ctx.time;
    const now = performance.now() / 1000;
    this.frameTime = this.lastNow ? now - this.lastNow : 0;
    this.lastNow = now;
    // Refresh interval: shortest recent rAF delta. Those come from vsync
    // timestamps, so a late callback can't make one look short.
    if (dt > 0) {
      this.dtHist[this.dtIdx++ % this.dtHist.length] = dt;
      let m = Infinity;
      for (const v of this.dtHist) if (v > 0 && v < m) m = v;
      this.refresh = Math.max(m, 1 / 240);
    }
    for (const t of this.doomed) this.deleteTarget(gl, t);
    this.doomed = [];

    if (this.printPhase > 0) {
      this.stepPrint(dt);
    } else {
      this.stepRecipe(dt);
      this.stepUser(dt);
    }

    this.uploadOps(gl);
    this.stepBake(ctx);
    this.uploadOps(gl);

    // Spreading drops and turning swirls change every frame; repaint once
    // more after the last one settles so the screen ends on its final state
    const animating = this.anyAnimating();
    if (animating || this.wasAnimating) this.dirtyFull = true;
    this.wasAnimating = animating;
    this.bakeableLive = 0;
    if (this.dirtyFull || this.dirtyBox) this.paintPass(gl);

    // Composite to screen
    const showTool = this.dragging && !this.rebaseDrag && this.tool !== 'drops' && (this.tool !== 'comb' || this.combDir !== null);
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

  /** Live pass: replay ops newer than the bake, scissored to what changed */
  private paintPass(gl: WebGL2RenderingContext) {
    const p = this.paint;
    let x0 = 0;
    let y0 = 0;
    let x1 = p.w;
    let y1 = p.h;
    if (!this.dirtyFull && this.dirtyBox) {
      // Only a stylus op moved, and it is the newest op: outside its
      // support nothing can have changed
      const b = this.dirtyBox;
      const r = this.paintRect;
      x0 = Math.max(0, Math.floor((b[0] - r[0]) * this.pxPerBU) - 2);
      y0 = Math.max(0, Math.floor((b[1] - r[1]) * this.pxPerBU) - 2);
      x1 = Math.min(p.w, Math.ceil((b[2] - r[0]) * this.pxPerBU) + 2);
      y1 = Math.min(p.h, Math.ceil((b[3] - r[1]) * this.pxPerBU) + 2);
    }
    this.dirtyFull = false;
    this.dirtyBox = null;
    if (x1 <= x0 || y1 <= y0) return;
    const bake = this.bakeCount > 0 ? this.bakes[this.bakeCur] : null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, p.fbo);
    gl.viewport(0, 0, p.w, p.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, y0, x1 - x0, y1 - y0);
    this.bindTrace(gl, this.opCount, bake, this.bakeCount, this.paintRect, false);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    this.bakeableLive = (x1 - x0) * (y1 - y0) * (this.cumCost[this.settledCount()] - this.cumCost[this.bakeCount]);
  }

  private stepUser(dt: number) {
    if (!this.dragging || this.rebaseDrag || this.tool === 'drops') return;
    let target = this.pointer;
    if (this.tool === 'comb') {
      // A rake is pulled straight: lock its heading after a little travel,
      // snapped to the tray's axes when the pull is nearly square to them
      if (!this.combStart) return;
      if (!this.combDir) {
        const dx = target[0] - this.combStart[0];
        const dy = target[1] - this.combStart[1];
        const len = Math.hypot(dx, dy);
        if (len * this.cssPerBU < COMB_LOCK_CSS) return;
        let angle = Math.atan2(dy, dx);
        const square = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
        if (Math.abs(angle - square) < COMB_SNAP) angle = square;
        this.combDir = [Math.cos(angle), Math.sin(angle)];
        this.stopRecipeStrokes();
        this.toolPos = this.combStart;
        this.userStroke = this.beginStroke(this.combStart, this.userTool());
        this.shownTool = this.userStroke.tool;
      }
      const along = (target[0] - this.combStart[0]) * this.combDir[0] + (target[1] - this.combStart[1]) * this.combDir[1];
      target = [this.combStart[0] + this.combDir[0] * along, this.combStart[1] + this.combDir[1] * along];
    }
    const k = 1 - Math.exp(-dt / TOOL_SMOOTH);
    this.toolPos = [this.toolPos[0] + (target[0] - this.toolPos[0]) * k, this.toolPos[1] + (target[1] - this.toolPos[1]) * k];
    if (this.userStroke) {
      const tol = this.userStroke.tool.tines > 1 ? COMB_CHORD_TOL_PX : CHORD_TOL_PX;
      this.strokeTo(this.userStroke, this.toolPos, tol);
    }
  }

  // ── Input ───────────────────────────────────────────────────────────

  private toBath(e: GestureEvent): Vec2 {
    return [(e.pos.x - 0.5) * this.aspect, 0.5 - e.pos.y];
  }

  private nextColor(): { rgb: [number, number, number]; alpha: number } {
    const palette = PALETTES[this.paletteId];
    const k = this.colorIndex++;
    const ink = palette.inkAlpha ?? 1;
    if (palette.alternateClear) {
      if (k % 2 === 1) return { rgb: [0, 0, 0], alpha: 0 };
      return { rgb: palette.colors[(k >> 1) % palette.colors.length], alpha: ink };
    }
    return { rgb: palette.colors[k % palette.colors.length], alpha: ink };
  }

  onGesture(ctx: EngineContext, event: GestureEvent) {
    this.time = ctx.time;
    if (this.printPhase > 0) {
      if (this.printPhase === 3 && (event.type === 'tap' || event.type === 'drag-end')) this.endPrint();
      return;
    }
    const pos = this.toBath(event);
    if (this.rebaseDrag && this.dragging && event.type === 'drag-move') {
      // Set the tool down again under the finger in the resized bath
      this.rebaseDrag = false;
      this.pointer = pos;
      this.toolPos = pos;
      if (this.tool === 'stylus') {
        this.userStroke = this.beginStroke(pos, this.userTool());
      } else if (this.tool === 'comb') {
        this.userStroke = null;
        this.combStart = pos;
        this.combDir = null;
      }
      return;
    }
    if (event.type === 'tap') {
      const c = this.nextColor();
      this.addDrop(pos[0], pos[1], this.dropSize * (0.9 + 0.2 * Math.random()), c.rgb, c.alpha);
      return;
    }
    if (event.type === 'drag-start') {
      if (this.tool !== 'drops') this.stopRecipeStrokes();
      this.dragging = true;
      this.rebaseDrag = false;
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
            : { rgb: palette.colors[Math.floor(Math.random() * palette.colors.length)], alpha: palette.inkAlpha ?? 1 };
          const j = this.dropSize * 0.6;
          this.addDrop(pos[0] + (Math.random() - 0.5) * j, pos[1] + (Math.random() - 0.5) * j,
            this.dropSize * (0.4 + 0.4 * Math.random()), c.rgb, c.alpha);
        }
      }
      this.pointer = pos;
      return;
    }
    if (event.type === 'drag-end') {
      this.pointer = pos;
      // Land exactly where the pointer let go (and lock a quick comb flick),
      // unless a resize lifted the tool and it was never set down again
      if (!this.rebaseDrag && (this.userStroke || (this.tool === 'comb' && this.combStart))) this.stepUser(1);
      this.rebaseDrag = false;
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
    this.sliders.setVisible(false);
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
        this.showHint('Skim the bath and start again');
      }
    }
  }

  private endPrint() {
    this.printPhase = 0;
    this.hideHint();
    this.sliders.setVisible(true);
    this.clearBath();
  }

  /** A small button in the table margin under the sheet (tapping the print works too) */
  private showHint(text: string) {
    this.hideHint();
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:4px', 'transform:translateX(-50%)', 'z-index:20',
      'background:rgba(0,0,0,0.6)', 'color:#eee', 'font:12px system-ui,sans-serif', 'white-space:nowrap',
      'padding:4px 12px', 'border:1px solid #3a3a42', 'border-radius:14px', 'cursor:pointer',
    ].join(';');
    el.addEventListener('click', () => this.endPrint());
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
        // Back to the placeholder, so picking the same pattern again works
        this.patternSelect.value = '';
        if (!v) return;
        if (this.printPhase === 3) this.endPrint();
        if (this.printPhase > 0) return;
        this.startRecipe(v, true);
      },
    });
    this.paletteSelect = s.addSelect({
      label: 'Palette',
      options: Object.entries(PALETTES).map(([value, p]) => ({ value, label: p.label })),
      value: this.paletteId,
      onChange: (v) => {
        this.autoSumiFrom = null;
        this.setPalette(v);
      },
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
    for (const t of [this.paint, this.dummy, this.flat, ...this.bakes, ...this.doomed]) this.deleteTarget(gl, t);
    this.bakes = [null, null];
    this.flat = null;
    this.doomed = [];
    this.sliders.destroy();
    this.hideHint();
  }
}
