# Anime Shader Effects — Windaria-Inspired Reference

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

## Color Palettes

### Windaria Characteristics
- **Limited but rich palette**: 20–30 colors per scene typical of hand-painted cels
- **Strong darks**: deep blues, blacks, and dark teals for night scenes
- **Saturated highlights**: bright magentas, cyans, golds against dark backgrounds
- **Warm/cool contrast**: warm skin tones and glows against cool blue-green environments

### Per-Demo Palettes
- **Water Ripple**: deep navy (#0a0e2a) base, pale blue-white (#c8deff) strokes, subtle teal undertone
- **Laser Bird**: night sky (#050818), magenta core (#ff3ca0), pink bloom (#ff80c0), warm fringe (#ffa060), starfield whites
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
