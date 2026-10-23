# GL Demo Garden

A WebGL2 interactive shader effects gallery with an 80s anime aesthetic. Each demo is a self-contained GPU-accelerated effect that you can interact with in real time.

## Demos

| Demo | Effect Type | Interaction |
|------|-------------|-------------|
| **Wobbly Cells** | Animated Voronoi mosaic | Gather/spread lens, four palettes, density, seams, light, drift, freeze and reshuffle |
| **Turing Patterns** | Gray-Scott reaction-diffusion | Plant/erase brushes, chemistry recipes, palettes, seed layouts, pause, step, reseed and clear |
| **Bubble Physics** | Deformable underwater bubbles | Stir the water; tune flow, rise, size and release rate |
| **Ripple Drop** | Hand-inked marks over a photographed pond painting | Rings or spirals; three palettes; pressure and line boil; optical softness, grain and gate weave; pause a cel, shower or clear the pond |
| **Sea Melt** | Flowing foam contours | Tune warp, crest width/count and drift |
| **Stone Break** | One shared fracture network for cracks and pieces | Strike a framed stone slab, then reassemble it or make a new stone |
| **Searchlights** | Beams, drifting haze and occluding forms | Aim the lights; explore beam width, sweep, haze and blocker arrangements |
| **Paper Marbling** | Ebru / suminagashi: paint floating on a size bath. Drops push older paint into rings; a stylus or comb drags it into hearts, chevrons, and feathers. Exact backward replay of invertible ops, so combed edges never blur | Tap to drop paint; drag to pull the stylus (or a straight comb, or sprinkle drops). Pattern menu plays the classics (Bullseyes, Stone, Gel-gel, Chevron, Nonpareil, Bouquet, Suminagashi); Print lays paper on the bath |

Open the **Demo Garden** drawer to switch demos and adjust their tools. It starts collapsed on phones. **Hide**, **H**, or **Escape** hides the interface; the small **Controls** tab or **H** brings it back. Opening, closing and hiding controls leave the full-size canvas and simulation state intact. **Restart** restores the active demo's defaults. **Full screen** is available when the browser supports it.

The drawer has a silver leafy-vine frame, engraved dividers and faceted gemstone controls. Its vector ornaments scale cleanly, while sliders and menus retain native keyboard and touch behavior.

You can also set the URL hash directly:

```
http://localhost:5173/#ripple-drop
http://localhost:5173/#turing-patterns
```

## Getting Started

```bash
npm install
npm run dev      # Vite dev server at http://localhost:5173
npm run build    # TypeScript check + production bundle
npm run preview  # Preview the production build locally
```

Verification:

```bash
npm run test:cells          # 24,000-case nearest-cell oracle and original-bug negative control
npm run test:stone          # Shared seam, coverage and triangulation checks across generated slabs
npm run test:bubbles        # Frame-schedule identity, rise, contact and stirring checks
npx playwright install chromium
npm run test:ripple         # Actual ring motion, film cadence, pause, controls and GL resource lifetime
npm run test:searchlights   # Production shader checks for shadows, aiming, freeze and light controls
npm run test:browser        # Production build, all-demo WebGL smoke and desktop/mobile control checks
```

Browser checks use Chromium's software WebGL renderer and write screenshots to `/tmp/gl-demo-garden-checks` (override with `ARTIFACT_DIR`). These verify rendering and interaction; they do not establish hardware GPU or real-phone frame rates.

**Requirements**: A browser with WebGL2 and `EXT_color_buffer_float` support (all modern browsers qualify). The compute-heavy demos (e.g. Turing Patterns) run simulation grids at half resolution to stay GPU-friendly.

## Tech Stack

| Layer | Tool |
|-------|------|
| Language | TypeScript 5 (strict) |
| Build | Vite 6 + `vite-plugin-glsl` |
| Rendering | WebGL2 (no external GL library) |
| Shaders | GLSL ES 3.00 |

`vite-plugin-glsl` inlines `.glsl` files as typed string imports, so shaders are co-located with their plugin and hot-reload during development.

## Project Layout

```
src/
├── main.ts                  # Plugin registry and navigation UI
├── style.css                # Shared drawer, controls and mobile layout
├── engine/
│   ├── Engine.ts            # WebGL2 context, RAF loop, plugin lifecycle
│   ├── InputManager.ts      # Unified mouse/touch gesture handling
│   ├── ParamSlider.ts       # Labelled sliders, selects, actions and sections in the shared drawer
│   ├── gl-utils.ts          # Shader compilation and program linking
│   └── types.ts             # EngineContext, GestureEvent interfaces
├── plugin/
│   ├── Plugin.ts            # Plugin interface (init/render/destroy/onGesture)
│   ├── FragmentShaderPlugin.ts  # Base class for single-pass fullscreen shaders
│   └── PingPongFBO.ts       # Ping-pong framebuffer for iterative GPU compute
├── plugins/
│   ├── wobbly-cells/        # index.ts + fragment.glsl
│   ├── turing-patterns/     # index.ts + compute.glsl + display.glsl
│   ├── bubble-physics/      # Fixed-step dynamics, instanced surfaces and shared water shading
│   ├── ripple-drop/         # Cached painting, analytic ink and photographic finish
│   ├── stone-break/         # Shared fracture geometry, meshes and crack animation
│   ├── searchlights/        # Analytic light transport and occlusion
│   ├── paper-marbling/      # index.ts + trace.glsl + display.glsl + recipes.ts
│   └── anime-shaders/       # REFERENCE.md — visual technique reference
└── shaders/
    ├── fullscreen-quad.vert # Clip-space triangle via gl_VertexID (no VBO needed)
    └── lib/
        ├── anime-style.glsl # inkStroke(), softGlow(), expGlow(), posterize()
        ├── noise.glsl       # snoise(), fbm(), hash21(), hash22()
        └── sdf2d.glsl       # sdCircle(), sdLine(), sdArc(), smooth booleans
```

## Deployment — Cloudflare Pages

The repo is pre-configured for Cloudflare Pages. `wrangler.toml` declares the project name and output directory; `public/_headers` ships cache and security headers with the static bundle.

### Via the Cloudflare dashboard

1. Connect the repo in **Workers & Pages → Create → Pages → Connect to Git**.
2. Set the build settings:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Node.js version**: `20` (also declared in `.nvmrc`)
3. Deploy. Subsequent pushes to `master` deploy automatically.

### Via Wrangler CLI

```bash
npm install -g wrangler
wrangler login
npm run build
wrangler pages deploy dist
```

### What ships

| File | Purpose |
|------|---------|
| `wrangler.toml` | Project name, output dir, compatibility date |
| `public/_headers` | `Cache-Control: immutable` for hashed assets; security headers on all routes |
| `.nvmrc` | Pins Node 20 for the Pages build worker |

Hashed asset filenames (e.g. `dist/assets/main-Cx3AbQd8.js`) are served with `max-age=31536000, immutable`. The HTML entry point is served with `no-cache` so browsers always revalidate it for new deploys.

---

## Architecture Overview

The engine follows a simple **plugin pattern**: each demo implements the `Plugin` interface and is completely responsible for its own GL resources. The engine provides timing, input, and a canvas; the plugin does everything else.

For the full rendering pipeline, shader library documentation, and a guide to writing your own plugin, see [ARCHITECTURE.md](./ARCHITECTURE.md).

For the visual and physical reference behind the anime-aesthetic effects, see [src/plugins/anime-shaders/REFERENCE.md](./src/plugins/anime-shaders/REFERENCE.md).
