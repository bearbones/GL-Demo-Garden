# Architecture Review — July 2026

A full read-through of the engine, all seven plugins, shaders, docs, and deployment
config. The verdict up front: **the core architecture is sound and appropriately
sized** — single engine owning the WebGL2 context, a four-method `Plugin` interface,
the attribute-less fullscreen triangle, and `PingPongFBO` as the one shared compute
abstraction. The problems are at the edges: input handling narrower than the demos
need, no resilience to mobile realities (context loss, viewport churn, DPR cost),
DOM chrome that doesn't work on phones, and docs that have drifted behind the code.

Each item below is independently implementable. Checkboxes are for tracking as
pieces land.

---

## 1. Bugs and intent-vs-behavior gaps

Ordered by user impact.

### 1.1 Hover interaction doesn't exist
- [ ] Fix

`InputManager.onPointerMove` returns early unless a pointer is down
(`src/engine/InputManager.ts:42`), so `u_mouse` in `FragmentShaderPlugin` only
updates mid-drag. The README says Wobbly Cells' "mouse moves the warp field" —
on desktop, moving the mouse does nothing until you click-drag.

**Fix**: add a `move` (hover) gesture type to `GestureEvent` and emit it from
`pointermove` when no pointer is down. `FragmentShaderPlugin.onGesture` picks it
up for free.

### 1.2 Any resize destroys simulation state
- [ ] Fix Turing Patterns
- [ ] Fix Ripple Drop

`TuringPatternsPlugin.resize()` reseeds from scratch
(`src/plugins/turing-patterns/index.ts:87-93`); `RippleDropPlugin.resize()`
recreates zeroed FBOs. On mobile this is brutal: the URL bar collapsing/expanding
during a scroll, or a rotation, fires resize — a pattern you spent a minute
growing vanishes.

**Fix**: on resize, blit the old texture into the new one (a one-draw copy pass
through the fullscreen triangle) instead of reseeding/zeroing.

### 1.3 No WebGL context-loss handling
- [ ] Fix

Mobile browsers reclaim GL contexts aggressively (backgrounding, memory
pressure). Today that's a permanent black screen until manual reload.

**Fix**: in `Engine`, listen for `webglcontextlost` (call `preventDefault`) and
`webglcontextrestored`; on restore, re-run `plugin.init()` with a fresh context
snapshot. Probably the single highest-impact robustness fix for mobile.

### 1.4 Multi-touch corrupts drags
- [ ] Fix

`InputManager` ignores `pointerId`, so a second finger interleaves its moves with
the first — `lastPos` jumps between fingers and `delta` becomes garbage.

**Fix**: track the primary pointer's ID; ignore other pointers (until pinch
support exists — see §2.1).

### 1.5 Bloom blur darkens itself ~80%
- [ ] Fix

The kernel in `src/plugins/swallowtail-butterfly/blur.glsl` sums to ~0.80, not
1.0, and the butterfly runs 7 passes through it (1 downsample + 3×H/V), so only
~0.80⁷ ≈ 21% of the glow energy survives. The "Glow Intensity" slider is silently
compensating for an un-normalized kernel.

**Fix**: normalize the weights (divide by their sum, counting side taps twice).
Re-tune the default `glowIntensity` afterward.

### 1.6 Documentation drift
- [ ] Sync README and ARCHITECTURE.md with the code

`ARCHITECTURE.md` and the README still document **Boat Wake** (deleted), don't
mention **Sea Melt** or **Glass Water**, describe the Turing preset as coral
(`f=0.0545`) while the code ships labyrinthine (`f=0.037`,
`src/plugins/turing-patterns/index.ts:20-21`), and list bubble constants that no
longer match (buoyancy 180 vs 340, max 600 vs 900).
`src/plugins/swallowtail-butterfly/composite.glsl:9` still says "bird shape"
from the deleted laser-bird demo. For a repo where docs are a first-class
feature — and where AI sessions read them as ground truth — this drift will
actively mislead future work.

### 1.7 Split-brain deployment story
- [ ] Decide and document

`wrangler.toml`, `public/_headers`, and the README describe Cloudflare Pages,
but `.github/workflows/deploy.yml` deploys to **GitHub Pages**, where `_headers`
does nothing. Pick one as canonical (or document that both exist and why).

---

## 2. Architectural improvements

### 2.1 Widen the input vocabulary; stop plugins bypassing InputManager
- [ ] Add `move` and `hold` gestures (+ pointer-down state)
- [ ] Migrate bubble-physics onto InputManager

The clearest smell in the codebase: `BubblePhysicsPlugin` installs its own
pointer listeners (`src/plugins/bubble-physics/index.ts:132-148`) because it
needs "hold at position", which tap/drag-start/move/end can't express. When a
plugin routes around the abstraction, the abstraction is too narrow. With `move`
+ `hold`, bubble-physics deletes ~40 lines and all input lives in one place.
Pinch is a natural later addition (e.g. wing spread on the butterfly).

### 2.2 Unify uniform handling — there are currently three patterns
- [ ] Extract shared uniform-caching helper
- [ ] Extract shared single-FBO helper

Ripple Drop caches locations via a private `getUniforms` helper (the good
pattern, per `ADDING-A-PLUGIN.md`'s own advice), Swallowtail duplicates that
exact helper, and Turing / Sea Melt / Glass Water call `gl.getUniformLocation`
every frame — which the contributor docs explicitly say not to do. Extract a
tiny helper into `src/engine/gl-utils.ts` and use it everywhere. Same for
Swallowtail's private `createFBO` — it belongs next to `PingPongFBO` as a shared
single-FBO utility.

### 2.3 Plugin registry metadata
- [ ] Registry entries become `{ id, title, description, interactionHint, create }`

`plugin.name` is currently dead — the nav derives labels from hash keys via
string munging in `src/main.ts`. Metadata buys correct display names, an "about
this demo" line, and — important on mobile where nothing is discoverable by
hover — a brief interaction hint ("tap to seed the reaction") on first load.

### 2.4 Declarative params instead of imperative slider wiring
- [ ] `params: ParamDescriptor[]` on plugins; engine owns the panel

Every plugin with sliders repeats the same boilerplate: field + `addSlider` +
`onChange` closure + `destroy`. A declarative descriptor (a) cuts each plugin by
~30 lines, (b) enables URL-serialized params — shareable tuned states, great for
a demo garden, and (c) gives one place to fix the mobile panel UX (§3.2) rather
than n places.

### 2.5 Cap DPR / add a resolution scale
- [ ] Cap at 2 (or expose a quality slider)

`Engine.checkResize` uses raw `devicePixelRatio` (`src/engine/Engine.ts:96`).
Glass Water does ~13 `snoise` calls per pixel; on a 3× phone that's 2.3× the
fragment work of a 2× cap for imperceptible sharpness gain in these soft,
painterly effects. `Math.min(devicePixelRatio, 2)` is the cheap fix; a global
render-scale (0.5–1.0) is the nicer one.

### 2.6 Spatial hash for bubble physics
- [ ] Replace O(n²) neighbour pass

`updatePhysics` does ~400k pair checks per frame at the 900-bubble cap
(`src/plugins/bubble-physics/index.ts:284-328`). Fine on desktop, likely the
frame budget on a mid-range phone. A uniform grid (cell ≈ max interaction
radius, ~40 lines) makes it O(n·k). Do this **before** the deferred metaball
renderer described in ARCHITECTURE.md, since that adds GPU cost on top.

### 2.7 Smaller notes
- [ ] Ripple zero-snap: `hNext *= step(0.0001, abs(hNext))`
      (`src/plugins/ripple-drop/simulate.glsl:38`) truncates subtle late-stage
      ripples — waves visibly "switch off". A smoothstep fade (or just damping)
      reads better.
- [ ] `WobbyCellsPlugin` typo → `WobblyCellsPlugin`.
- [ ] `index.html` error trap misses `unhandledrejection`; no friendly message
      when `EXT_color_buffer_float` is missing (`PingPongFBO` just throws).

---

## 3. Mobile UI

The weakest area — all in the DOM chrome, not the GL. (The engine-side mobile
work already done is good: tile-GPU clear/flush, `touch-action:none`,
`setPointerCapture`, the dt cap.)

### 3.1 Nav overflows and is untouchable
- [ ] Fix

Seven links in a `nowrap` flex row at 14px (`src/main.ts:33-46`) — on a
390px-wide phone, everything after "swallowtail butterfly" is clipped with no
scroll. Links are small tap targets with hover-only affordances, and there's no
indication of which demo is active (on any platform).

**Minimum fix**: `overflow-x:auto`, bigger padding, active-item highlight.
**Better**: compact chip row or bottom sheet.

### 3.2 Slider panel eats the screen
- [ ] Fix

Fixed bottom-right, `min-width:200px`, up to 5 rows
(`src/engine/ParamSlider.ts:14-31`) — covers a third of a phone canvas, exactly
where a right-handed thumb drags. Range inputs have a 4px track, nearly
impossible to grab on touch.

**Fix**: collapsible panel (a "⚙ tune" toggle, collapsed by default on narrow
viewports); ≥24px hit areas on the inputs.

### 3.3 Safe areas and viewport
- [ ] Add `viewport-fit=cover` + `env(safe-area-inset-*)` padding on overlays
- [ ] Use `100dvh` (with §1.2 making the remaining resizes lossless)

The nav currently sits under the notch/dynamic island; the slider panel can
collide with the home indicator. `height:100%` plus mobile URL-bar behavior
causes resize churn, which today destroys sim state.

---

## 4. Suggested implementation order

1. **Resilience** (§1.3 context loss, §1.2 state-preserving resize) — turns
   "broken on phones" into "works on phones".
2. **Mobile chrome** (§3.1 nav, §3.2 panel, §3.3 safe areas, §2.5 DPR cap).
3. **Input system** (§1.1 hover, §1.4 pointerId, §2.1 hold + bubble migration).
4. **Docs sync** (§1.6, §1.7).
5. **Polish** (§1.5 blur normalization, §2.2 uniform caching, §2.3 metadata,
   §2.4 declarative params, §2.6 spatial hash, §2.7 small notes).

No restructuring required — the plugin model holds up well and should stay
exactly as it is.
