import { InputManager } from './InputManager';
export class Engine {
    constructor(container = document.body) {
        this.activePlugin = null;
        this.startTime = 0;
        this.lastFrameTime = 0;
        this.rafId = 0;
        this.onGesture = (event) => {
            if (this.activePlugin?.onGesture) {
                this.activePlugin.onGesture(this.buildContext(0), event);
            }
        };
        this.loop = (nowMs) => {
            const now = nowMs / 1000;
            const dt = now - this.lastFrameTime;
            this.lastFrameTime = now;
            if (this.activePlugin) {
                this.activePlugin.render(this.buildContext(dt));
            }
            this.rafId = requestAnimationFrame(this.loop);
        };
        this.resize = () => {
            const dpr = window.devicePixelRatio || 1;
            const w = this.canvas.clientWidth * dpr;
            const h = this.canvas.clientHeight * dpr;
            if (this.canvas.width !== w || this.canvas.height !== h) {
                this.canvas.width = w;
                this.canvas.height = h;
                this.gl.viewport(0, 0, w, h);
            }
        };
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'display:block;width:100%;height:100%;';
        container.appendChild(this.canvas);
        const gl = this.canvas.getContext('webgl2', { alpha: false, antialias: false });
        if (!gl)
            throw new Error('WebGL2 not supported');
        this.gl = gl;
        this.input = new InputManager(this.canvas, this.onGesture);
        window.addEventListener('resize', this.resize);
        this.resize();
        this.lastFrameTime = performance.now() / 1000;
        this.startTime = this.lastFrameTime;
        this.rafId = requestAnimationFrame(this.loop);
    }
    loadPlugin(plugin) {
        if (this.activePlugin) {
            this.activePlugin.destroy(this.buildContext(0));
        }
        this.activePlugin = plugin;
        this.startTime = performance.now() / 1000;
        this.lastFrameTime = this.startTime;
        plugin.init(this.buildContext(0));
    }
    buildContext(dt) {
        return {
            gl: this.gl,
            canvas: this.canvas,
            width: this.canvas.width,
            height: this.canvas.height,
            time: performance.now() / 1000 - this.startTime,
            dt,
        };
    }
    destroy() {
        cancelAnimationFrame(this.rafId);
        if (this.activePlugin) {
            this.activePlugin.destroy(this.buildContext(0));
        }
        this.input.destroy();
        window.removeEventListener('resize', this.resize);
    }
}
