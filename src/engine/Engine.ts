import { EngineContext, GestureEvent } from './types';
import { InputManager } from './InputManager';
import { Plugin } from '../plugin/Plugin';

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

    this.input = new InputManager(this.canvas, this.onGesture);
    window.addEventListener('resize', this.resize);
    this.resize();

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
    const dt = now - this.lastFrameTime;
    this.lastFrameTime = now;

    if (this.activePlugin) {
      this.activePlugin.render(this.buildContext(dt));
    }

    this.rafId = requestAnimationFrame(this.loop);
  };

  private resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth * dpr;
    const h = this.canvas.clientHeight * dpr;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
    }
  };

  destroy() {
    cancelAnimationFrame(this.rafId);
    if (this.activePlugin) {
      this.activePlugin.destroy(this.buildContext(0));
    }
    this.input.destroy();
    window.removeEventListener('resize', this.resize);
  }
}
