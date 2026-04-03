# GL Demo Garden

A WebGL2 interactive shader effects gallery with an 80s anime aesthetic. Each demo is a self-contained GPU-accelerated effect that you can interact with in real time.

## Demos

| Demo | Effect Type | Interaction |
|------|-------------|-------------|
| **Wobbly Cells** | Procedural Voronoi cell animation | Mouse moves the warp field |
| **Turing Patterns** | Gray-Scott reaction-diffusion | Click/drag to seed chemical B |
| **Bubble Physics** | Vertex-displaced bubble simulation | Passive; bubbles float and collide |
| **Ripple Drop** | 2D wave-equation heightfield | Click/drag to create ripples |
| **Laser Bird** | Multi-pass bloom composite | Passive; animated bird with glow |
| **Boat Wake** | Kelvin wake foam advection | Passive; foam trails behind boat |

Navigate between demos using the links in the top bar, or by setting the URL hash directly:

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

**Requirements**: A browser with WebGL2 and `EXT_color_buffer_float` support (all modern browsers qualify). The compute-heavy demos (Turing Patterns, Ripple Drop, Boat Wake) run simulation grids at half resolution to stay GPU-friendly.

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
├── engine/
│   ├── Engine.ts            # WebGL2 context, RAF loop, plugin lifecycle
│   ├── InputManager.ts      # Unified mouse/touch gesture handling
│   ├── ParamSlider.ts       # Live parameter slider UI overlay
│   ├── gl-utils.ts          # Shader compilation and program linking
│   └── types.ts             # EngineContext, GestureEvent interfaces
├── plugin/
│   ├── Plugin.ts            # Plugin interface (init/render/destroy/onGesture)
│   ├── FragmentShaderPlugin.ts  # Base class for single-pass fullscreen shaders
│   └── PingPongFBO.ts       # Ping-pong framebuffer for iterative GPU compute
├── plugins/
│   ├── wobbly-cells/        # index.ts + fragment.glsl
│   ├── turing-patterns/     # index.ts + compute.glsl + display.glsl
│   ├── bubble-physics/      # index.ts + background.glsl + bubble.vert + bubble.frag
│   ├── laser-bird/          # index.ts + bird.glsl + blur.glsl + composite.glsl
│   ├── ripple-drop/         # index.ts + simulate.glsl + display.glsl
│   ├── boat-wake/           # index.ts + wake-sim.glsl + display.glsl
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
