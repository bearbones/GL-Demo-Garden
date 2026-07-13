import { Plugin } from '../../plugin/Plugin';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import { ParamSlider } from '../../engine/ParamSlider';
import quadVert from '../../shaders/fullscreen-quad.vert';
import rockSrc from './rock.glsl';
import injectSrc from './inject.glsl';
import computeSrc from './crack-compute.glsl';
import analysisSrc from './analysis.glsl';
import displaySrc from './display.glsl';
import stressRelaxSrc from './stress-relax.glsl';
import growStressSrc from './grow-stress.glsl';
import growWeibullSrc from './grow-weibull.glsl';
import stampSegmentsSrc from './stamp-segments.glsl';
import { computeFractureModes, buildRegionMap, ModePath, RegionMap } from './fracture-modes';

const COLS = 4; // shatter piece grid
const ROWS = 3;
const NP = COLS * ROWS; // piece count — injected into display.glsl at compile

// Four fracture models, all writing into the same damage field so the
// display, burst, analysis, and shatter pipeline is shared:
//  - voronoi: quenched cellular fault network + energy flooding (original)
//  - stress:  phase-field-style continuum damage over a relaxed stress
//             potential (cracks grow from stress concentration at tips)
//  - weibull: random-fuse discrete breakdown with Weibull bond strengths
//  - modes:   Breaking-Good-inspired precomputed weakest paths, revealed
//             progressively by strikes (pottery cracks)
type FractureModel = 'voronoi' | 'stress' | 'weibull' | 'modes';

const COMPUTE_STEPS = 6;        // voronoi crack-growth steps per frame
const TAP_ENERGY = 2.8;
const TAP_RADIUS = 0.045;       // splat radius, fraction of frame height
const ANALYSIS_W = 64;
const ANALYSIS_H = 40;
const DEEP_FRAC_TARGET = 0.008; // deep-crack coverage needed to shatter
const SPAN_TARGET = 0.85;       // crack network must reach this far across
const SHATTER_DELAY = 0.42;     // beat between final burst and pieces falling
const ENERGY_WINDOW = 8;        // seconds after a tap that fracture energy can
                                // still be alive; compute passes idle after it
const LOAD_DURATION = 0.55;     // how long a strike keeps loading the stress field
const AMBIENT_STRESS = 0.45;    // stored stress held at the slab's frame
const SETTLE_TAIL = 1.2;        // ambient-driven tip growth continues this long
                                // after the strike's own load ends
const GROW_CYCLES = 3;          // stress/weibull: growth steps per frame...
const RELAX_PER_CYCLE = 5;      // ...each preceded by this many Jacobi steps
const MAX_SEGS = 24;            // must match stamp-segments.glsl
const FALL_DURATION = 2.4;
const GRAVITY = 1.3;            // uv units / s²

interface Piece {
  vx: number;
  vy: number;
  vr: number;
  x: number;
  y: number;
  rot: number;
}

type Phase = 'intact' | 'bursting' | 'falling';

export class StoneBreakPlugin implements Plugin {
  readonly name = 'Stone Break';

  private rockProgram!: WebGLProgram;
  private injectProgram!: WebGLProgram;
  private computeProgram!: WebGLProgram;
  private analysisProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private relaxProgram!: WebGLProgram;
  private growStressProgram!: WebGLProgram;
  private growWeibullProgram!: WebGLProgram;
  private stampProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private crack!: PingPongFBO;
  private stress!: PingPongFBO;

  // Two full-res baked slabs: [0] = current, [1] = next (revealed on shatter)
  private rockTex: WebGLTexture[] = [];
  private bakeFBO!: WebGLFramebuffer;
  private seeds: [number, number] = [Math.random() * 100, Math.random() * 100];

  private analysisTex!: WebGLTexture;
  private analysisFBO!: WebGLFramebuffer;
  private linearSampler!: WebGLSampler;
  private analysisBuf = new Uint8Array(ANALYSIS_W * ANALYSIS_H * 4);

  private locs = new WeakMap<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

  private phase: Phase = 'intact';
  private breakProgress = 0;
  private frame = 0;
  private lastTapTime = -100;
  private lastTap: [number, number] = [0.5, 0.5]; // uv, origin bottom-left
  private pendingTaps: [number, number][] = [];

  private shakeAmp = 0;
  private stallCount = 0;
  private progressAtLastTap = 0;
  private strikesOnSlab = 0;

  private model: FractureModel = 'voronoi';
  private sliders!: ParamSlider;
  // voronoi fault-geometry sliders
  private kinkAngle = 16;
  private kinkFreq = 13;
  private branchAngle = 110;
  private branchFreq = 2.2;
  // stress-field sliders
  private toughness = 0.015;
  private hetero = 0.8;
  // weibull sliders
  private bondStrength = 0.17;
  private scatter = 0.9;
  // fracture-modes sliders
  private modeCount = 5;
  private modeRun = 0.16;

  // stress/weibull strike load
  private loadPos: [number, number] = [0.5, 0.5];
  private loadUntil = -100;
  private loadAmp = 1;

  // fracture-modes reveal state: per-vertex depth on the main line plus
  // per-branch growth, so strikes matter locally
  private modePaths: ModePath[] = [];
  private modeReveal: {
    lo: number;
    hi: number;
    depthAt: Float32Array;   // main-line depth per fine vertex
    brSteps: Float32Array;   // revealed steps per branch
    brDepth: Float32Array;   // depth per branch
  }[] = [];
  private modeKey = '';

  private burstStart = -100;
  private burstPos: [number, number] = [0.5, 0.5];
  private burstStrength = 0;

  private shatterAt = 0;
  private fallStart = 0;
  private pieces: Piece[] = [];
  private pieceSeed = new Float32Array(NP * 2);
  private pieceState = new Float32Array(NP * 4);
  private pieceMapTex: WebGLTexture | null = null;
  private pieceCount = NP;
  private useMap = false;

  init(ctx: EngineContext) {
    const { gl } = ctx;
    this.rockProgram = createProgram(gl, quadVert, rockSrc);
    this.injectProgram = createProgram(gl, quadVert, injectSrc);
    this.computeProgram = createProgram(gl, quadVert, computeSrc);
    this.analysisProgram = createProgram(gl, quadVert, analysisSrc);
    this.relaxProgram = createProgram(gl, quadVert, stressRelaxSrc);
    this.growStressProgram = createProgram(gl, quadVert, growStressSrc);
    this.growWeibullProgram = createProgram(gl, quadVert, growWeibullSrc);
    this.stampProgram = createProgram(gl, quadVert, stampSegmentsSrc);
    this.displayProgram = createProgram(
      gl,
      quadVert,
      // TS owns the piece count; keep the shader's array sizes in sync
      displaySrc.replace(/const int NP = \d+;/, `const int NP = ${NP};`),
    );
    this.vao = gl.createVertexArray()!;

    // The display pass reads the crack field through this sampler:
    // LINEAR replaces a manual 4-fetch bilinear, CLAMP_TO_EDGE stops the
    // REPEAT-wrapped state texture from mirroring cracks across edges
    this.linearSampler = gl.createSampler()!;
    gl.samplerParameteri(this.linearSampler, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.linearSampler, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.samplerParameteri(this.linearSampler, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(this.linearSampler, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const simW = Math.floor(ctx.width / 2);
    const simH = Math.floor(ctx.height / 2);
    this.crack = new PingPongFBO(gl, simW, simH);
    this.stress = new PingPongFBO(gl, simW, simH);

    this.bakeFBO = gl.createFramebuffer()!;
    this.rockTex = [this.createRockTexture(gl, ctx.width, ctx.height), this.createRockTexture(gl, ctx.width, ctx.height)];
    this.bakeRock(ctx, 0);
    this.bakeRock(ctx, 1);

    this.analysisTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.analysisTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ANALYSIS_W, ANALYSIS_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.analysisFBO = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.analysisFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.analysisTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.clearFields(gl); // prefill the stress field to ambient equilibrium
    this.buildSliders();
  }

  // Panel contents depend on the active fracture model, so the panel is
  // rebuilt whenever the model changes
  private buildSliders() {
    this.sliders?.destroy();
    this.sliders = new ParamSlider();
    this.sliders.addSelect({
      label: 'Model',
      value: this.model,
      options: [
        { value: 'voronoi', label: 'Voronoi Faults' },
        { value: 'stress', label: 'Stress Field' },
        { value: 'weibull', label: 'Weibull Bonds' },
        { value: 'modes', label: 'Fracture Modes' },
      ],
      onChange: (v) => this.setModel(v as FractureModel),
    });

    if (this.model === 'voronoi') {
      this.sliders.addSlider({
        label: 'Kink Angle',
        min: 0, max: 35, value: this.kinkAngle, step: 1,
        onChange: (v) => { this.kinkAngle = v; },
      });
      this.sliders.addSlider({
        label: 'Kink Freq',
        min: 4, max: 26, value: this.kinkFreq, step: 1,
        onChange: (v) => { this.kinkFreq = v; },
      });
      this.sliders.addSlider({
        label: 'Branch Angle',
        min: 55, max: 120, value: this.branchAngle, step: 1,
        onChange: (v) => { this.branchAngle = v; },
      });
      this.sliders.addSlider({
        label: 'Branch Freq',
        min: 1.2, max: 4.5, value: this.branchFreq, step: 0.1,
        onChange: (v) => { this.branchFreq = v; },
      });
    } else if (this.model === 'stress') {
      this.sliders.addSlider({
        label: 'Toughness',
        min: 0.005, max: 0.12, value: this.toughness, step: 0.005,
        onChange: (v) => { this.toughness = v; },
      });
      this.sliders.addSlider({
        label: 'Heterogeneity',
        min: 0, max: 1, value: this.hetero, step: 0.05,
        onChange: (v) => { this.hetero = v; },
      });
    } else if (this.model === 'weibull') {
      this.sliders.addSlider({
        label: 'Strength',
        min: 0.05, max: 0.4, value: this.bondStrength, step: 0.01,
        onChange: (v) => { this.bondStrength = v; },
      });
      this.sliders.addSlider({
        label: 'Scatter',
        min: 0.1, max: 1.5, value: this.scatter, step: 0.05,
        onChange: (v) => { this.scatter = v; },
      });
    } else {
      this.sliders.addSlider({
        label: 'Mode Count',
        min: 2, max: 8, value: this.modeCount, step: 1,
        onChange: (v) => { this.modeCount = v; this.modeKey = ''; },
      });
      this.sliders.addSlider({
        label: 'Crack Run',
        min: 0.06, max: 0.5, value: this.modeRun, step: 0.02,
        onChange: (v) => { this.modeRun = v; },
      });
    }
  }

  private setModel(model: FractureModel) {
    if (model === this.model) return;
    this.model = model;
    this.buildSliders();
    // A model switch starts the current slab fresh: damage semantics
    // differ enough between models that mixing fields reads as noise
    this.clearFields();
    this.resetInteractionState();
  }

  private uni(gl: WebGL2RenderingContext, program: WebGLProgram, name: string) {
    let map = this.locs.get(program);
    if (!map) {
      map = new Map();
      this.locs.set(program, map);
    }
    if (!map.has(name)) map.set(name, gl.getUniformLocation(program, name));
    return map.get(name)!;
  }

  private createRockTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private bakeRock(ctx: EngineContext, slot: 0 | 1) {
    const { gl } = ctx;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bakeFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.rockTex[slot], 0);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.rockProgram);
    gl.uniform2f(this.uni(gl, this.rockProgram, 'u_resolution'), ctx.width, ctx.height);
    gl.uniform1f(this.uni(gl, this.rockProgram, 'u_seed'), this.seeds[slot]);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private clearFields(gl?: WebGL2RenderingContext) {
    const g = gl ?? this.lastGl!;
    for (let i = 0; i < 2; i++) {
      this.crack.bindWrite(g);
      g.clear(g.COLOR_BUFFER_BIT); // engine clear colour (0,0,0,1) = no damage
      this.crack.swap();
    }
    // The stress field starts AT ambient equilibrium — a cold start from
    // zero would sweep a transient relaxation front in from the frame
    // and nucleate phantom cracks along it
    g.clearColor(AMBIENT_STRESS, 0, 0, 1);
    for (let i = 0; i < 2; i++) {
      this.stress.bindWrite(g);
      g.clear(g.COLOR_BUFFER_BIT);
      this.stress.swap();
    }
    g.clearColor(0, 0, 0, 1); // restore the engine's clear colour
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  }

  private lastGl: WebGL2RenderingContext | null = null;

  // Everything that must go back to zero when a fresh, uncracked slab
  // takes over — called from resetSlab(), resize(), and model switches
  private resetInteractionState() {
    this.phase = 'intact';
    this.breakProgress = 0;
    this.lastTapTime = -100;
    this.stallCount = 0;
    this.progressAtLastTap = 0;
    this.pendingTaps = [];
    this.loadUntil = -100;
    this.strikesOnSlab = 0;
    this.modeKey = ''; // fracture-mode paths are recomputed lazily per slab
  }

  private ensureModePaths(aspect: number) {
    const key = `${this.seeds[0].toFixed(4)}:${this.modeCount}:${aspect.toFixed(3)}`;
    if (key === this.modeKey) return;
    this.modeKey = key;
    this.modePaths = computeFractureModes(this.seeds[0], aspect, this.modeCount);
    this.modeReveal = this.modePaths.map((p) => ({
      lo: -1,
      hi: -1,
      depthAt: new Float32Array(p.pts.length),
      brSteps: new Float32Array(p.branches.length),
      brDepth: new Float32Array(p.branches.length),
    }));
  }

  resize(ctx: EngineContext) {
    const { gl } = ctx;
    // If the slab was mid-shatter, complete the handover to the next one
    // first — rebaking from the old seed would resurrect the slab the
    // user just watched explode
    if (this.phase !== 'intact') {
      this.seeds = [this.seeds[1], Math.random() * 100];
    }
    gl.deleteTexture(this.rockTex[0]);
    gl.deleteTexture(this.rockTex[1]);
    this.rockTex = [this.createRockTexture(gl, ctx.width, ctx.height), this.createRockTexture(gl, ctx.width, ctx.height)];
    this.bakeRock(ctx, 0);
    this.bakeRock(ctx, 1);
    const simW = Math.floor(ctx.width / 2);
    const simH = Math.floor(ctx.height / 2);
    this.crack.resize(gl, simW, simH);
    this.stress.resize(gl, simW, simH);
    this.clearFields(gl);
    this.resetInteractionState();
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    if (event.type !== 'tap' || this.phase !== 'intact') return;
    // Gesture origin is top-left; shader UV origin is bottom-left
    this.pendingTaps.push([event.pos.x, 1 - event.pos.y]);
  }

  render(ctx: EngineContext) {
    const { gl, time, dt } = ctx;
    const aspect = ctx.width / ctx.height;
    this.frame++;
    this.lastGl = gl;

    gl.bindVertexArray(this.vao);

    if (this.phase === 'intact') {
      this.processTaps(ctx, aspect);
      const active = time - this.lastTapTime < ENERGY_WINDOW;
      if (active) {
        if (this.model === 'voronoi') {
          this.stepCracks(gl, aspect);
        } else if (this.model === 'stress' || this.model === 'weibull') {
          // Keep relaxing past the load so ambient-driven tip growth and
          // avalanches settle
          if (time < this.loadUntil + SETTLE_TAIL) this.stepStress(gl, ctx, aspect);
        }
        // 'modes' needs no per-frame simulation: strikes stamp directly
        if (this.frame % 10 === 0 && time - this.lastTapTime < 6) {
          this.analyseDamage(ctx);
        }
      }
    } else if (this.phase === 'bursting' && time >= this.shatterAt) {
      this.phase = 'falling';
      this.fallStart = time;
    } else if (this.phase === 'falling') {
      this.updatePieces(dt);
      if (time - this.fallStart > FALL_DURATION) this.resetSlab(ctx);
    }

    this.shakeAmp *= Math.exp(-5.5 * dt);
    this.draw(ctx, aspect);
  }

  private processTaps(ctx: EngineContext, aspect: number) {
    const { gl, time } = ctx;
    for (const [x, y] of this.pendingTaps) {
      // Working the stone: if the last strike demonstrably failed to move
      // the needle (it landed far from any fault), hit harder each time.
      // Only evaluate when a damage analysis has actually run since the
      // previous tap (they refresh every 10 frames) and this isn't the
      // slab's first strike — otherwise rapid tapping reads a stale
      // breakProgress and misclassifies healthy growth as a stall.
      if (this.lastTapTime > 0 && time - this.lastTapTime > 0.8) {
        if (this.breakProgress - this.progressAtLastTap < 0.04) {
          this.stallCount = Math.min(this.stallCount + 1, 4);
        } else {
          this.stallCount = 0;
        }
        this.progressAtLastTap = this.breakProgress;
      }

      // Impact crater + spokes are stamped in every model; only the
      // voronoi model also uses the fracture-energy channel
      const energy = this.model === 'voronoi' ? TAP_ENERGY * (1 + 0.4 * this.stallCount) : 0;
      const spokeLen = this.model === 'modes' ? 0.05 : 0.08 + Math.random() * 0.05;
      // In the field-driven models the strike's damage must stay thin:
      // spoke slits concentrate the stress field at their tips and keep
      // growing, while a fat crater blob screens itself and stalls
      const radius = this.model === 'stress' || this.model === 'weibull' ? 0.028 : TAP_RADIUS;
      gl.useProgram(this.injectProgram);
      gl.uniform1i(this.uni(gl, this.injectProgram, 'u_state'), 0);
      gl.uniform2f(this.uni(gl, this.injectProgram, 'u_center'), x, y);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_energy'), energy);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_radius'), radius);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_aspect'), aspect);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_spokeRot'), Math.random() * Math.PI * 2);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_spokeCount'), 5 + Math.floor(Math.random() * 3));
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_spokeLen'), spokeLen);
      this.crack.bindRead(gl, 0);
      this.crack.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.crack.swap();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      if (this.model === 'stress' || this.model === 'weibull') {
        this.loadPos = [x, y];
        this.loadUntil = time + LOAD_DURATION;
        this.loadAmp = (this.model === 'weibull' ? 1.4 : 1) + 0.25 * this.stallCount;
      } else if (this.model === 'modes') {
        this.exciteModePath(gl, x, y, aspect);
      }

      this.lastTap = [x, y];
      this.lastTapTime = time;
      this.strikesOnSlab++;
      this.shakeAmp = Math.min(this.shakeAmp + 0.004 + 0.014 * this.breakProgress * this.breakProgress, 0.02);
      // Nearing the breaking point: a beat of light shafts from the deep cracks
      if (this.breakProgress > 0.6) {
        this.burstPos = [x, y];
        this.burstStart = time;
        this.burstStrength = 0.35 + 0.55 * this.breakProgress;
      }
    }
    this.pendingTaps = [];
  }

  // ── Voronoi Faults: energy flooding through a cellular fault field ──

  private stepCracks(gl: WebGL2RenderingContext, aspect: number) {
    gl.useProgram(this.computeProgram);
    gl.uniform1i(this.uni(gl, this.computeProgram, 'u_state'), 0);
    gl.uniform2f(this.uni(gl, this.computeProgram, 'u_texel'), 1 / this.crack.width, 1 / this.crack.height);
    gl.uniform1f(this.uni(gl, this.computeProgram, 'u_seed'), this.seeds[0]);
    gl.uniform1f(this.uni(gl, this.computeProgram, 'u_aspect'), aspect);
    // Normalize warp amplitude by frequency so Kink Angle sets the actual
    // heading change per kink, independent of how often kinks occur
    const kinkAmp = Math.tan((this.kinkAngle * Math.PI) / 180) / this.kinkFreq;
    gl.uniform1f(this.uni(gl, this.computeProgram, 'u_kinkAmp'), kinkAmp);
    gl.uniform1f(this.uni(gl, this.computeProgram, 'u_kinkFreq'), this.kinkFreq);
    gl.uniform1f(this.uni(gl, this.computeProgram, 'u_branchScale'), this.branchFreq);
    gl.uniform1f(this.uni(gl, this.computeProgram, 'u_branchSquash'), Math.min(120 / this.branchAngle, 2.4));
    gl.uniform1f(this.uni(gl, this.computeProgram, 'u_squashAngle'), (this.seeds[0] % 1) * Math.PI);
    for (let i = 0; i < COMPUTE_STEPS; i++) {
      this.crack.bindRead(gl, 0);
      this.crack.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.crack.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Stress Field / Weibull Bonds: relax potential, then grow damage ──

  private stepStress(gl: WebGL2RenderingContext, ctx: EngineContext, aspect: number) {
    const texelX = 1 / this.crack.width;
    const texelY = 1 / this.crack.height;
    const loadActive = ctx.time < this.loadUntil;
    const grow = this.model === 'stress' ? this.growStressProgram : this.growWeibullProgram;

    for (let cycle = 0; cycle < GROW_CYCLES; cycle++) {
      gl.useProgram(this.relaxProgram);
      gl.uniform1i(this.uni(gl, this.relaxProgram, 'u_stress'), 0);
      gl.uniform1i(this.uni(gl, this.relaxProgram, 'u_state'), 1);
      gl.uniform2f(this.uni(gl, this.relaxProgram, 'u_texel'), texelX, texelY);
      gl.uniform2f(this.uni(gl, this.relaxProgram, 'u_load'), this.loadPos[0], this.loadPos[1]);
      gl.uniform1f(this.uni(gl, this.relaxProgram, 'u_loadAmp'), loadActive ? this.loadAmp : 0);
      gl.uniform1f(this.uni(gl, this.relaxProgram, 'u_loadRadius'), 0.05);
      gl.uniform1f(this.uni(gl, this.relaxProgram, 'u_ambient'), AMBIENT_STRESS);
      gl.uniform1f(this.uni(gl, this.relaxProgram, 'u_aspect'), aspect);
      this.crack.bindRead(gl, 1);
      for (let i = 0; i < RELAX_PER_CYCLE; i++) {
        this.stress.bindRead(gl, 0);
        this.stress.bindWrite(gl);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.stress.swap();
      }

      gl.useProgram(grow);
      gl.uniform1i(this.uni(gl, grow, 'u_state'), 0);
      gl.uniform1i(this.uni(gl, grow, 'u_stress'), 1);
      gl.uniform2f(this.uni(gl, grow, 'u_texel'), texelX, texelY);
      gl.uniform1f(this.uni(gl, grow, 'u_seed'), this.seeds[0]);
      gl.uniform1f(this.uni(gl, grow, 'u_aspect'), aspect);
      if (this.model === 'stress') {
        // Vary the RNG per growth cycle within the frame too
        gl.uniform1f(this.uni(gl, grow, 'u_time'), ctx.time + cycle * 0.137);
        gl.uniform1f(this.uni(gl, grow, 'u_toughness'), this.toughness);
        gl.uniform1f(this.uni(gl, grow, 'u_hetero'), this.hetero);
      } else {
        gl.uniform1f(this.uni(gl, grow, 'u_strength'), this.bondStrength);
        gl.uniform1f(this.uni(gl, grow, 'u_scatter'), this.scatter);
        // Subcritical crack growth: every strike fatigues the slab, so
        // each one pushes the near-critical front a bit further
        gl.uniform1f(this.uni(gl, grow, 'u_fatigue'), 1 / (1 + 0.07 * this.strikesOnSlab));
      }
      this.stress.bindRead(gl, 1);
      this.crack.bindRead(gl, 0);
      this.crack.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.crack.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Fracture Modes: strikes reveal precomputed weakest paths ─────────

  private exciteModePath(gl: WebGL2RenderingContext, x: number, y: number, aspect: number) {
    this.ensureModePaths(aspect);
    if (this.modePaths.length === 0) return;

    const px = x * aspect;
    let best = 0;
    let bestIdx = 0;
    let bestD = Infinity;
    this.modePaths.forEach((path, k) => {
      path.pts.forEach((pt, i) => {
        const d = Math.hypot(pt.x - px, pt.y - y);
        if (d < bestD) {
          bestD = d;
          best = k;
          bestIdx = i;
        }
      });
    });

    const path = this.modePaths[best];
    const rv = this.modeReveal[best];
    const last = path.pts.length - 1;
    const run = Math.max(2, Math.round(path.pts.length * this.modeRun * (1 + 0.3 * this.stallCount)));
    if (rv.lo < 0) {
      rv.lo = Math.max(0, bestIdx - run);
      rv.hi = Math.min(last, bestIdx + run);
    } else {
      // Re-striking a revealed crack runs it further along its
      // predestined line in both directions
      rv.lo = Math.max(0, rv.lo - run);
      rv.hi = Math.min(last, rv.hi + run);
    }

    // The strike deepens the line LOCALLY: a bump centred where the tap
    // projects onto the crack, so hammering one spot darkens and widens
    // the crack there rather than everywhere
    const SIG = 16; // bump half-width, fine-vertex indices
    for (let i = rv.lo; i <= rv.hi; i++) {
      const bump = 1.15 * Math.exp(-(((i - bestIdx) / SIG) ** 2));
      rv.depthAt[i] = Math.min(6.5, Math.max(rv.depthAt[i], 2.4) + bump);
    }

    // Branches grow with proximity to the strike: the thicket sprouts
    // around where you hammer, distant branches barely creep
    path.branches.forEach((br, bi) => {
      if (br.anchorIdx < rv.lo || br.anchorIdx > rv.hi) return;
      const root = br.pts[0];
      const d = Math.hypot(root.x - px, root.y - y);
      const w = Math.exp(-((d / 0.16) ** 2));
      rv.brSteps[bi] = Math.min(br.pts.length - 1, rv.brSteps[bi] + (w > 0.05 ? 1 + Math.round(3.5 * w) : 0.35));
      rv.brDepth[bi] = Math.min(4.5, rv.brDepth[bi] + 0.25 + 1.2 * w);
    });

    this.stampReveal(gl, path, rv, aspect);
  }

  private stampReveal(
    gl: WebGL2RenderingContext,
    path: ModePath,
    rv: { lo: number; hi: number; depthAt: Float32Array; brSteps: Float32Array; brDepth: Float32Array },
    aspect: number,
  ) {
    const segs: number[] = [];
    const depths: number[] = [];
    for (let i = rv.lo; i < rv.hi; i++) {
      const a = path.pts[i];
      const b = path.pts[i + 1];
      segs.push(a.x, a.y, b.x, b.y);
      let dep = Math.max(rv.depthAt[i], rv.depthAt[i + 1]);
      // Taper toward the ends of the revealed interval (unless the
      // interval has reached the slab edge)
      const fromEnd = Math.min(i - rv.lo, rv.hi - 1 - i);
      const atEdge = (i - rv.lo < 4 && rv.lo === 0) || (rv.hi - 1 - i < 4 && rv.hi === path.pts.length - 1);
      if (!atEdge && fromEnd < 4) dep *= 0.5 + 0.125 * fromEnd;
      depths.push(dep);
    }
    // Branches: only their grown portion, shallower with nesting level,
    // tapering to the tip
    path.branches.forEach((br, bi) => {
      const steps = Math.floor(rv.brSteps[bi]);
      if (steps < 1 || rv.brDepth[bi] < 0.4) return;
      if (br.anchorIdx < rv.lo || br.anchorIdx > rv.hi) return;
      const lvl = 1 - 0.18 * (br.level - 1);
      for (let i = 0; i < steps && i + 1 < br.pts.length; i++) {
        const a = br.pts[i];
        const b = br.pts[i + 1];
        segs.push(a.x, a.y, b.x, b.y);
        const t = 1 - i / Math.max(steps, 1);
        depths.push(rv.brDepth[bi] * lvl * (0.45 + 0.55 * t));
      }
    });

    gl.useProgram(this.stampProgram);
    gl.uniform1i(this.uni(gl, this.stampProgram, 'u_state'), 0);
    gl.uniform1f(this.uni(gl, this.stampProgram, 'u_width'), 0.0065);
    gl.uniform1f(this.uni(gl, this.stampProgram, 'u_aspect'), aspect);
    for (let off = 0; off < segs.length / 4; off += MAX_SEGS) {
      const count = Math.min(MAX_SEGS, segs.length / 4 - off);
      const segArr = new Float32Array(MAX_SEGS * 4);
      const depthArr = new Float32Array(MAX_SEGS);
      segArr.set(segs.slice(off * 4, (off + count) * 4));
      depthArr.set(depths.slice(off, off + count));
      gl.uniform4fv(this.uni(gl, this.stampProgram, 'u_segs[0]'), segArr);
      gl.uniform1fv(this.uni(gl, this.stampProgram, 'u_segDepth[0]'), depthArr);
      gl.uniform1i(this.uni(gl, this.stampProgram, 'u_segCount'), count);
      this.crack.bindRead(gl, 0);
      this.crack.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.crack.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ── Shared analysis / shatter pipeline ───────────────────────────────

  private analyseDamage(ctx: EngineContext) {
    const { gl, time } = ctx;
    gl.useProgram(this.analysisProgram);
    gl.uniform1i(this.uni(gl, this.analysisProgram, 'u_state'), 0);
    gl.uniform2f(this.uni(gl, this.analysisProgram, 'u_gridSize'), ANALYSIS_W, ANALYSIS_H);
    this.crack.bindRead(gl, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.analysisFBO);
    gl.viewport(0, 0, ANALYSIS_W, ANALYSIS_H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, ANALYSIS_W, ANALYSIS_H, gl.RGBA, gl.UNSIGNED_BYTE, this.analysisBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let deepSum = 0;
    let maxDepth = 0;
    let minX = ANALYSIS_W;
    let maxX = -1;
    let minY = ANALYSIS_H;
    let maxY = -1;
    for (let y = 0; y < ANALYSIS_H; y++) {
      for (let x = 0; x < ANALYSIS_W; x++) {
        const i = y * ANALYSIS_W + x;
        deepSum += this.analysisBuf[i * 4 + 1];
        const mx = this.analysisBuf[i * 4 + 2];
        if (mx > maxDepth) maxDepth = mx;
        if (this.analysisBuf[i * 4] > 12) { // cell contains a real crack
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const n = ANALYSIS_W * ANALYSIS_H;
    const deepFrac = deepSum / (n * 255);
    const maxD = (maxDepth / 255) * 8;
    const spanX = maxX >= minX ? (maxX - minX + 1) / ANALYSIS_W : 0;
    const spanY = maxY >= minY ? (maxY - minY + 1) / ANALYSIS_H : 0;

    // The slab only lets go once the crack network reaches most of the way
    // across the screen AND enough of it runs deep
    const spanScore = Math.max(spanX, spanY) / SPAN_TARGET;
    const deepScore = (deepFrac / DEEP_FRAC_TARGET) * Math.min(Math.max((maxD - 1.0) / 1.5, 0), 1);
    const progress = Math.min(spanScore, deepScore);
    this.breakProgress = Math.min(progress, 1);

    if (progress >= 1) this.beginShatter(ctx, time);
  }

  private cellCracked(ix: number, iy: number): number {
    ix = Math.min(Math.max(ix, 0), ANALYSIS_W - 1);
    iy = Math.min(Math.max(iy, 0), ANALYSIS_H - 1);
    return this.analysisBuf[(iy * ANALYSIS_W + ix) * 4] / 255;
  }

  private beginShatter(ctx: EngineContext, time: number) {
    this.phase = 'bursting';
    this.shatterAt = time + SHATTER_DELAY;
    // The final burst: light floods out of the seams, shake goes violent
    this.burstPos = [...this.lastTap];
    this.burstStart = time;
    this.burstStrength = 1.25;
    this.shakeAmp = 0.022;

    const aspect = ctx.width / ctx.height;
    this.useMap = false;
    this.pieceCount = NP;
    let areas: number[] | null = null;

    if (this.model === 'modes' && this.modePaths.length > 0) {
      // The final failure: every struck crack SNAPS — its reveal
      // completes through the whole slab during the burst beat — and the
      // pieces are exactly the regions those cracks enclose. An arrested
      // crack terminates on an older fault, so completing it drags that
      // parent fault (and its parents) into the failure too — otherwise
      // a crack ending mid-slab couldn't cut a piece free.
      const revealed = this.modePaths.map((_, k) => this.modeReveal[k].lo >= 0);
      for (let k = this.modePaths.length - 1; k >= 0; k--) {
        const parent = this.modePaths[k].arrestParent;
        if (revealed[k] && parent >= 0) revealed[parent] = true;
      }
      this.modePaths.forEach((path, k) => {
        if (!revealed[k]) return;
        const rv = this.modeReveal[k];
        rv.lo = 0;
        rv.hi = path.pts.length - 1;
        for (let i = 0; i < rv.depthAt.length; i++) rv.depthAt[i] = Math.max(rv.depthAt[i], 4.5);
        this.stampReveal(ctx.gl, path, rv, aspect);
      });
      const map = buildRegionMap(this.modePaths, revealed, aspect, NP);
      if (map.count >= 2) {
        this.uploadPieceMap(ctx.gl, map);
        this.pieceCount = map.count;
        this.useMap = true;
        areas = map.areas;
        for (let i = 0; i < map.count; i++) {
          this.pieceSeed[i * 2] = map.centroids[i].x;
          this.pieceSeed[i * 2 + 1] = map.centroids[i].y;
        }
      }
    }
    if (!this.useMap) this.seedVoronoiPieces(aspect);

    // Radiate away from the final tap, pop up a little, then gravity wins.
    // With real shards, spin scales inversely with size: big slabs turn
    // lazily, chips tumble.
    const [tx, ty] = this.lastTap;
    this.pieces = [];
    for (let i = 0; i < this.pieceCount; i++) {
      const sx = this.pieceSeed[i * 2];
      const sy = this.pieceSeed[i * 2 + 1];
      let dx = sx - tx * aspect;
      let dy = sy - ty;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const speed = 0.1 + Math.random() * 0.25;
      const spin = areas ? Math.min(1.5, 0.28 / Math.sqrt(Math.max(areas[i], 0.02))) : 1;
      this.pieces.push({
        x: 0,
        y: 0,
        rot: 0,
        vx: dx * speed,
        vy: dy * speed + 0.15 + Math.random() * 0.2,
        vr: (Math.random() - 0.5) * 4.0 * spin,
      });
    }
    this.pieceState.fill(0);
  }

  private seedVoronoiPieces(aspect: number) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        const jx = (Math.random() - 0.5) * 0.7;
        const jy = (Math.random() - 0.5) * 0.7;
        // Voronoi boundaries fall midway between seeds, so nudging each
        // seed to the least-cracked analysis cell nearby pulls the
        // fracture lines toward the actual crack seams
        const gx = Math.round((((c + 0.5 + jx) / COLS) * ANALYSIS_W));
        const gy = Math.round((((r + 0.5 + jy) / ROWS) * ANALYSIS_H));
        let bx = gx;
        let by = gy;
        let bestVal = Infinity;
        for (let dy = -3; dy <= 3; dy++) {
          for (let dx = -3; dx <= 3; dx++) {
            const v = this.cellCracked(gx + dx, gy + dy) + Math.random() * 0.02;
            if (v < bestVal) {
              bestVal = v;
              bx = gx + dx;
              by = gy + dy;
            }
          }
        }
        this.pieceSeed[i * 2] = ((Math.min(Math.max(bx, 0), ANALYSIS_W - 1) + 0.5) / ANALYSIS_W) * aspect;
        this.pieceSeed[i * 2 + 1] = (Math.min(Math.max(by, 0), ANALYSIS_H - 1) + 0.5) / ANALYSIS_H;
      }
    }
  }

  private uploadPieceMap(gl: WebGL2RenderingContext, map: RegionMap) {
    if (!this.pieceMapTex) this.pieceMapTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.pieceMapTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, map.gw, map.gh, 0, gl.RED, gl.UNSIGNED_BYTE, map.ids);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private updatePieces(dt: number) {
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      p.vy -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      this.pieceState[i * 4] = p.x;
      this.pieceState[i * 4 + 1] = p.y;
      this.pieceState[i * 4 + 2] = p.rot;
    }
  }

  private resetSlab(ctx: EngineContext) {
    // The next slab becomes current; bake a fresh one behind it
    this.rockTex.reverse();
    this.seeds = [this.seeds[1], Math.random() * 100];
    this.bakeRock(ctx, 1);
    this.clearFields(ctx.gl);
    this.resetInteractionState();
  }

  private draw(ctx: EngineContext, aspect: number) {
    const { gl, time } = ctx;
    const p = this.displayProgram;

    // Smooth pseudo-random pan; amplitude decays after every impact
    const shakeX = this.shakeAmp * (Math.sin(time * 73.7) * 0.6 + Math.sin(time * 31.3) * 0.4) / aspect;
    const shakeY = this.shakeAmp * (Math.cos(time * 67.1) * 0.6 + Math.cos(time * 23.9) * 0.4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(p);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rockTex[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rockTex[1]);
    this.crack.bindRead(gl, 2);
    gl.bindSampler(2, this.linearSampler);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.pieceMapTex);

    gl.uniform1i(this.uni(gl, p, 'u_rock'), 0);
    gl.uniform1i(this.uni(gl, p, 'u_rockNext'), 1);
    gl.uniform1i(this.uni(gl, p, 'u_state'), 2);
    gl.uniform2f(this.uni(gl, p, 'u_resolution'), ctx.width, ctx.height);
    gl.uniform1f(this.uni(gl, p, 'u_time'), time);
    gl.uniform2f(this.uni(gl, p, 'u_stateTexel'), 1 / this.crack.width, 1 / this.crack.height);
    gl.uniform2f(this.uni(gl, p, 'u_shake'), shakeX, shakeY);
    gl.uniform1f(this.uni(gl, p, 'u_breakProgress'), this.breakProgress);
    gl.uniform4f(
      this.uni(gl, p, 'u_burst'),
      this.burstPos[0],
      this.burstPos[1],
      time - this.burstStart,
      this.burstStrength,
    );
    gl.uniform1f(this.uni(gl, p, 'u_phase'), this.phase === 'falling' ? 1 : 0);
    gl.uniform1f(this.uni(gl, p, 'u_fallT'), this.phase === 'falling' ? time - this.fallStart : 0);
    gl.uniform2fv(this.uni(gl, p, 'u_pieceSeed[0]'), this.pieceSeed);
    gl.uniform4fv(this.uni(gl, p, 'u_pieceState[0]'), this.pieceState);
    gl.uniform1i(this.uni(gl, p, 'u_pieceMap'), 3);
    gl.uniform1i(this.uni(gl, p, 'u_pieceCount'), this.pieceCount);
    gl.uniform1f(this.uni(gl, p, 'u_useMap'), this.useMap ? 1 : 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindSampler(2, null); // don't leak the sampler to other passes/plugins
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.rockProgram);
    gl.deleteProgram(this.injectProgram);
    gl.deleteProgram(this.computeProgram);
    gl.deleteProgram(this.analysisProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteProgram(this.relaxProgram);
    gl.deleteProgram(this.growStressProgram);
    gl.deleteProgram(this.growWeibullProgram);
    gl.deleteProgram(this.stampProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteFramebuffer(this.bakeFBO);
    gl.deleteFramebuffer(this.analysisFBO);
    gl.deleteTexture(this.analysisTex);
    gl.deleteSampler(this.linearSampler);
    if (this.pieceMapTex) gl.deleteTexture(this.pieceMapTex);
    gl.deleteTexture(this.rockTex[0]);
    gl.deleteTexture(this.rockTex[1]);
    this.crack.destroy(gl);
    this.stress.destroy(gl);
    this.sliders.destroy();
  }
}
