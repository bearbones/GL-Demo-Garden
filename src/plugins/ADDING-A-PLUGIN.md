# Adding a New Plugin

Plugins are self-contained units. The engine hands you a `WebGL2RenderingContext`, a canvas, and timing information; you own everything else. This guide walks through two templates — a simple single-pass shader and a two-pass compute demo.

---

## Checklist

1. Create a directory under `src/plugins/<your-name>/`
2. Write `index.ts` implementing the `Plugin` interface
3. Add any `.glsl` shader files alongside it
4. Register the plugin in `src/main.ts`

---

## Template A — Single-Pass Fragment Shader

This is the easiest path. Extend `FragmentShaderPlugin` and provide a fragment source. The base class handles program compilation, the fullscreen triangle draw, and `u_time`, `u_resolution`, and `u_mouse` uniforms automatically.

### `src/plugins/my-effect/index.ts`

```ts
import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import fragmentSrc from './fragment.glsl';

export class MyEffectPlugin extends FragmentShaderPlugin {
  readonly name = 'My Effect';
  protected fragmentSource() { return fragmentSrc; }
}
```

For extra uniforms, override `setUniforms`:

```ts
protected setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, ctx: EngineContext) {
  gl.uniform1f(gl.getUniformLocation(program, 'u_speed'), this.speed);
}
```

### `src/plugins/my-effect/fragment.glsl`

```glsl
#version 300 es
precision highp float;

// Provided by FragmentShaderPlugin:
uniform float u_time;
uniform vec2  u_resolution;
uniform vec2  u_mouse;      // [0,1] normalized, origin top-left

in  vec2 v_uv;
out vec4 fragColor;

void main() {
  vec2 uv = v_uv;
  fragColor = vec4(uv, 0.5 + 0.5 * sin(u_time), 1.0);
}
```

---

## Template B — Compute + Display (Ping-Pong)

Use this for simulations that evolve over time: reaction-diffusion, wave equations, fluid, cellular automata.

### `src/plugins/my-sim/index.ts`

```ts
import { Plugin } from '../../plugin/Plugin';
import { PingPongFBO } from '../../plugin/PingPongFBO';
import { EngineContext, GestureEvent } from '../../engine/types';
import { createProgram } from '../../engine/gl-utils';
import quadVert from '../../shaders/fullscreen-quad.vert';
import computeSrc from './compute.glsl';
import displaySrc from './display.glsl';

export class MySimPlugin implements Plugin {
  readonly name = 'My Sim';

  private computeProgram!: WebGLProgram;
  private displayProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;
  private fbo!: PingPongFBO;

  init(ctx: EngineContext) {
    const { gl } = ctx;
    this.computeProgram = createProgram(gl, quadVert, computeSrc);
    this.displayProgram = createProgram(gl, quadVert, displaySrc);
    this.vao = gl.createVertexArray()!;

    // Run simulation at half resolution for performance
    const w = Math.floor(ctx.width / 2);
    const h = Math.floor(ctx.height / 2);
    this.fbo = new PingPongFBO(gl, w, h);
  }

  render(ctx: EngineContext) {
    const { gl } = ctx;

    // ── Compute pass ──────────────────────────────────────────────
    gl.useProgram(this.computeProgram);
    gl.uniform1i(gl.getUniformLocation(this.computeProgram, 'u_state'), 0);
    gl.uniform1f(gl.getUniformLocation(this.computeProgram, 'u_time'), ctx.time);

    this.fbo.bindRead(gl, 0);    // previous state → texture unit 0
    this.fbo.bindWrite(gl);       // write into current FBO
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.fbo.swap();              // roles reverse for next frame

    // ── Display pass ──────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.useProgram(this.displayProgram);
    this.fbo.bindRead(gl, 0);
    gl.uniform1i(gl.getUniformLocation(this.displayProgram, 'u_state'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  onGesture(_ctx: EngineContext, event: GestureEvent) {
    // Handle tap/drag if your sim needs interaction
  }

  destroy(ctx: EngineContext) {
    const { gl } = ctx;
    gl.deleteProgram(this.computeProgram);
    gl.deleteProgram(this.displayProgram);
    gl.deleteVertexArray(this.vao);
    this.fbo.destroy(gl);
  }
}
```

### `src/plugins/my-sim/compute.glsl`

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_state;
uniform float     u_time;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
  vec4 prev = texture(u_state, v_uv);
  // ... evolve state ...
  fragColor = prev;
}
```

### `src/plugins/my-sim/display.glsl`

```glsl
#version 300 es
precision highp float;

uniform sampler2D u_state;

in  vec2 v_uv;
out vec4 fragColor;

void main() {
  float value = texture(u_state, v_uv).r;
  fragColor = vec4(vec3(value), 1.0);
}
```

---

## Register in main.ts

Open `src/main.ts` and add your import and entry:

```ts
import { MyEffectPlugin } from './plugins/my-effect';   // or MySimPlugin

const PLUGINS: Record<string, () => Plugin> = {
  // ... existing entries ...
  'my-effect': () => new MyEffectPlugin(),
};
```

The key becomes the URL hash and the nav label (hyphens are replaced with spaces and capitalised by the nav renderer).

---

## Tips

### Uniform locations

Cache `gl.getUniformLocation()` results during `init()` rather than looking them up every frame. Missed location lookups (e.g. a typo in the uniform name) return `null` silently; caching them and checking for `null` once at init is far easier to debug.

### Simulation resolution

Half-resolution (`ctx.width / 2`) is a good default for compute-heavy simulations. The display pass up-samples to full resolution automatically because it runs in the default framebuffer viewport. For smoother up-scaling consider using `gl.LINEAR` filter on the FBO texture, though the default `NEAREST` gives a crisper, more pixellated look that suits the anime aesthetic.

### Multiple compute steps per frame

For stiff equations, run multiple compute steps before the display pass:

```ts
for (let step = 0; step < 8; step++) {
  this.fbo.bindRead(gl, 0);
  this.fbo.bindWrite(gl);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  this.fbo.swap();
}
```

Each step doubles the simulation time consumed per visual frame, so balance step count against GPU frame budget.

### Sampling the shader library

Import noise, SDF, and anime-style utilities at the top of your `.glsl` file using the `#include` path that `vite-plugin-glsl` resolves:

```glsl
#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/sdf2d.glsl"
#include "../../shaders/lib/anime-style.glsl"
```

The path is relative to the importing `.glsl` file. See the existing plugin shaders for working examples.

### Cleanup

Always free every GL object you allocate. The engine calls `destroy()` before loading the next plugin. Leaked programs, textures, and framebuffers accumulate in the driver — browsers don't garbage-collect GL objects the way they do JS heap memory.

```ts
destroy(ctx: EngineContext) {
  const { gl } = ctx;
  gl.deleteProgram(this.myProgram);
  gl.deleteVertexArray(this.vao);
  this.fbo.destroy(gl);           // handles both textures and both FBOs
  this.sliders?.destroy();        // removes DOM slider overlay
}
```
