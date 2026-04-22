# Anime Shader Effects — Windaria-Inspired Reference

This document records the visual, physical, and aesthetic reasoning behind each demo effect. It is intended both as an artistic reference and as a technical rationale for shader design decisions. For implementation details see [ARCHITECTURE.md](../../ARCHITECTURE.md).

## 80s Anime Production Context

### Cel Animation Pipeline
- **Hand-painted cels on acetate**: each frame is gouache/acrylic paint on clear celluloid, layered over painted backgrounds
- **Limited animation economy**: key poses held for 2–3 frames (12fps or 8fps on 24fps film), with held cels and camera moves substituting for full animation
- **Multi-layer compositing**: physical cels stacked under a downshooter camera; glows and special effects achieved via multi-exposure, diffusion filters, and airbrush overlays
- **Studios**: Kaname Pro (Windaria background art), Gallop/Idol (animation production)

### Optical Effects Techniques
- **Diffusion filters**: glass or gauze filters placed on the camera lens to create soft bloom around bright areas
- **Multi-exposure compositing**: the same frame of film exposed multiple times with different cel layers/filters to build up glow effects
- **Airbrush overlays**: separate cels airbrushed with gradient glow patterns, composited over character/effect layers
- **Backlit cels**: light projected through painted translucent areas for intense glow effects (lasers, magic, explosions)

## Water Ripple Physics & Stylization

### Real Physics
- Circular wave propagation from a point disturbance
- Amplitude decays as **1/√r** (energy spreading over expanding circumference)
- Phase velocity depends on wavelength (dispersion): deep-water waves travel at v = √(gλ/2π)
- Real ripples produce a continuous spectrum of rings with varying spacing

### Anime Simplification
- **2–4 discrete rings** instead of continuous wave field
- White/bright highlights on dark water surface
- **Intentional gaps** in rings for hand-drawn quality
- **Thickness variation** along ring circumference suggesting perspective foreshortening
- Rings may have slight irregularity (not perfect circles)
- Color: deep blue-black water with white/pale blue ring strokes

### Shader Mapping
| Visual Quality | GLSL Technique |
|---|---|
| Discrete rings | Wave equation heightfield → peak detection |
| Hand-drawn gaps | Noise-modulated break mask in `inkStroke()` |
| Thickness variation | Noise-driven width parameter + angular variation |
| Amplitude decay | Natural 2D wave equation falloff + damping term |
| Dark water | Low-saturation deep blue base color |

## Ocean/Wake Fluid Dynamics & Stylization

### Real Physics: Kelvin Wake
- A boat moving at constant speed creates a wake pattern bounded by a **19.47° half-angle** envelope (the Kelvin angle)
- Inside the envelope: transverse waves (perpendicular to boat heading) and divergent waves (angled outward)
- Turbulent foam forms along the wake edges and in the recirculation zone behind the boat
- Wake width grows linearly with distance behind the boat

### Ukiyo-e Wave Influence
- **Hokusai / ukiyo-e wave aesthetics**: bold black outlines, flat interior color, curling crest motifs
- Waves depicted as stylized spiral/curl shapes rather than realistic fluid
- Strong contrast between wave body (deep blue/teal) and foam (white)
- Repetitive, rhythmic wave patterns creating decorative quality

### Shader Mapping
| Visual Quality | GLSL Technique |
|---|---|
| Kelvin wake envelope | Angular mask based on boat heading ± 19.5° |
| Foam accumulation | Advection-diffusion simulation on PingPongFBO |
| Curling wave shapes | Warped domain noise (curl noise) |
| Bold outlines | Gradient magnitude → `inkStroke()` edge detection |
| Flat color regions | Step/posterize on foam density |
| Turbulence | Multi-octave fBm in wake region |

## Glow/Bloom Optical Effects

### Real Optics
- **Lens bloom**: bright light sources scatter within camera lens elements, creating soft halos
- **Atmospheric scatter**: particles in air diffuse light from bright sources
- **Diffraction spikes**: from lens aperture blades (not typically in anime style)

### 80s Anime Technique
- Multi-exposure compositing with **diffusion-filtered layers**
- Airbrushed glow cels: hand-painted gradient falloff on separate overlay cels
- Color temperature shift: glow fringes shift toward warm pink/orange or cool blue
- Often **2–3 glow layers** of different radii composited additively
- Extremely saturated core color that desaturates toward edges

### Shader Mapping
| Visual Quality | GLSL Technique |
|---|---|
| Soft bloom | Multi-pass separable Gaussian blur on half-res FBO |
| Additive compositing | `gl.blendFunc(ONE, ONE)` or shader additive mix |
| Color temperature shift | Hue rotation in composite pass at glow fringe |
| Saturated core | Source shape rendered with high-saturation color |
| Multiple glow radii | Multiple blur passes with different kernel sizes |

## Turing / Reaction-Diffusion Patterns

### Real Chemistry: Gray-Scott Model

The Gray-Scott equations describe two abstract chemical species A and B reacting and diffusing on a 2D surface:

```
∂A/∂t = Dₐ·∇²A  −  A·B²  +  f·(1−A)
∂B/∂t = D_b·∇²B  +  A·B²  −  (f+k)·B
```

- **Dₐ, D_b** — diffusion coefficients; A always diffuses faster than B, which drives pattern formation
- **f** (feed) — rate at which A is replenished from a reservoir outside the system
- **k** (kill) — rate at which B is removed

The term **A·B²** is the nonlinear reaction: A is consumed and B is produced wherever B is already present, but at a rate proportional to B². This autocatalytic step causes small perturbations to grow explosively into structured patterns.

### Phase Space and Pattern Morphology

The (f, k) parameter space maps onto a rich zoo of pattern types:

| f range | k range | Morphology |
|---------|---------|------------|
| 0.01–0.03 | 0.04–0.06 | Isolated spots (Turing dots) |
| 0.03–0.06 | 0.06–0.07 | Coral / branching growth |
| 0.05–0.08 | 0.06–0.065 | Worm-like labyrinths |
| 0.02–0.04 | 0.05–0.06 | Spiral waves |
| 0.09–0.12 | 0.04–0.06 | Moving stripes |

The default preset (`f = 0.0545`, `k = 0.062`) sits in the coral-growth region — long branching filaments that grow, merge, and stabilise.

### Numerical Stability

The discrete update uses an explicit Euler step on a 3×3 Laplacian stencil. Stability requires the Courant–Friedrichs–Lewy condition `dt·D / dx² < 0.25`. The simulation uses `dt = 1.0` (dimensionless), `dx = 1 pixel`, and `Dₐ = 0.2`, `D_b = 0.1`, all safely below the stability limit. Running 12 steps per visual frame accelerates the apparent speed without changing the physical time step.

### 80s Anime Connection

Turing-like organic branching patterns appear in nature (coral, slime mould, nerve fibres) but were also widely referenced as "organic texture" backdrops in 80s science-fiction anime. The display shader maps B concentration to a two-tone colour gradient, echoing the posterized, limited-palette look of hand-painted backgrounds.

---

## Bubble Physics

### Real Optics: Thin-Film Interference

The iridescent colours of soap bubbles arise from **thin-film interference**. White light reflects from both the outer and inner surfaces of the bubble wall. The path-length difference between these reflections is `2t·cos(θ)` where `t` is the local film thickness and `θ` is the angle of incidence. Wavelengths that satisfy `2t·cos(θ) = mλ` (integer multiples) constructively interfere; others destructively cancel.

As a bubble drains, the film thins from top to bottom, cycling through the visible spectrum: yellow → magenta → cyan → green → black ("black film" when `t < λ/4`, below the threshold for any visible constructive interference).

### Anime Stylisation

80s anime depiction of bubbles used:
- **Flat specular highlight**: a white crescent or circle on the upper-left, hand-painted as a separate cel layer
- **Colour gradient body**: often a warm-to-cool sweep (pink upper hemisphere, blue-green lower)
- **Soft outline**: thin dark ring, sometimes broken to suggest translucency
- **No true iridescence**: computation was impossible; instead, a fixed pastel palette implied it

### Shader Mapping

| Visual Quality | GLSL Technique |
|---|---|
| Iridescent colour sweep | Perturbed normal → view-angle dot product → hue rotation |
| Specular highlight | SDF circle offset from centre + `smoothstep` |
| Outline | `sdCircle` gradient → `inkStroke()` |
| Floating motion | Vertex displacement via `snoise(position + time)` |
| Size variation | Per-instance radius passed as vertex attribute |

---

## Water Ripple Physics & Stylization

### Windaria Characteristics
- **Limited but rich palette**: 20–30 colors per scene typical of hand-painted cels
- **Strong darks**: deep blues, blacks, and dark teals for night scenes
- **Saturated highlights**: bright magentas, cyans, golds against dark backgrounds
- **Warm/cool contrast**: warm skin tones and glows against cool blue-green environments

### Per-Demo Palettes
- **Water Ripple**: deep navy (#0a0e2a) base, pale blue-white (#c8deff) strokes, subtle teal undertone
- **Swallowtail Butterfly**: night sky (#050818), magenta core (#ff3ca0), violet fringe (#9f73ff), gold wing veins (#ffe68c), warm bloom (#ffa060), starfield whites
- **Boat Wake**: teal water (#1a4a5a), deep blue (#0d2840), white foam (#e8f0ff), bold outline (#1a2a3a)

## Particle / Petal Effects

### 80s Anime Particles
- Simple billboard sprites with soft radial falloff
- Slow drift physics: gentle gravity + random lateral motion
- Often used for: sakura petals, sparks, magical particles, dust motes
- Size variation creates depth illusion
- Opacity fade-in/fade-out over particle lifetime

### Shader Mapping
- CPU-side particle state (position, velocity, lifetime)
- Rendered as soft radial points in fragment shader: `exp(-r² * sharpness)`
- Per-particle color and opacity passed as uniforms or packed into texture

## Wave Equation: Numerical Considerations

The ripple simulation is a discretised 2D wave equation. Several practical constraints shape the implementation:

### Stability Limit (CFL Condition)

For an explicit finite-difference scheme, the wave speed `c` (the `waveSpeed` uniform) must satisfy:

```
c · dt / dx  ≤  1 / √2  ≈  0.707
```

`dx = 1 / simWidth` (one texel in UV space), `dt = 1 frame`. At half resolution and `waveSpeed = 0.45` the scheme is comfortably stable. Setting `waveSpeed > 0.7` causes the simulation to blow up — amplitudes diverge exponentially.

### Three-Level Storage

The explicit wave update requires heights at two previous time levels (`h_curr` and `h_prev`). These are packed into the `.rg` channels of the RGBA16F ping-pong texture, leaving `.ba` available for other per-pixel state (e.g. a foam accumulation channel). This packing avoids allocating a second simulation texture.

### Damping

Multiplying `h_next` by a damping factor `d < 1` after each step drains energy:

```
Energy(t) ≈ E₀ · d^(t / dt)
```

At `d = 0.995` and 60 fps, energy halves every `ln(0.5) / ln(0.995) ≈ 138` frames (~2.3 s). At `d = 1.0` ripples persist forever (or grow due to floating-point accumulation).

---

## Bloom and Glow: Gaussian Blur Implementation

### Separable Blur

A 2D Gaussian kernel of radius `r` requires `O(r²)` texture samples per pixel. Separability means a 2D Gaussian equals a horizontal 1D Gaussian convolved with a vertical one:

```
G(x,y) = G(x) · G(y)
```

This reduces cost to `O(r)` samples per pass × 2 passes = `O(2r)` total, which makes large-radius bloom feasible. Swallowtail Butterfly uses this with a half-resolution intermediate FBO: render scene at full res → downsample → blur H → blur V → composite back at full res.

### Additive Compositing

The glow layer is blended additively onto the scene. In linear light (no gamma correction at the blending stage):

```glsl
finalColor = sceneColor + glowColor;
```

This is physically correct for emissive light sources: two equally bright lights should sum, not average. The practical effect is that the glow cannot darken any pixel, only brighten — matching how actual film over-exposure and diffusion filters behave.

### Colour Temperature Shift

Real camera diffusion filters shift glow fringes toward warm (higher colour temperature = bluer; lower = warmer — confusingly, a "warm" glow means lower colour temperature in photographic terms, i.e. orange/red). 80s anime consistently shifts glow fringes warm (toward pink/gold) regardless of the light source colour, which the composite shader implements by rotating hue toward red as the glow intensity decreases from its core.

---

## Mapping Phenomena to Shader Techniques — Summary

| Phenomenon | Source | Shader Technique |
|---|---|---|
| Hand-drawn stroke quality | Cel painting | Noise-modulated SDF stroke with breaks |
| Diffusion glow | Camera filter | Multi-pass Gaussian blur + additive blend |
| Flat color areas | Gouache paint | Step functions / posterization |
| Wave propagation | Water physics | 2D wave equation on PingPongFBO |
| Wake pattern | Kelvin envelope | Angular foam emission mask |
| Foam dynamics | Fluid turbulence | Advection-diffusion + curl noise |
| Bloom halo | Multi-exposure | Downsample → blur → composite |
| Floating particles | Airbrushed overlay | CPU state + soft radial fragment shader |
| Night sky stars | Background painting | Hash-based point field with twinkle |
| Color richness | Limited cel palette | Careful constant selection + subtle noise |
| Organic branching | Biological reference | Gray-Scott reaction-diffusion on PingPongFBO |
| Bubble iridescence | Thin-film optics | View-angle hue rotation + SDF highlight |
| Glow fringe warmth | Film colour shift | Hue rotation toward red at glow periphery |
| Wave decay | Energy dissipation | Multiplicative damping per simulation step |

---

## Design Philosophy

The goal across all demos is to be **physically informed but aesthetically driven**. Real physics provides the vocabulary — wave equations, Kelvin envelopes, thin-film interference, reaction-diffusion — but each simulation is tuned, stylised, and combined with anime-specific rendering techniques until the result reads as hand-crafted rather than computed.

The most important check for each visual element: would a 1985 studio animator have reached for this at their lightbox? If the answer is yes, the effect belongs. If it reads as "computer graphics", it needs more stylisation — more noise, more breaks in the stroke, more posterisation, or a less-smooth curve.
