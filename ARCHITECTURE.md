# Architecture

This document covers the engine internals, the plugin lifecycle, the two rendering patterns used by the demos, the shader library, and how to author a new plugin.

---

## Engine

`src/engine/Engine.ts` owns the single WebGL2 context for the lifetime of the page. On construction it:

1. Creates a `<canvas>` and appends it to the container (`document.body` by default).
2. Requests a WebGL2 context with `alpha: false` and `antialias: false` — both disabled deliberately so the GPU skips alpha compositing and MSAA resolve, keeping each frame as cheap as possible.
3. Instantiates `InputManager` to translate raw pointer events into normalized `GestureEvent` objects.
4. Adds a `resize` listener that adjusts canvas physical pixels to match CSS pixels × `devicePixelRatio`, then calls `gl.viewport`.
5. Kicks off the `requestAnimationFrame` loop.

### EngineContext

Every plugin method receives an `EngineContext` snapshot built fresh each frame:

```ts
interface EngineContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  width: number;   // Physical pixels (CSS pixels × DPR)
  height: number;
  time: number;    // Seconds since this plugin was loaded
  dt: number;      // Seconds since the previous frame
}
```

`time` resets to zero on each `loadPlugin()` call, so shaders always start from a known state regardless of how long the page has been open.

### Plugin Lifecycle

```
engine.loadPlugin(plugin)
  └─ old plugin?.destroy(ctx)     ← GL resources freed, DOM cleaned up
  └─ plugin.init(ctx)             ← Allocate programs, FBOs, sliders
  └─ startTime reset

RAF loop
  └─ plugin.render(ctx)           ← Called every frame, dt in seconds

pointer events
  └─ plugin.onGesture?(ctx, event) ← Optional; only implemented by interactive demos

navigating away / page unload
  └─ engine.destroy()
       └─ plugin.destroy(ctx)
```

The `Plugin` interface is deliberately minimal:

```ts
interface Plugin {
  readonly name: string;
  init(ctx: EngineContext): void;
  render(ctx: EngineContext): void;
  destroy(ctx: EngineContext): void;
  onGesture?(ctx: EngineContext, event: GestureEvent): void;
}
```

`onGesture` is optional — passive demos that don't need interaction simply omit it.

---

## Rendering Patterns

Two patterns cover all current demos.

### Pattern A — Single-Pass Fragment Shader

Used by: **Wobbly Cells**, **Sea Melt**, **Glass Water**, **Ripple Drop**, and as the display pass in multi-pass demos.

Base class: `src/plugin/FragmentShaderPlugin.ts`

```
init:
  compile vertex + fragment program
  create empty VAO (no vertex data needed — see quad trick below)

render (each frame):
  bind default framebuffer (screen)
  set uniforms: u_time, u_resolution, u_mouse
  call subclass setUniforms() hook for extra uniforms
  drawArrays(TRIANGLES, 0, 3)   ← one fullscreen triangle
```

The vertex shader (`src/shaders/fullscreen-quad.vert`) generates clip-space positions from `gl_VertexID` with no VBO at all:

```glsl
#version 300 es
out vec2 v_uv;
void main() {
  v_uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}
```

Vertices 0/1/2 produce UVs (0,0), (2,0), (0,2) — a single triangle that over-covers the clip square. The fragment shader is only invoked for pixels inside the NDC square, so no pixel is touched twice.

### Pattern B — Ping-Pong Compute

Used by: **Turing Patterns**, **Laser Bird** (for bloom blur), **Stone Break** (crack propagation).

`src/plugin/PingPongFBO.ts` maintains two `RGBA16F` framebuffers (half-float, requiring `EXT_color_buffer_float`). Each frame:

```
bindRead(gl, unit)   ← previous state → texture unit N
bindWrite(gl)        ← current FBO as render target
drawArrays(...)      ← compute shader reads from N, writes new state
swap()               ← swap read/write roles for next frame
```

This avoids reading and writing the same texture in the same draw call (which is undefined in OpenGL). The cost is two textures per simulation at ~2× the memory, but at half resolution (typical) the budget is small.

**Resize**: `PingPongFBO.resize()` destroys and recreates both textures. Plugins that need to resize (e.g. on window resize) call this from their render loop when canvas dimensions change.

**Initial data**: The constructor accepts an `ArrayBufferView | null`. Passing `null` leaves textures zeroed (GPU default). Turing Patterns seeds initial state via a temporary program rendered into both ping-pong slots before the main loop starts.

#### Multi-Step Compute

Some simulations are numerically stiff — they need many small steps per visual frame to stay stable. Turing Patterns runs **12 Gray-Scott steps per frame**. The inner loop just calls `bindRead → draw → swap` repeatedly:

```ts
for (let i = 0; i < stepsPerFrame; i++) {
  this.pingPong.bindRead(gl, 0);
  this.pingPong.bindWrite(gl);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  this.pingPong.swap();
}
```

---

## Input System

`src/engine/InputManager.ts` absorbs raw `pointerdown/pointermove/pointerup/pointercancel` events and emits four high-level gesture types:

| Type | Condition |
|------|-----------|
| `tap` | Pointer up within 5 px and 300 ms of down |
| `drag-start` | First move beyond 5 px threshold |
| `drag-move` | Every move event while dragging |
| `drag-end` | Pointer up after a drag |

All positions are normalized to `[0, 1]` in CSS-pixel space (origin top-left). Delta in `drag-move` is the change since the previous `drag-move` event, also normalized.

`setPointerCapture` ensures `pointermove` keeps firing even if the pointer leaves the canvas during a drag.

---

## Parameter Sliders

`src/engine/ParamSlider.ts` creates a fixed-position DOM overlay with `<input type="range">` sliders. Plugins that expose tuneable parameters (e.g. Ripple Drop's damping, wave speed, stroke width) call:

```ts
this.sliders = new ParamSlider();
this.sliders.addSlider({
  label: 'Damping',
  min: 0.98, max: 1.0, value: 0.995, step: 0.001,
  onChange: (v) => { this.damping = v; },
});
```

The slider DOM is removed in `destroy()` via `this.sliders.destroy()`, so it doesn't linger when switching demos.

---

## Shader Library

Three utility files live in `src/shaders/lib/` and are imported by plugins that need them via `vite-plugin-glsl`'s `#include` or direct import.

### `noise.glsl`

| Function | Description |
|----------|-------------|
| `snoise(vec2)` | 2D Simplex noise, returns `[-1, 1]`. Ashima Arts / Ian McEwan implementation (MIT). |
| `fbm(vec2, octaves, lacunarity, gain)` | General fractional Brownian motion accumulator (max 8 octaves). |
| `fbm3(vec2)` | Convenience: 3-octave fBm, lacunarity 2, gain 0.5. |
| `fbm5(vec2)` | Convenience: 5-octave fBm, lacunarity 2, gain 0.5. |
| `hash21(vec2) → float` | Fast hash, output `[0, 1)`. |
| `hash22(vec2) → vec2` | 2-output hash, both components `[0, 1)`. |

Simplex noise has O(n) complexity in the number of dimensions (versus O(2ⁿ) for Perlin), making it practical in fragment shaders where `snoise` is often called multiple times per pixel.

### `sdf2d.glsl`

Signed distance field primitives. All return a float where negative = inside, zero = on boundary, positive = outside.

| Function | Shape |
|----------|-------|
| `sdCircle(p, r)` | Circle of radius `r` centred at origin |
| `sdLine(p, a, b)` | Capsule / line segment between `a` and `b` |
| `sdArc(p, r, aperture)` | Arc of radius `r`, total angle `aperture` (radians) |
| `sdBezier(p, A, B, C)` | Quadratic bezier A→C with control B; returns `vec2(distance, t)` so strokes can taper along the curve |
| `opSmoothUnion(d1, d2, k)` | Smooth boolean union with blend radius `k` |
| `opSmoothSubtraction(d1, d2, k)` | Smooth boolean subtraction |

### `anime-style.glsl`

Higher-level utilities that combine SDF geometry with noise to produce hand-drawn aesthetics.

| Function | Purpose |
|----------|---------|
| `inkStroke(d, width, breakFreq, seed)` | Renders an SDF contour as an ink stroke with noise-driven thickness variation and periodic gaps (`breakFreq` controls gap density) |
| `softGlow(d, intensity, falloff)` | Lorentzian glow falloff: `intensity / (1 + (d·falloff)²)`. Softer than exponential; mimics airbrushed glow cels. |
| `expGlow(d, intensity, falloff)` | Exponential glow: `intensity · exp(-|d|·falloff)`. Tighter core, used for laser / magic effects. |
| `posterize(color, levels)` | Quantizes each channel to `levels` discrete steps, simulating the limited palette of hand-painted gouache cels. |

`inkStroke` takes a heightfield or SDF value as a pseudo-distance and produces a stroke that reads as hand-drawn rather than computer-generated; `posterize` gives the single-pass water demos their flattened gouache steps.

---

## Demo Deep Dives

### Wobbly Cells

Single fragment shader extending `FragmentShaderPlugin`. Uses domain-warped Voronoi to generate a cell structure that breathes and shifts over time. `u_mouse` skews the warp field, making cells lean away from the cursor.

### Turing Patterns (Gray-Scott)

The Gray-Scott model simulates two chemicals, **A** and **B**, reacting and diffusing across a 2D grid:

```
∂A/∂t = Dₐ·∇²A  −  A·B²  +  f·(1−A)
∂B/∂t = D_b·∇²B  +  A·B²  −  (f+k)·B
```

- `Dₐ`, `D_b` — diffusion rates of A and B (A diffuses faster)
- `f` — feed rate (how fast A is replenished from outside)
- `k` — kill rate (how fast B is removed)

The default preset (`f = 0.0545`, `k = 0.062`) produces coral-growth-like branching patterns. Different `(f, k)` values produce radically different morphologies — spots, stripes, spirals, worm-like labyrinths.

The Laplacian `∇²` is approximated on the pixel grid with a 3×3 stencil weighted `[0.05, 0.2, 0.05 / 0.2, -1, 0.2 / 0.05, 0.2, 0.05]` (a discrete approximation that gives isotropic diffusion).

The display shader maps the B concentration to a colour gradient. Clicking seeds a patch of high-B concentration, which then interacts with the existing pattern.

### Ripple Drop (Hand-Inked Rain)

Modeled on the pond scenes in *Windaria* (1986). The key realization is that the animated ripple look is **not a wave simulation**: each ripple in the reference cels is a discrete hand-inked ellipse (or spiral) drawn *on* a flat painted pond, expanding and fading on its own — no interference, no reflections. An earlier version of this demo used a 2D wave-equation heightfield, which produced physically-correct interference soup instead of clean rings; it was replaced entirely.

The current implementation keeps a small CPU list of ripple entities — `(x, y, birthTime, kind + seed)` packed into a `vec4` — uploaded as a uniform array (`MAX_RIPPLES = 48`) and evaluated analytically in a single fragment pass. No ping-pong FBO, no resize state to preserve.

Three ripple kinds:

- **Rain drop** (`kind 0`): two small concentric rings. Spawned ambiently at a framerate-independent rate set by the Rain slider, and dotted along drag paths.
- **Tap** (`kind 1`): three larger staggered rings plus a brief impact dot at birth.
- **Spiral** (`kind 2`): one continuous three-turn spiral stroke — the classic anime shorthand for dense concentric ripples. Taps have a 30% chance to spawn one.

Every ring is drawn with the ingredients that make it read as inked rather than computed:

- **Foreshortening**: positions are evaluated in a vertically squashed space (Perspective slider), with ripples higher in the frame rendered smaller and flatter for depth.
- **Ease-out expansion**: radius follows `1 − (1−u)²`, fast at birth and decelerating, with rings in a set staggered in time.
- **Hand wobble**: the radius and stroke width are modulated by simplex noise sampled *on the ring's unit circle* (`snoise(dir * k + seed)`), which varies around the ring without a seam at ±π.
- **Ink gaps**: an angular sine-plus-noise mask leaves 2–3 deliberate breaks per ring, so ellipses are incomplete the way a fast brush pass is.
- **Line boil**: each ripple advances on a quantized redraw clock (Boil Rate slider, default 8 Hz, phase-offset per ripple). Every tick re-seeds the wobble, stroke-width, and gap noise — the line is "redrawn" like cels animated on threes, rather than one frozen shape dilating outward.
- **Aging**: wobble amplitude and frequency grow with ring age while stroke width thins and gaps widen, so young rings are clean ellipses and old rings squiggle apart before fading. A slight seed-directed drift pulls rings off-center as they expand, like a pond current.

The pond itself is flat gouache: a tonal gradient with soft `fbm` blotches, a sky-reflection patch, and a gentle edge vignette. When the Rain slider is up, thin falling streak dashes are composited at low alpha.

### Laser Bird

Modeled on the light-being apparition in *Windaria* (1986): a creature of pure light — white-hot core, hot-pink body glow, deep red-magenta fringe — rendered with the airbrushed "transmitted light" look of backlit cels. No outlines, no interior detail; the glow is the drawing.

Three render passes:

1. **Scene pass** → FBO A: the creature as an SDF, shaded as pure light. The bird is built from tapered-thickness quadratic beziers (`sdBezier`, which returns the curve parameter of the closest point so ribbon strokes can taper to the wing tip): two up-swept crescent wings with a carved underside, a slim body with head nub, and a thin swaying beam-tail trailing to the source. A **Form slider morphs the SDF continuously between the bird and a swallowtail butterfly** (the original demo's shape, preserved) — SDFs interpolate cleanly, so mid-morph states stay coherent light-shapes. The interior white ramp is depth-normalized per form so the thick-winged butterfly doesn't white out. Edges waver and brightness flickers on a quantized boil clock (8 Hz), like hand-airbrushed cels repainted frame to frame.
2. **Blur pass** → FBO B: multi-pass separable Gaussian blur at half resolution, with the kernel normalized to unity (the raw 15-tap weights sum to ~0.803; unnormalized, each pass dims the bloom ~20% and seven passes lose ~80% of the glow energy).
3. **Composite pass** → screen: starfield sky + scene + bloom, with the wide fringe shifted toward warm red to mimic 80s multi-exposure color temperature drift. Chunky glowing **petals** (rotated squashed-ellipse blobs, like the rose petals swirling in the reference) orbit and rise around the creature, tumbling as they drift and flickering on the boil clock.

### Stone Break (Fracture Propagation)

A slab of procedurally generated rock fills the canvas. Tapping strikes it: cracks spiderweb out from the strike point, repeated taps deepen and extend the network, and once the cracks run deep and reach most of the way across the screen the slab shatters along them and the pieces fall away, revealing a fresh slab.

**Rock slabs** are baked once per rock (never per frame) from a seeded shader into an RGBA8 texture. Three pattern families — speckled igneous, banded sedimentary, veined crystalline — each with three palettes, give nine mineral looks chosen by hashing the seed. Two slabs exist at any time: the current one and the one revealed on shatter.

**Crack propagation** is a ping-pong compute field at half resolution (R = crack depth, G = live fracture energy). A tap splats energy plus a few noise-broken radial spokes of immediate damage. Each compute step (6/frame), every pixel takes the strongest energy in its 8-neighbourhood minus a travel cost derived from two F2−F1 cellular (Voronoi-edge) distance fields, whose zero sets are straight segments meeting at sharp junctions:

- **Primary faults**: huge cells, so the borders form long lines reaching across the screen. The lookup space is domain-warped by a random offset field with *linear* (deliberately unsmoothed) bilinear interpolation on a rotated grid: the warp is continuous — so the fault line never tears or shears sideways — but its gradient jumps at every grid cell, kinking the line's heading every ~50 px. That is the jittery-angular geometry of a real sidewalk crack. Depth here is uncapped; these are the cracks that deepen, widen, ember, and finally split the slab.
- **Web**: a fine field whose valleys carry a cost floor, so tap energy only floods it for a short radius — thin spiderweb crackle around the strike point. Web depth saturates below every threshold that matters (deep-crack analysis, ember, light shafts, conduction), so repeated strikes can't chew the web into a hole.

Damage is only recorded along fault valleys — solid rock conducts energy near the impact but doesn't scar, keeping cracks as lines instead of blobs. Strike-local damage (crater + spokes) saturates at a fixed cap for the same reason.

Repeat taps grow the long cracks rather than the crackle, via two conduction rules keyed to a depth only primary cracks and spokes exceed: deep cracks cost ~10× less to traverse, and — the important one — they nearly eliminate the per-step energy decay (0.995 vs 0.972 in rock). Rock decay caps how far one tap can grow a fresh crack, while conduits deliver the next tap's energy to the far tips almost intact, so every strike on a cracked slab visibly lengthens and branches the existing network. If a strike lands far from any fault and progress stalls, tap energy escalates ("working the stone") until it couples.

**Break detection** runs every 10 frames while energy is live: a 64×40 analysis pass supersamples the crack field (6×6 per cell — cracks are thin, point sampling would miss them) and is read back with `readPixels`. The CPU computes deep-crack coverage, max depth, and the bounding-box span of the cracked region. The slab breaks only when the network spans ~85% of the screen in some axis *and* enough of it runs deep; the min of those scores is `breakProgress`.

**Near the break point** (`breakProgress` > 0.6), each tap fires a half-second burst of light shafts: the display shader marches from every pixel toward the strike, accumulating emission from deep cracks along the ray — god rays anchored to the actual crack shapes — while camera shake (a decaying UV offset of summed sines) scales up with `breakProgress`. Crossing the threshold fires one violent burst, then after a 0.4 s beat the slab shatters.

**Shatter** splits the screen into 12 jittered-Voronoi pieces. Seeds are nudged toward the *least-cracked* analysis cells nearby, which pulls Voronoi boundaries onto the crack seams (boundaries fall midway between seeds). Each piece is a rigid body on the CPU — radial impulse from the strike, gravity, spin — and the display shader inverse-transforms each pixel per piece to decide membership and sample the old slab (crack scars included), revealing the fresh slab behind. After the fall the textures swap, a new "next" slab is baked, and the crack field is cleared.

### Boat Wake (Kelvin Wake + Foam Advection)

A Kelvin wake is bounded by a **19.47° half-angle** regardless of boat speed (a consequence of deep-water wave dispersion). The simulation uses this angle to define an emission mask: foam is injected into the ping-pong FBO at positions within the Kelvin envelope behind the boat.

The foam field is advected (moved) and diffused each frame using a simple advection-diffusion step:

```glsl
vec2 velocity = wakeVelocityField(uv);
float prev = texture(u_foam, uv - velocity * dt).r;
float diffused = blur5(u_foam, uv);  // 5-tap separable
float next = mix(prev, diffused, 0.3) * decay;
```

The display shader reads foam density, then applies `inkStroke()` on the gradient and `posterize()` on the foam body to achieve the ukiyo-e woodblock aesthetic — bold flat-colour wave areas separated by dark ink outlines.

### Bubble Physics

CPU particle simulation with instanced GPU rendering. Up to 600 bubbles rise from the bottom under a force-accumulator model:

- **Buoyancy** (180 px/s²) is the dominant upward force.
- **Linear drag** (`F = -1.2·v`) gives a terminal rise velocity around 150 px/s.
- **Wobble**: per-bubble phased sinusoid adds lateral scatter.
- **Cohesion / separation**: O(n²) neighbour pass (early-out by squared distance) applies soft attraction in the near band and stiff separation on overlap, plus relative-velocity damping on contact so knocks don't fling clusters apart.
- **Cursor circle** (tap-and-hold): an adhesion force (110 px/s²) attracts bubbles toward the surface within 12 px, and a stiff interior wall (2000 px/s²) keeps them outside. Because adhesion < buoyancy, bubbles only linger where adhesion aligns with buoyancy — at the bottom pole. On the sides and top, buoyancy wins and they slip past. A rising bubble striking clingers transfers momentum via the separation impulse; cohesion damping resettles the cluster.

Rendering is a single instanced draw of per-bubble quads; the fragment shader draws each bubble as an independent disc with rim light and two specular highlights.

#### Deferred: foam-style flattened contact edges

The current renderer treats each bubble independently, so touching bubbles show two circular boundaries rather than a shared flattened contact line. Adding a soap-foam look requires cross-bubble awareness that a per-instance fragment shader cannot provide in one pass. A future session should implement a two-pass metaball composite:

1. **Density pass**: render each bubble (and the cursor circle) as a radial falloff into an offscreen `RGBA16F` FBO at canvas resolution, using additive blending. The R channel accumulates density.
2. **Shade pass**: a fullscreen quad samples the density texture and shades pixels where `density > threshold`, using `smoothstep(threshold, threshold + edgeWidth, density)` for antialiased edges. A surface normal derived from `dFdx`/`dFdy` of density drives rim light and specular. Where two bubbles overlap, summed densities cross the threshold between their centres, producing the flattened shared edge; isolated bubbles retain their round silhouette.

Requirements: FBO must be recreated on resize, must match DPR-scaled canvas dimensions. Keep `background.glsl` unchanged and composite bubbles on top. Estimated scope: new `metaball.frag` and `composite.frag`, ~120–180 LOC in the plugin including FBO lifecycle in `init()`/`destroy()`.

---

## Adding a New Plugin

See [src/plugins/ADDING-A-PLUGIN.md](./src/plugins/ADDING-A-PLUGIN.md) for a step-by-step walkthrough with code templates.
