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

const NP = 12; // shatter piece count — must match NP in display.glsl

const COMPUTE_STEPS = 6;        // crack-growth steps per frame
const TAP_ENERGY = 2.4;
const TAP_RADIUS = 0.045;       // splat radius, fraction of frame height
const ANALYSIS_W = 64;
const ANALYSIS_H = 40;
const DEEP_FRAC_TARGET = 0.008; // deep-crack coverage needed to shatter
const SPAN_TARGET = 0.85;       // crack network must reach this far across
const BURST_BEAT = 0.5;         // light-shaft duration (matches display.glsl)
const SHATTER_DELAY = 0.42;     // beat between final burst and pieces falling
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
  private vao!: WebGLVertexArrayObject;
  private crack!: PingPongFBO;

  // Two full-res baked slabs: [0] = current, [1] = next (revealed on shatter)
  private rockTex: WebGLTexture[] = [];
  private bakeFBO!: WebGLFramebuffer;
  private seeds: [number, number] = [Math.random() * 100, Math.random() * 100];

  private analysisTex!: WebGLTexture;
  private analysisFBO!: WebGLFramebuffer;
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

  private sliders!: ParamSlider;
  private kinkAngle = 16;   // degrees of heading jitter per kink
  private kinkFreq = 13;    // kinks per unit of frame height
  private branchAngle = 110; // typical junction angle, degrees
  private branchFreq = 2.2; // primary fault cells per unit of frame height
  private burstStart = -100;
  private burstPos: [number, number] = [0.5, 0.5];
  private burstStrength = 0;

  private shatterAt = 0;
  private fallStart = 0;
  private pieces: Piece[] = [];
  private pieceSeed = new Float32Array(NP * 2);
  private pieceState = new Float32Array(NP * 4);

  init(ctx: EngineContext) {
    const { gl } = ctx;
    this.rockProgram = createProgram(gl, quadVert, rockSrc);
    this.injectProgram = createProgram(gl, quadVert, injectSrc);
    this.computeProgram = createProgram(gl, quadVert, computeSrc);
    this.analysisProgram = createProgram(gl, quadVert, analysisSrc);
    this.displayProgram = createProgram(gl, quadVert, displaySrc);
    this.vao = gl.createVertexArray()!;

    this.crack = new PingPongFBO(gl, Math.floor(ctx.width / 2), Math.floor(ctx.height / 2));

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

    this.sliders = new ParamSlider();
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

  private clearCrackField(gl: WebGL2RenderingContext) {
    for (let i = 0; i < 2; i++) {
      this.crack.bindWrite(gl);
      gl.clear(gl.COLOR_BUFFER_BIT); // engine clear colour (0,0,0,1) = no damage
      this.crack.swap();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteTexture(this.rockTex[0]);
    gl.deleteTexture(this.rockTex[1]);
    this.rockTex = [this.createRockTexture(gl, ctx.width, ctx.height), this.createRockTexture(gl, ctx.width, ctx.height)];
    this.bakeRock(ctx, 0);
    this.bakeRock(ctx, 1);
    this.crack.resize(gl, Math.floor(ctx.width / 2), Math.floor(ctx.height / 2));
    this.phase = 'intact';
    this.breakProgress = 0;
    this.pendingTaps = [];
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

    gl.bindVertexArray(this.vao);

    if (this.phase === 'intact') {
      this.processTaps(ctx, aspect);
      this.stepCracks(gl, aspect);
      // Analyse damage while fracture energy could still be spreading
      if (this.frame % 10 === 0 && time - this.lastTapTime < 6) {
        this.analyseDamage(ctx);
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
      // Working the stone: if the last strike barely moved the needle
      // (e.g. it landed far from any fault), hit harder each time
      if (this.breakProgress - this.progressAtLastTap < 0.04) {
        this.stallCount = Math.min(this.stallCount + 1, 4);
      } else {
        this.stallCount = 0;
      }
      this.progressAtLastTap = this.breakProgress;

      gl.useProgram(this.injectProgram);
      gl.uniform1i(this.uni(gl, this.injectProgram, 'u_state'), 0);
      gl.uniform2f(this.uni(gl, this.injectProgram, 'u_center'), x, y);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_energy'), TAP_ENERGY * (1 + 0.5 * this.stallCount));
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_radius'), TAP_RADIUS);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_aspect'), aspect);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_spokeRot'), Math.random() * Math.PI * 2);
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_spokeCount'), 5 + Math.floor(Math.random() * 3));
      gl.uniform1f(this.uni(gl, this.injectProgram, 'u_spokeLen'), 0.08 + Math.random() * 0.05);
      this.crack.bindRead(gl, 0);
      this.crack.bindWrite(gl);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.crack.swap();

      this.lastTap = [x, y];
      this.lastTapTime = time;
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
    const [tx, ty] = this.lastTap;
    const cols = 4;
    const rows = 3;
    this.pieces = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const jx = (Math.random() - 0.5) * 0.7;
        const jy = (Math.random() - 0.5) * 0.7;
        // Voronoi boundaries fall midway between seeds, so nudging each
        // seed to the least-cracked analysis cell nearby pulls the
        // fracture lines toward the actual crack seams
        const gx = Math.round((((c + 0.5 + jx) / cols) * ANALYSIS_W));
        const gy = Math.round((((r + 0.5 + jy) / rows) * ANALYSIS_H));
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
        const sx = ((Math.min(Math.max(bx, 0), ANALYSIS_W - 1) + 0.5) / ANALYSIS_W) * aspect;
        const sy = (Math.min(Math.max(by, 0), ANALYSIS_H - 1) + 0.5) / ANALYSIS_H;
        this.pieceSeed[i * 2] = sx;
        this.pieceSeed[i * 2 + 1] = sy;

        // Radiate away from the final tap, pop up a little, then gravity wins
        let dx = sx - tx * aspect;
        let dy = sy - ty;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const speed = 0.1 + Math.random() * 0.25;
        this.pieces.push({
          x: 0,
          y: 0,
          rot: 0,
          vx: dx * speed,
          vy: dy * speed + 0.15 + Math.random() * 0.2,
          vr: (Math.random() - 0.5) * 4.0,
        });
      }
    }
    this.pieceState.fill(0);
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
    this.clearCrackField(ctx.gl);
    this.phase = 'intact';
    this.breakProgress = 0;
    this.lastTapTime = -100;
    this.stallCount = 0;
    this.progressAtLastTap = 0;
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

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.rockProgram);
    gl.deleteProgram(this.injectProgram);
    gl.deleteProgram(this.computeProgram);
    gl.deleteProgram(this.analysisProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteVertexArray(this.vao);
    gl.deleteFramebuffer(this.bakeFBO);
    gl.deleteFramebuffer(this.analysisFBO);
    gl.deleteTexture(this.analysisTex);
    gl.deleteTexture(this.rockTex[0]);
    gl.deleteTexture(this.rockTex[1]);
    this.crack.destroy(gl);
    this.sliders.destroy();
  }
}
