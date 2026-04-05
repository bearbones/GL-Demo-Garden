#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/anime-style.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_foam;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_strokeBoldness;
uniform vec2 u_boatPos;
uniform vec2 u_boatDir;
uniform float u_zoom;
uniform float u_aspect;
uniform float u_whorlIntensity;
uniform float u_boatSpeed;

// ── Constants ───────────────────────────────────────────────────────
const vec3 WATER_COLOR   = vec3(0.05, 0.30, 0.55);   // Rich blue
const vec3 WATER_DEEP    = vec3(0.02, 0.10, 0.30);    // Deep navy
const vec3 FOAM_COLOR    = vec3(1.0, 1.0, 1.0);       // Pure white crests
const vec3 FOAM_MID      = vec3(0.6, 0.85, 0.95);     // Light cyan mid-foam
const vec3 OUTLINE_COLOR = vec3(0.05, 0.08, 0.15);    // Near-black ink
const vec2 BOAT_SCREEN_POS = vec2(0.5, 0.85);
const float WAKE_HALF_ANGLE = 0.45;  // Wider for visual drama

void main() {
  // ── Camera transform: screen UV → sim UV ──
  vec2 offset = v_uv - BOAT_SCREEN_POS;
  offset.x *= u_aspect;
  offset /= u_zoom;

  // Rotate so boatDir always points up on screen
  float cosA = u_boatDir.y;
  float sinA = u_boatDir.x;
  vec2 rotated = vec2(
    cosA * offset.x - sinA * offset.y,
    sinA * offset.x + cosA * offset.y
  );
  vec2 simUV = u_boatPos + rotated;

  // ── Sample foam field ──
  bool inBounds = all(greaterThanEqual(simUV, vec2(0.0))) && all(lessThanEqual(simUV, vec2(1.0)));
  float foam = inBounds ? texture(u_foam, simUV).r : 0.0;

  // Gradient for edge detection (in sim-space texel units)
  ivec2 simRes = textureSize(u_foam, 0);
  vec2 simTexel = 1.0 / vec2(simRes);
  float fL = inBounds ? texture(u_foam, simUV + vec2(-simTexel.x, 0.0)).r : 0.0;
  float fR = inBounds ? texture(u_foam, simUV + vec2( simTexel.x, 0.0)).r : 0.0;
  float fU = inBounds ? texture(u_foam, simUV + vec2(0.0,  simTexel.y)).r : 0.0;
  float fD = inBounds ? texture(u_foam, simUV + vec2(0.0, -simTexel.y)).r : 0.0;
  vec2 grad = vec2(fR - fL, fU - fD) * 0.5;
  float gradMag = length(grad);

  // ── Water base (screen-space noise for stable background) ──
  float waveNoise = snoise(v_uv * 8.0 + vec2(u_time * 0.06, u_time * 0.02)) * 0.5 + 0.5;
  float waveNoise2 = snoise(v_uv * 18.0 + vec2(-u_time * 0.04, u_time * 0.05)) * 0.5 + 0.5;
  vec3 water = mix(WATER_DEEP, WATER_COLOR, waveNoise * 0.6 + 0.2);
  water += vec3(0.01, 0.02, 0.04) * waveNoise2;

  // ── Posterized foam bands (cel-shaded) ──
  float foamBand = floor(foam * 4.0 + 0.5) / 4.0;

  // ── Foam rendering ──
  // Bold ink outlines at foam edges
  float edgeSeed = atan(grad.y, grad.x) * 5.0 + length(v_uv - BOAT_SCREEN_POS) * 30.0;
  float edgeStroke = inkStroke(
    gradMag - 0.015,
    u_strokeBoldness * 0.035,   // Thicker strokes
    3.0,                         // Fewer breaks for bolder lines
    edgeSeed
  );
  edgeStroke *= smoothstep(0.003, 0.015, gradMag);

  // Interior foam fill with cel bands
  float foamFill = smoothstep(0.1, 0.3, foamBand);

  // ── Spiral whorls at foam edges ──
  vec2 toPixelSim = simUV - u_boatPos;
  float distFromBoat = length(toPixelSim);
  float angleFromBoat = atan(toPixelSim.y, toPixelSim.x);

  // Spiral distortion
  float spiralWarp = angleFromBoat * 2.0 + distFromBoat * 25.0 - u_time * 2.0;
  float whorl = sin(spiralWarp) * 0.5 + 0.5;
  // Mask to foam edges only
  float whorlMask = smoothstep(0.05, 0.15, foam) * smoothstep(0.45, 0.2, foam);
  whorl *= whorlMask * u_whorlIntensity;

  // Secondary smaller whorls
  float spiralWarp2 = angleFromBoat * 4.0 - distFromBoat * 40.0 + u_time * 3.0;
  float whorl2 = sin(spiralWarp2) * 0.5 + 0.5;
  whorl2 *= whorlMask * u_whorlIntensity * 0.5;

  // ── Curling wave shapes (warped noise, sim-space) ──
  vec2 warpedUV = simUV * 14.0 + vec2(
    snoise(simUV * 5.0 + u_time * 0.08) * 0.6,
    snoise(simUV * 5.0 + 100.0 + u_time * 0.08) * 0.6
  );
  float curlPattern = smoothstep(0.25, 0.5, snoise(warpedUV)) * foam;

  // ── Outer ripple arc lines ──
  // V-shaped arcs behind the boat, following wake angle
  float behindBoat = -dot(toPixelSim, u_boatDir);
  vec2 boatPerp = vec2(-u_boatDir.y, u_boatDir.x);
  float perpDist = dot(toPixelSim, boatPerp);

  // Concentric V-arcs: distance along the wake envelope
  float arcDist = behindBoat + abs(perpDist) * 0.6;
  float ripplePhase = arcDist * 50.0 - u_time * 2.5;
  float ripple = sin(ripplePhase);

  // Only show ripples outside main foam, behind the boat
  float rippleMask = step(0.01, behindBoat)
    * smoothstep(0.0, 0.03, foam)
    * smoothstep(0.2, 0.08, foam);

  // Also add faint ripples beyond the wake edges
  float wakeWidth = behindBoat * tan(WAKE_HALF_ANGLE);
  float outerRippleMask = step(0.02, behindBoat)
    * smoothstep(wakeWidth * 0.9, wakeWidth * 1.3, abs(perpDist))
    * smoothstep(wakeWidth * 2.5, wakeWidth * 1.3, abs(perpDist))
    * exp(-behindBoat * 2.5);

  float rippleStroke = inkStroke(
    ripple,
    0.018 * u_strokeBoldness,
    3.5,
    ripplePhase * 1.5
  );
  rippleStroke *= max(rippleMask, outerRippleMask * 0.7);

  // ── Speed lines (screen-space radial streaks) ──
  vec2 fromBoat = v_uv - BOAT_SCREEN_POS;
  fromBoat.x *= u_aspect;
  float screenDist = length(fromBoat);
  float screenAngle = atan(fromBoat.x, -fromBoat.y);

  float lineCount = 50.0;
  float linePhase = screenAngle * lineCount;
  float speedLine = smoothstep(0.35, 0.5, sin(linePhase));

  // Fade: near boat, only behind, scale with speed
  speedLine *= smoothstep(0.02, 0.06, screenDist) * smoothstep(0.35, 0.1, screenDist);
  speedLine *= smoothstep(0.0, -0.02, fromBoat.y);  // Only below boat (behind)
  speedLine *= 0.12 * u_boatSpeed;

  // ── Composite ──
  // Base foam color with cel bands
  vec3 foamRender = mix(water, FOAM_MID, foamFill * 0.5);
  foamRender = mix(foamRender, FOAM_COLOR * 0.9, smoothstep(0.5, 0.75, foamBand) * 0.7);

  // Curl patterns
  foamRender = mix(foamRender, FOAM_COLOR, curlPattern * 0.35);

  // Whorls
  foamRender = mix(foamRender, FOAM_COLOR * 0.95, whorl * 0.4);
  foamRender = mix(foamRender, FOAM_MID, whorl2 * 0.3);

  // Bright foam highlights
  float highlight = smoothstep(0.6, 0.9, foam) * 0.35;
  foamRender += vec3(highlight);

  // Bold ink outlines
  foamRender = mix(foamRender, OUTLINE_COLOR, edgeStroke * 0.8);

  // Ripple arc lines
  foamRender = mix(foamRender, OUTLINE_COLOR, rippleStroke * 0.6);

  // Speed lines (subtle white streaks)
  foamRender += vec3(speedLine);

  // ── Boat hull (screen-space, stern poking in from top) ──
  vec2 hullOffset = v_uv - BOAT_SCREEN_POS;
  hullOffset.x *= u_aspect;

  // Wedge-shaped hull: wider at stern (y=0), narrows upward
  float hullExtent = 0.04;  // How far stern extends down into view
  float hullWidth = 0.025;  // Half-width at the stern
  float hullTaper = 0.6;    // How quickly it narrows going up

  // SDF: pointed hull shape
  float yNorm = -hullOffset.y / hullExtent;  // 0 at boat pos, 1 at stern bottom
  float localWidth = hullWidth * (1.0 - yNorm * hullTaper);
  localWidth = max(localWidth, 0.002);

  float inHull = step(0.0, -hullOffset.y) * step(yNorm, 1.0)
               * step(abs(hullOffset.x), localWidth);

  // Hull outline
  float hullDist = abs(hullOffset.x) - localWidth;
  float hullOutline = smoothstep(0.004, 0.001, abs(hullDist)) * step(0.0, -hullOffset.y) * step(yNorm, 1.0);
  // Stern curve
  float sternDist = length(vec2(hullOffset.x, hullOffset.y + hullExtent)) - hullWidth;
  float sternLine = smoothstep(0.004, 0.001, abs(sternDist)) * step(0.0, hullOffset.y + hullExtent);

  vec3 hullColor = vec3(0.35, 0.25, 0.18);    // Dark wood
  vec3 hullHighlight = vec3(0.55, 0.42, 0.30); // Lighter wood

  vec3 color = foamRender;
  // Fill hull
  color = mix(color, mix(hullColor, hullHighlight, yNorm * 0.5), inHull * 0.95);
  // Hull outline strokes
  color = mix(color, OUTLINE_COLOR, max(hullOutline, sternLine) * 0.9);

  fragColor = vec4(color, 1.0);
}
