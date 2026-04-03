# 80s Anime Visual Effects — Technical Reference

A research companion for reproducing the visual effects of 1980s anime through
WebGL shaders, with particular focus on *Windaria* (1986, Kaname Productions /
directed by Kunihiko Yuyama).

---

## 1. Production Context: How 80s Anime Was Made

### The Cel Animation Pipeline

1. **Key animation** drawn on paper (pencil line art)
2. Lines traced onto transparent **acetate cels** with ink or xerography
3. Cels **painted on the reverse side** with poster color (gouache-like opaque paint)
4. Painted cels layered over separate **background paintings** (watercolor/gouache on illustration board)
5. The stack photographed frame-by-frame on a **camera stand** (multiplane camera for parallax)
6. Final output on **35mm film** — introducing grain, slight color shifts, and optical characteristics

### Implications for Visual Effects

- **Glow/bloom** could not be done digitally. Studios used:
  - **Diffusion filters** (Pro Mist, Fog filters) on the camera lens
  - **Multiple exposures**: bright element shot on backlit cel, then double-exposed onto the scene
  - **Airbrushed gradients** on separate cel layers, composited optically
  - **Backlit cels**: elements painted on cels placed over a light box during photography
- **Water effects** were hand-painted frame by frame:
  - Ripples drawn as discrete rings on cels overlaid on the water background
  - Each frame redrawn with rings slightly expanded — labor-intensive
  - The "imperfections" (breaks, thickness variation) are inherent to hand-drawing
- **Particles** (petals, sparks, snow) were individual airbrushed dots on separate cels
  - Limited count (10–30 per frame) due to labor cost
  - Soft edges from airbrush technique
- **Film capture** adds: grain, slight halation around bright areas, warm color cast, subtle blur from optical compositing

### The Resulting Aesthetic

The combination of these techniques produces a look that is:
- Rich and painterly (background art) contrasting with flat, clean shapes (cel art)
- Warm and slightly soft (film grain + optical compositing)
- Economical but expressive (limited frames, but each drawn with intent)
- Imperfect in ways that feel organic (hand-drawn line variation, paint opacity variation)

---

## 2. Water Ripple Physics & Stylization

### Physical Phenomena

**Wave equation (2D surface waves):**
```
∂²h/∂t² = c² ∇²h
```
Where `h` = surface height, `c` = wave speed, `∇²` = Laplacian operator.

**Key behaviors:**
- **Circular propagation** from a point source (raindrop impact)
- **Amplitude decay** proportional to `1/√r` — energy spreads over increasing circumference
- **Capillary waves** (wavelength < ~2cm) are surface-tension-dominated:
  - Higher frequency, faster decay
  - Dispersive: shorter wavelengths travel *faster* (unlike gravity waves)
  - This causes the wavefront to develop a complex structure with leading short waves
- **Damping**: viscosity and surface tension dissipate energy; small ripples fade within seconds
- **Reflection** from edges (pond banks) creates interference patterns
- **Multiple sources** create complex interference (additive superposition)

**What a real raindrop impact looks like:**
- Initial splash crater with crown-shaped ejection
- Crown collapses, producing a central Worthington jet
- Circular capillary waves radiate outward
- Leading wavefront has highest frequency; trailing waves are longer wavelength
- Typically 5–15 visible wave crests, decreasing in amplitude outward

### Anime Stylization (Windaria Puddle Scene)

The Windaria ripple effect **departs from realism** in specific, intentional ways:

1. **Reduced ring count**: Only 2–4 concentric rings visible (hand-drawn economy)
2. **White highlight strokes on dark water**: Rings rendered as bright lines, not full wave profiles
3. **Broken/gapped rings**: The rings are NOT continuous circles. Breaks occur at irregular intervals.
   - **Why breaks exist in the art:**
     - Suggest light reflection irregularity (specular highlights don't wrap uniformly)
     - Imply the water surface isn't perfectly flat (micro-terrain)
     - Create visual rhythm and avoid mechanical feel
     - Natural result of quick, confident brushwork
   - **How to reproduce:** Noise-driven masking along the angular coordinate of each ring
4. **Stroke thickness variation**:
   - Thicker at some points, thinner at others
   - Suggests perspective (thicker = closer to viewer) and 3D surface curvature
   - Also natural hand-drawn imprecision — the artist's brush varies in pressure
   - **How to reproduce:** Modulate stroke width with low-frequency noise keyed to angular position
5. **Dark water surface**: Near-black with subtle blue-green undertone, very low reflectivity
6. **Stroke "height" variation**: Subtle brightness differences along a ring suggest the ripple crest has varying height — this is a *perspective cue* implying the water surface curves in 3D

### Shader Implementation Strategy

```
Simulation layer (PingPongFBO):
  2D wave equation with damping
  Click/tap injects Gaussian impulse

Display layer:
  Sample heightfield gradient magnitude → identifies ring positions
  For each detected ring edge:
    Compute angular coordinate (atan2 from ring center)
    Sample noise at (angle, radius) → break mask
    Sample noise at (angle * different_freq) → width variation
    Render as SDF stroke with modulated width
    Apply break mask to create gaps
  Add soft glow halo around strokes
  Dark water base with subtle caustic pattern
```

---

## 3. Ocean Wake Fluid Dynamics & Stylization

### Physical Phenomena

**Kelvin wake pattern:**
- A boat (or any object) moving through deep water creates a wake confined to a wedge
- The half-angle of this wedge is **19.47°** (arcsin(1/3)) — independent of boat speed
- Two wave families within the wedge:
  - **Transverse waves**: perpendicular to direction of travel, curved
  - **Divergent waves**: angled outward from the bow, straighter
- The wake edge (cusp line) is where transverse and divergent waves meet

**Foam and turbulence:**
- Directly behind the boat: turbulent wake with entrained air bubbles → white foam
- Breaking wave crests also produce foam
- Foam persists for seconds to minutes depending on conditions
- Foam patterns are fractal-like: large structures contain smaller sub-structures

**Froude number** (Fr = v/√(gL)) determines wake character:
- Low Fr: gentle, linear waves
- High Fr: breaking waves, significant foam, spray

### Anime Stylization (Windaria Bridge Scene)

The Windaria ocean wake is **heavily stylized**, closer to graphic art than simulation:

1. **Ukiyo-e influence**: The wave forms strongly recall Japanese woodblock prints
   - Curling crests that spiral inward (cf. Hokusai's Great Wave)
   - Bold, confident outlines defining each wave form
   - Flat color fill between outlines
   - Decorative rather than realistic treatment

2. **Graphic qualities:**
   - **Flat base color**: Solid teal/cerulean water, not gradient-heavy
   - **Bold white outlines**: Thick, consistent stroke width (unlike the variable ripple strokes)
   - **Curling motifs**: Individual wave crests curl into spiral forms
   - **Hierarchical structure**: Large curls contain smaller subsidiary curls
   - **No transparency**: Opaque painted look, not translucent water

3. **Wake structure:**
   - V-shape spreading from boat, but filled with organic curl patterns
   - The V-wake leading edges are strong directional lines
   - Within the wake: a dense pattern of curling foam shapes
   - Outside the wake: relatively calm flat water

### Shader Implementation Strategy

```
Simulation layer (PingPongFBO):
  Foam density field:
    Boat emits foam in Kelvin-angle envelope
    Foam advected by curl noise (creates flowing organic patterns)
    Foam diffuses slightly (spatial spread)
    Foam decays over time

Display layer:
  Sample foam density + compute gradient → edge detection
  Domain-warped noise creates curl motifs within foam areas:
    Base noise warped by its own gradient → natural spiral patterns
    Multiple scales for hierarchical curl structure
  Edge extraction → bold SDF strokes
  Interior fill → slightly lighter flat color
  Flat teal base outside foam areas
```

**Key technique — curl noise for wave motifs:**
```glsl
vec2 curlUV = uv * CURL_SCALE;
float warp1 = snoise(curlUV * 0.3 + time * 0.1);
float warp2 = snoise(curlUV * 0.3 + offset + time * 0.1);
vec2 warpedUV = curlUV + vec2(warp1, warp2) * warpAmount;
float curlPattern = snoise(warpedUV);
```
This naturally produces flowing, organic spiral shapes because the noise warps itself into coherent structures.

---

## 4. Glow & Bloom Optical Effects

### Physical Phenomena

**Lens bloom:**
- Bright light sources scatter within lens elements (internal reflections, surface imperfections)
- Produces a soft halo extending well beyond the source's geometric image
- Intensity falls off roughly as `1/r²` from source center
- Chromatic effects: different wavelengths scatter differently → color fringing

**Atmospheric scattering:**
- Light scatters off dust, moisture, and air molecules
- Forward scattering (Mie) creates bright halos around light sources
- Produces soft, diffuse illumination in the surrounding space

**Film halation:**
- In 35mm film: light passes through emulsion, reflects off the film base, re-exposes the emulsion
- Creates a soft red/warm halo around very bright sources
- Radius depends on film stock and exposure level

### 80s Anime Glow Techniques

The glow in 80s anime has a distinctive quality different from modern digital bloom:

1. **Multi-exposure compositing:**
   - The glowing element is shot on a separate pass with the camera
   - A diffusion filter is placed over the lens for this pass
   - The result is double-exposed onto the main scene
   - This creates a physically-motivated glow with lens characteristics

2. **Airbrushed glow layers:**
   - Gradient sprayed with airbrush on a separate cel
   - Layered over the scene during photography
   - Result: smooth, soft gradient with paint texture
   - Color can shift (center color ≠ fringe color)

3. **Backlit cels:**
   - Transparent/translucent paint areas on cel placed over light source
   - Light bleeds through, creating organic glow
   - Very soft, warm quality

4. **The resulting aesthetic:**
   - **Warm**: The optical process adds warmth (film + filters)
   - **Soft**: Edges are genuinely soft, not sharp-then-blurred
   - **Layered**: Multiple glow layers at different radii/colors
   - **Color shift**: Center is often near-white, fringe shifts warm (orange, pink)
   - **Filmic**: Has the organic quality of light captured on film, not computed

### Windaria Laser Bird Scene

- **Shape**: Bird silhouette with spread wings — the core is a defined SDF shape
- **Core**: Near-white with pink tint — extremely bright, almost blown out
- **Inner glow**: Hot pink/magenta, tight around the shape
- **Outer glow**: Softer, wider, with warm color shift at the fringe
- **Illumination**: The glow lights up the faces of onlookers below (reflected light)
- **Particles**: Cherry blossom petals or magical sparks drift upward through the glow
  - Semi-transparent, small
  - Gentle upward drift with slight horizontal wander
  - Some overlap with the glow, some above it
- **Background**: Dark night sky with visible stars
  - Stars are visible through the outer glow (implying semi-transparent compositing)
  - Strong contrast maximizes the glow's impact

### Shader Implementation Strategy

```
Pass 1 — Scene render (full resolution FBO):
  Bird SDF → interior fill (bright white-pink)
  Multiple exponential falloffs at different rates → layered glow
  Core = tight falloff, very bright
  Inner = medium falloff, pink
  Outer = wide falloff, warm-shifted color

Pass 2 — Bloom blur (half-resolution PingPongFBO):
  Separable Gaussian blur, multiple passes
  Each pass increases effective radius
  The multi-pass approach naturally creates smooth, wide glow

Pass 3 — Composite (screen):
  Night sky background (gradient + hash-based starfield)
  Additive bloom compositing (original + blurred)
  Color temperature shift on bloom (warmer at edges)
  Floating particles (soft radial alpha, CPU-driven positions)
  Tone mapping to prevent harsh clipping
```

---

## 5. Color Palettes of the Era

### Characteristics

80s anime color palettes were constrained by the paint medium (poster color / animation gouache):
- **Limited but intentional**: Each color hand-mixed, so palettes tend to be cohesive
- **Strong darks**: Rich dark navy, deep green, near-black common for dramatic scenes
- **Saturated highlights**: When bright colors appear, they're vivid and saturated
- **Warm undertones**: Film capture and optical compositing add warmth

### Specific Palette Notes

**Dark water (puddle scene):**
- Base: `rgb(3, 8, 15)` — almost black with deep blue undertone
- Highlights: `rgb(215, 230, 240)` — cool near-white for ripple strokes
- Subtle variation: `rgb(5, 15, 25)` — slightly lighter patches for depth

**Ocean (wake scene):**
- Flat teal: `rgb(20, 90, 128)` — strong, saturated blue-green
- Foam white: `rgb(230, 235, 225)` — slightly warm off-white
- Foam fill: `rgb(115, 165, 185)` — lighter blue for interior areas

**Night sky (glow scene):**
- Sky dark: `rgb(3, 3, 13)` — near-black with blue cast
- Stars: `rgb(205, 215, 255)` — cool white with slight blue
- Glow core: `rgb(255, 220, 230)` — near-white pink
- Glow inner: `rgb(255, 90, 165)` — hot pink/magenta
- Glow fringe: `rgb(180, 50, 90)` — deeper warm pink

---

## 6. Particle & Petal Effects

### Production Technique

- Each particle is a small shape (dot, petal, sparkle) painted on a cel
- Airbrush gives soft edges — NOT hard-edged geometric shapes
- Limited count per frame (10–30 typical) due to manual labor
- Animated 1s or 2s (every frame or every other frame)
- Depth layering: particles at different "distances" have different sizes and opacity
- Motion: simple drift (gravity, wind, buoyancy) with slight oscillation

### Shader Approach

- CPU-driven particle positions (simple physics: velocity + drift + noise)
- GPU rendering as soft radial falloff at each position
- Per-particle: random size, opacity, lifetime offset
- Fade in/out over lifetime (smoothstep at birth and death)
- Slight color variation between particles

---

## 7. Phenomena-to-Technique Mapping

| Visual Phenomenon | Physical Basis | Anime Stylization | GLSL Technique |
|---|---|---|---|
| Ripple rings | 2D wave equation, circular propagation | 2–4 discrete white strokes on dark water | Wave sim on PingPongFBO, gradient magnitude → ring detection |
| Ripple stroke breaks | Specular reflection irregularity, surface imperfections | Intentional gaps in ring strokes | Noise-driven mask along angular coordinate |
| Ripple stroke thickness | Perspective foreshortening, wave amplitude variation | Variable width along ring suggesting 3D | Width modulated by low-frequency noise |
| Wake V-pattern | Kelvin wake (19.47° half-angle) | Strong directional V-lines from boat | Geometric envelope based on boat position/heading |
| Wake curling foam | Turbulence, wave breaking, air entrainment | Ukiyo-e-inspired spiral/curl motifs | Domain-warped noise (curl noise) within wake area |
| Wake bold outlines | Foam/water boundary | Thick, confident white strokes on blue | Edge detection on foam field → SDF stroke rendering |
| Glow/bloom halo | Lens scatter, atmospheric scattering | Multi-layer soft glow from optical filters | Multi-pass Gaussian blur + additive compositing |
| Glow color fringe | Chromatic aberration, film halation | Warm color shift at glow edges (pink→orange) | Mix fringe color based on blur distance |
| Floating particles | Physical particles (petals, sparks) | Soft-edged dots, limited count, gentle drift | CPU positions + radial alpha falloff in shader |
| Dark water surface | Low-reflectivity water, night/shade | Near-black with subtle blue-green | Dark base gradient + very subtle caustic noise |
| Flat ocean color | -- | Graphic design choice (flat teal fill) | Solid color with minimal noise variation |
| Film grain quality | 35mm film grain | Warm, slightly soft, organic texture | Optional: noise overlay with temporal variation |

---

## 8. Areas for Future Exploration

- **Cel edge detection**: Reproducing the slightly variable ink outlines of cel art
- **Background painting texture**: Watercolor/gouache texture simulation
- **Camera effects**: Multiplane parallax, rack focus, camera shake
- **Film stock emulation**: Grain, halation, color response curves
- **Limited palette enforcement**: Quantizing colors to match period paint palettes
- **Frame rate effects**: Holding frames on 2s/3s for authentic animation timing
- **Light spill**: How glow sources illuminate nearby characters/surfaces
- **Reflection on water**: Distorted reflections of above-water elements in the puddle
