import { EngineContext, GestureEvent } from './types';
import { InputManager } from './InputManager';
import { Plugin } from '../plugin/Plugin';

const MAX_DT = 0.1; // Cap dt at 100ms to prevent animation jumps after tab switches

export class Engine {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private input: InputManager;
  private activePlugin: Plugin | null = null;
  private startTime = 0;
  private lastFrameTime = 0;
  private rafId = 0;

  constructor(container: HTMLElement = document.body) {
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
    container.appendChild(this.canvas);

    const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    gl.clearColor(0, 0, 0, 1);

    this.input = new InputManager(this.canvas, this.onGesture);
    this.checkResize();

    this.lastFrameTime = performance.now() / 1000;
    this.startTime = this.lastFrameTime;
    this.rafId = requestAnimationFrame(this.loop);
  }

  loadPlugin(plugin: Plugin) {
    if (this.activePlugin) {
      this.activePlugin.destroy(this.buildContext(0));
    }
    this.activePlugin = plugin;
    this.startTime = performance.now() / 1000;
    this.lastFrameTime = this.startTime;
    plugin.init(this.buildContext(0));
  }

  private buildContext(dt: number): EngineContext {
    return {
      gl: this.gl,
      canvas: this.canvas,
      width: this.canvas.width,
      height: this.canvas.height,
      time: performance.now() / 1000 - this.startTime,
      dt,
    };
  }

  private onGesture = (event: GestureEvent) => {
    if (this.activePlugin?.onGesture) {
      this.activePlugin.onGesture(this.buildContext(0), event);
    }
  };

  private loop = (nowMs: number) => {
    const now = nowMs / 1000;
    const dt = Math.min(now - this.lastFrameTime, MAX_DT);
    this.lastFrameTime = now;

    const gl = this.gl;

    // Check for resize at the top of the frame so that any buffer clear
    // from setting canvas.width/height is immediately followed by a render,
    // preventing the compositor from ever seeing a cleared-but-unrendered buffer.
    const resized = this.checkResize();

    if (this.activePlugin) {
      if (resized && this.activePlugin.resize) {
        this.activePlugin.resize(this.buildContext(dt));
      }

      // Clear before rendering: on tile-based mobile GPUs (Mali, Adreno, Apple),
      // this tells the GPU it can discard old tile contents instead of loading
      // them from main memory — preventing tearing from mid-writeback compositor reads.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.activePlugin.render(this.buildContext(dt));

      // Flush the command queue so the GPU starts processing before the
      // compositor reads the buffer at vsync.
      gl.flush();
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private checkResize(): boolean {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (w === 0 || h === 0) return false;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
      return true;
    }
    return false;
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    if (this.activePlugin) {
      this.activePlugin.destroy(this.buildContext(0));
    }
    this.input.destroy();
  }
}
