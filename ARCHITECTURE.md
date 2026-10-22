# Architecture

This document covers the engine internals, the plugin lifecycle, the demos' rendering patterns, the shader library, and how to author a new plugin.

---

## Engine

`src/engine/Engine.ts` owns the single WebGL2 context for the lifetime of the page. On construction it:

1. Creates a `<canvas>` and appends it to the container (`document.body` by default).
2. Requests a WebGL2 context with `alpha: false` and `antialias: false` — both disabled deliberately so the GPU skips alpha compositing and MSAA resolve, keeping each frame as cheap as possible.
3. Instantiates `InputManager` to translate raw pointer events into normalized `GestureEvent` objects.
4. Checks canvas CSS size × `devicePixelRatio` at the beginning of each frame, resizing before rendering and notifying the plugin through `resize()`.
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

The demos use fullscreen analytic shaders, ping-pong simulation, and explicit geometry or instancing. Paper Marbling additionally uses ordered inverse-map replay, described below.

### Pattern A — Single-Pass Fragment Shader

Used by: **Wobbly Cells**, **Sea Melt**, **Ripple Drop**, **Searchlights**, and as the display pass in multi-pass demos.

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

Used by: **Turing Patterns** for reaction-diffusion.

`src/plugin/PingPongFBO.ts` maintains two `RGBA16F` framebuffers (half-float, requiring `EXT_color_buffer_float`). Each frame:

```
bindRead(gl, unit)   ← previous state → texture unit N
bindWrite(gl)        ← current FBO as render target
drawArrays(...)      ← compute shader reads from N, writes new state
swap()               ← swap read/write roles for next frame
```

This avoids reading and writing the same texture in the same draw call (which is undefined in OpenGL). The cost is two textures per simulation at ~2× the memory, but at half resolution (typical) the budget is small.

**Resize**: `PingPongFBO.resize()` destroys and recreates both textures. Plugins that need to resize (e.g. on window resize) call this from their render loop when canvas dimensions change.

**Initial data**: The constructor accepts an `ArrayBufferView | null`. Passing `null` leaves textures zeroed (GPU default). Turing Patterns keeps a seed program for initialization, reseeding and clearing, always writing both ping-pong slots.

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

`src/engine/ParamSlider.ts` mounts labelled controls inside `#demo-controls`. The gallery owns the floating drawer and its visibility; plugins own their panel's lifetime. `src/style.css` styles every demo consistently. The canvas fills the viewport independently, so toggling controls does not trigger a simulation resize. Plugins call:

```ts
this.sliders = new ParamSlider();
this.sliders.addSlider({
  label: 'Ink wobble',
  min: 0, max: 1, value: 0.2, step: 0.05,
  onChange: (v) => { this.inkWobble = v; },
});
```

The slider DOM is removed in `destroy()` via `this.sliders.destroy()`, so it doesn't linger when switching demos.

`addSelect`, `addButtons`, `addSection` and `addNote` provide discrete choices, actions and structure. `setValue(label, value, notify = false)` synchronizes a slider and its readout when applying a recipe without recursively invoking its callback. Plugin-specific overlays outside the drawer should use the `demo-overlay` class so the gallery's hide action includes them.

Silver vine ornaments live in `src/ui/ornaments/` as self-contained SVGs. The noninteractive frame belongs to `#garden-ui`, outside the scrolling drawer. Faceted button layers leave the actual hit area and focus outline unclipped; range inputs keep their native interaction and update `--range-fill` with their value. Forced-color mode removes ornamental layers and restores system-color control borders.

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

Single fragment shader extending `FragmentShaderPlugin`. A smooth pointer lens warps the sampling position, while animated Voronoi centers remain inside their own tiles. The 5×5 candidate search covers both nearest centers throughout the supported wobble range, avoiding tile-boundary discontinuities from the previous displaced-center 3×3 search. `scripts/check-cells.mjs` checks this against a larger independent neighborhood and retains the old behavior as a negative control. Palette, density, seams, light and motion are adjustable; the integrated animation phase prevents speed changes from jumping in time.

### Turing Patterns (Gray-Scott)

The Gray-Scott model simulates two chemicals, **A** and **B**, reacting and diffusing across a 2D grid:

```
∂A/∂t = Dₐ·∇²A  −  A·B²  +  f·(1−A)
∂B/∂t = D_b·∇²B  +  A·B²  −  (f+k)·B
```

- `Dₐ`, `D_b` — diffusion rates of A and B (A diffuses faster)
- `f` — feed rate (how fast A is replenished from outside)
- `k` — kill rate (how fast B is removed)

The default preset (`f = 0.037`, `k = 0.060`) produces the original gold labyrinth. The recipe menu also offers coral, dappled and dividing spots. Feed/removal controls allow custom chemistry; the palette changes only the display.

The Laplacian `∇²` is approximated on the pixel grid with a 3×3 stencil weighted `[0.05, 0.2, 0.05 / 0.2, -1, 0.2 / 0.05, 0.2, 0.05]` (a discrete approximation that gives isotropic diffusion).

The display shader maps the B concentration to a colour gradient. Clicking seeds a patch of high-B concentration, which then interacts with the existing pattern.

The plant/erase brush follows a screen-space capsule so fast drags join continuously and brushes stay circular on portrait and landscape canvases. A tap is consumed once. While paused, drawing uses one compute pass with `u_dt = 0`, leaving chemistry outside the brush unchanged; Step advances one selected batch and remains paused. Seed layout changes, Clear and Reseed initialize both textures. Growth still uses iterations per rendered frame (12 by default).

### Ripple Drop (Hand-Inked Rain)

Modeled on the pond scenes in *Windaria* (1986). The key realization is that the animated ripple look is **not a wave simulation**: each ripple in the reference cels is a discrete hand-inked ellipse (or spiral) drawn *on* a flat painted pond, expanding and fading on its own — no interference, no reflections. An earlier version of this demo used a 2D wave-equation heightfield, which produced physically-correct interference soup instead of clean rings; it was replaced entirely.

The current implementation keeps a small CPU list of ripple entities — `(x, y, birthTime, kind + seed)` packed into a `vec4` — uploaded as a uniform array (`MAX_RIPPLES = 48`) and evaluated analytically in a single fragment pass. No ping-pong FBO, no resize state to preserve.

Three ripple kinds:

- **Rain drop** (`kind 0`): two small concentric rings. Spawned ambiently at a framerate-independent rate set by the Rain slider, and dotted along drag paths.
- **Tap** (`kind 1`): three larger staggered rings plus a brief impact dot at birth.
- **Spiral** (`kind 2`): one continuous three-turn spiral stroke, selected explicitly with the Mark control. Rings are the default.

Every ring is drawn with the ingredients that make it read as inked rather than computed:

- **Foreshortening**: positions are evaluated in a vertically squashed space (Perspective slider), with ripples higher in the frame rendered smaller and flatter for depth.
- **Ease-out expansion**: radius follows `1 − (1−u)²`, fast at birth and decelerating, with rings in a set staggered in time.
- **Hand wobble**: the radius and stroke width are modulated by simplex noise sampled *on the ring's unit circle* (`snoise(dir * k + seed)`), which varies around the ring without a seam at ±π.
- **Ink gaps**: an angular sine-plus-noise mask leaves 2–3 deliberate breaks per ring, so ellipses are incomplete the way a fast brush pass is.
- **Continuous motion**: expansion, current and rain use unquantized time. Ink noise drifts slowly and gaps remain anchored to the ring; Ink wobble controls its low-amplitude irregularity independently from motion.
- **Aging**: rings thin, gently fragment and fade while retaining their elliptical shape. A slight seed-directed current moves their centers.

The shader rejects pixels outside each ripple's largest possible footprint, then rejects pixels outside a conservative stroke band before evaluating ring noise. Clear pond empties the ripple list and stops ambient rain for a clean drawing surface.

The pond itself is flat gouache: a tonal gradient with soft `fbm` blotches, a sky-reflection patch, and a gentle edge vignette. When the Rain slider is up, thin falling streak dashes are composited at low alpha.

### Stone Break

A framed slab uses one coarse polygon partition. Each internal boundary is stored once, including its irregular contour, and is shared by the two adjacent fragments and the crack overlay. The visible seams and detached edges therefore come from the same geometry; there is no independent shatter map or display-only jitter.

Strikes reveal and extend nearby seams. Crack growth uses elapsed time; completion reveals the shared network before the pieces separate. The slab can be reassembled or regenerated. Fragment size, seam character, material and strike strength are artistic controls over this single model, rather than switches between incompatible fracture solvers.

This is a stylized geometric fracture model, not a continuum stress simulation. Geometry checks cover partition area, shared edges and triangulation across multiple seeds and aspect ratios. Browser checks cover the strike, break and reassembly cycle; visual inspection establishes whether the separation reads well.

### Searchlights

Searchlights replaces the illustrated lighthouse scene with an abstract optical chamber: one to three beams, drifting haze and simple blockers. It is a 2D light-transport study. The geometry that draws the circles and slats is also used for source-to-sample obstruction tests, so visible forms and their shadows agree.

A distance-based finite-aperture approximation softens the shadow edges. Haze, sparse dust and exposure rolloff give the beams structure; they do not constitute a 3D volumetric solver. Dragging aims the lights, and automatic sweeping can be restored. Controls expose beam count/width, sweep, haze, blocker layout, palette and playback.

### Paper Marbling (Ebru / Suminagashi)

Paint floats on a size bath. Each new drop pushes the paint already there outward into rings; pulling a stylus or comb through it drags the paint into hearts, chevrons, and feathers, and laying paper on the bath prints the result — the patterns on the inside covers of old books. The look depends on edges staying knife-sharp however much the paint is worked, which rules out grid advection (every resample blurs). Instead the bath is an **ordered list of exactly invertible ops**, and every pixel is traced backward through them — a third rendering pattern alongside A and B.

**Ops** live in an `RGBA32F` texture, 3 texels per op, 512 ops per row (sampled with `texelFetch` only, so no float render targets are needed):

- *Ink drop* (Jaffer & Lu, *Mathematical Marbling*, 2012): a drop of radius R at c moves existing paint p to c + (p−c)·√(1 + R²/|p−c|²) — area-preserving with a closed-form inverse. Drops land small and spread (radius eases out over ~0.5 s), so the push is animated. Clear drops (alpha 0) are suminagashi's surfactant drops.
- *Stylus / comb stroke*: a tine moving a→b slides paint along lines parallel to its motion. On a line at cross offset h the paint moves at κ(h)·sech²(ξ/α) of the rod's speed, ξ being its position relative to the rod and κ(h) a rounded cusp (pointed chevrons). This 1D flow integrates in closed form, G(ξ) = ξ + α s·atan(s·tanh(ξ/α)) with s = √(κ/(1−κ)), and a rod moving 0→L maps the paint's final relative position ξ₁ to its start ξ₀ = G⁻¹(G(ξ₁) + L), found by 4 monotone Newton steps. The map is a bijection for any L; the paint at the rod slips (κ < 1), so a long pass displaces the centreline by a finite 2α·s·atan(s) — Jaffer's tine-line displacement, derived rather than imposed — and splitting a straight stroke anywhere composes *exactly*. So a straight drag is a single op whose endpoint grows in place; a curved drag opens a new op only when the path leaves a 0.6 px chord tolerance. A comb is one op too: only the two tines nearest a pixel's line are evaluated, with the cross profile cut off before the next tine and a wake width that scales with the tine spacing (per-op falloff). When the pass runs straight across its tines (every user comb, every straight recipe pass) the two tines sweep the same lines in step, so they run as *one* flow with drag 1 − (1−κa)(1−κb) — still below 1, and still exactly split-invariant, which matters because any op landing mid-pull splits the comb.
- *Swirl* (Jaffer's vortex): a rotation by an angle that falls off with radius — exactly invertible because the radius is unchanged, area-preserving, and cusp-free. Suminagashi's "breath" is a few overlapping swirls of alternating direction.

Ops that keep moving after they are appended must still reach paint that lands later. An op appended while a stroke is open (a drop tapped mid-pass) closes that stroke; its remaining motion reopens as a newer op. A drop landing while a swirl is turning splits the swirl: turns about one centre add, so the old op keeps the share of the turn already done and a continuation op after the drop carries the rest.

**Backward replay.** `trace.glsl` walks the ops newest→oldest applying inverse maps; the first drop whose disk contains the traced point is the colour. The 2×2 Jacobian ∂p/∂q is carried along the trace (every op has an analytic Jacobian), which gives screen-space distances for free. Every edge in a marbled image is some newer drop's boundary, so a pixel just outside a newer drop blends toward it over a 1 px ramp — analytic AA. The same Jacobian fades each drop's pigment mottle and slightly denser rim (shaded in the drop's birth frame, so they comb with the paint) before they would alias, and is renormalised so crossed comb passes can't overflow it.

**Progressive exact bake.** Replaying every op for every pixel each frame is too slow, so an *exact* bake of all settled ops (everything older than the first still-spreading drop, still-turning swirl, or still-growing stroke) is rebuilt in the background a scissored strip at a time, then swapped in. The live pass replays only newer ops and samples the bake at exactly the op index it represents; bake and screen share a texel grid (the bake adds a whole-texel margin), so untouched pixels read it at texel centres, and a traced point that leaves the margin keeps tracing older ops analytically. Because the bake is amortised, it can afford a rotated-grid **supersample** wherever the first trace saw sub-pixel detail (strong compression, or both edges of a thin vein inside one pixel) — that is what keeps combed hairlines continuous instead of dotted. The paint layer is repainted when a bake lands and once after the last animation settles, so the screen always ends on the exact state.

The per-frame strip is budgeted against the display's refresh interval (the shortest recent rAF delta, which is vsync-aligned) using uncapped frame times (the engine caps `dt`): it backs off on missed frames and remembers the level that missed, grows only when the last strip was budget-limited, never drops below the live-pass work the bake will remove, and every bake finishes within 120 frames. Past 1536 baked ops the completed bake becomes a flattened base layer and the absorbed ops are dropped — the only place paint is ever resampled. Since bath units follow the canvas height, the bake destined to become that layer is built wide enough for either orientation, so rotating a phone later doesn't expose bare size where discarded ops used to reach. A resize keeps the completed bake (each bake target carries its bath-space rect) and rebuilds at the new size once the size has settled; a held tool is lifted and set down again under the finger. The live trace is cached: it only re-runs when ops change, and when the only change is the open stylus op it is scissored to that op's support box.

**Patterns.** `recipes.ts` scripts the classics as timelines played through the same machinery, so each comb pass is visible as it moves: Bullseyes (alternating drops on the same spots — pull a stylus through one for the ebru tulip/heart; spot centres are tracked through later drops so rings stay concentric), Stone (battal), Gel-gel, Chevron, Nonpareil, Bouquet (all over a full-cover light ground), and Suminagashi (ink alternating with clear drops on six spots, then breath swirls).

**Print** animates a sheet laid across the bath, lifts and flips it, and shows the print: the bath mirrored (the paper goes on face-down) at the bath's aspect, with paper grain, fibres, and the odd air-bubble fleck.

Controls: Tool (stylus, straight-locked comb with axis snapping, sprinkle drops), Pattern, Palette, Drop Size, Drag (κ), Rod Size, Comb Spacing; Spatter (merges into a playing pattern), Print, Clear.

### Bubble Physics

Underwater air bubbles use a CPU simulation and instanced GPU quads. Position, velocity and contact response advance on a fixed timestep, with interpolation for drawing. World units follow canvas height instead of backing pixels, so the same settings retain their scale on high-DPI displays.

Bubbles have radius-dependent rise and drag, share one spatial flow field, and deform in response to motion and contact. The pointer disturbs that flow. Shading emphasizes a thin meniscus, broad crescent reflections and a refracted interior, rather than soap-film iridescence or separate white highlight dots.

This is a stylized motion model, not a resolved two-phase fluid simulation. Equal-time checks across different frame schedules verify timestep consistency; contact and shape bounds are tested separately. Controls tune flow, rise, bubble size, release rate and playback.

---

## Adding a New Plugin

See [src/plugins/ADDING-A-PLUGIN.md](./src/plugins/ADDING-A-PLUGIN.md) for a step-by-step walkthrough with code templates.
