#version 300 es
precision highp float;

// ── Composite: bath surface + floating paint + tool, or the paper print ──

#include "../../shaders/lib/noise.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_paint;   // premultiplied paint, covers the screen
uniform vec2 u_resolution;
uniform float u_time;

// Tool: stylus = one pin, comb = a row of pins along u_toolAxis
uniform vec2 u_toolPos;      // bath units
uniform vec2 u_toolAxis;
uniform vec4 u_toolGeo;      // x = tines, y = spacing, z = rod size, w = alpha

// Print sequence: 0 bath, 1 laying the sheet, 2 flipping it, 3 viewing
uniform int u_printPhase;
uniform float u_printT;

const vec3 BATH = vec3(0.885, 0.872, 0.832);
const vec3 PAPER = vec3(0.958, 0.944, 0.905);
const vec3 TABLE = vec3(0.105, 0.092, 0.084);
const float SHEET_INSET = 0.07; // print view: sheet margin, fraction of each side

float aspect() { return u_resolution.x / u_resolution.y; }

// Size (carrageenan) in a pale tray: faint tonal drift
vec3 bathColor(vec2 q) {
  return BATH * (0.985 + 0.03 * fbm3(q * 2.1 + 3.7));
}

// The tray's inner wall shades whatever floats near it, paint included
float wallShade(vec2 uv) {
  vec2 e = min(uv, 1.0 - uv) * vec2(aspect(), 1.0);
  return mix(0.80, 1.0, smoothstep(0.0, 0.05, min(e.x, e.y)));
}

// Broad window reflection on the liquid, rippling very slightly
float sheen(vec2 q) {
  vec2 w = q + 0.006 * vec2(snoise(q * 5.0 + u_time * 0.11), snoise(q * 5.0 - u_time * 0.09 + 7.0));
  vec2 c = vec2(-0.28 * aspect(), 0.30);
  vec2 d = (w - c) * mat2(0.94, 0.34, -0.34, 0.94);
  return smoothstep(0.34, 0.02, abs(d.x)) * smoothstep(0.26, 0.02, abs(d.y));
}

vec3 bathView(vec2 uv) {
  vec2 q = (uv - 0.5) * vec2(aspect(), 1.0);
  vec4 paint = texture(u_paint, uv);
  vec3 col = bathColor(q) * (1.0 - paint.a) + paint.rgb;
  col *= mix(wallShade(uv), 1.0, 0.3 * paint.a);
  // Paint films are matte; bare size reflects more
  col += vec3(0.05, 0.055, 0.06) * sheen(q) * (1.0 - 0.55 * paint.a);
  return col;
}

// Pins seen from above: soft shadow, meniscus ring, dark steel with a glint
vec3 drawTool(vec3 col, vec2 q) {
  float alpha = u_toolGeo.w;
  if (alpha <= 0.0) return col;
  float K = u_toolGeo.x;
  float spacing = u_toolGeo.y;
  float px = 1.0 / u_resolution.y;
  float pr = max(u_toolGeo.z * 0.9, 2.5 * px);
  float mid = (K - 1.0) * 0.5;

  vec2 rel = q - u_toolPos;
  float j = K > 1.5 ? clamp(floor(dot(rel, u_toolAxis) / spacing + mid + 0.5), 0.0, K - 1.0) : 0.0;
  vec2 pin = u_toolPos + (j - mid) * spacing * u_toolAxis;

  // A comb's spine casts a faint band shadow between the pins
  if (K > 1.5) {
    vec2 sh = rel - vec2(0.010, -0.012);
    float along = abs(dot(sh, u_toolAxis)) - (mid + 0.5) * spacing;
    float across = abs(dot(sh, vec2(-u_toolAxis.y, u_toolAxis.x)));
    float band = smoothstep(0.012, 0.004, across) * smoothstep(0.01, 0.0, along);
    col *= 1.0 - 0.10 * band * alpha;
  }

  vec2 dShadow = q - pin - vec2(0.55, -0.7) * pr;
  col *= 1.0 - 0.35 * alpha * smoothstep(pr * 2.2, pr * 0.6, length(dShadow));
  float d = length(q - pin);
  float ring = smoothstep(pr * 0.9, pr * 1.4, d) * smoothstep(pr * 2.6, pr * 1.6, d);
  col += 0.07 * alpha * ring;
  float body = smoothstep(pr + px, pr - px, d);
  vec2 g = (q - pin) / pr;
  vec3 steel = mix(vec3(0.16, 0.17, 0.19), vec3(0.34, 0.36, 0.40), smoothstep(0.6, -0.8, g.x - g.y));
  steel += 0.5 * smoothstep(0.35, 0.0, length(g - vec2(-0.35, 0.38)));
  return mix(col, steel, body * alpha);
}

// The print: the bath pattern mirrored onto laid paper with a little grain,
// fibre, and the odd fleck where an air pocket kept paint from transferring
vec3 printView(vec2 suv) {
  vec4 paint = texture(u_paint, vec2(1.0 - suv.x, suv.y));
  vec2 q = suv * vec2(aspect(), 1.0);
  float px = u_resolution.y;
  float grain = snoise(q * px * 0.35) * 0.5 + snoise(vec2(q.x * px * 0.06, q.y * px * 0.6)) * 0.5;
  vec3 paper = PAPER * (0.985 + 0.02 * grain);
  vec3 pigment = paint.rgb / max(paint.a, 1e-4);
  float transfer = paint.a * (0.93 + 0.05 * snoise(q * 40.0) + 0.02 * grain);
  vec2 cell = floor(q * 140.0);
  vec2 jit = hash22(cell);
  float fleck = step(0.993, hash21(cell + 17.0)) * smoothstep(0.18, 0.05, length(fract(q * 140.0) - jit));
  transfer *= 1.0 - 0.8 * fleck;
  vec3 col = mix(paper, pigment * (0.97 + 0.03 * grain), transfer);
  // Faint sheen falloff toward the sheet edges
  vec2 e = min(suv, 1.0 - suv);
  col *= 0.965 + 0.035 * smoothstep(0.0, 0.08, min(e.x, e.y));
  return col;
}

vec3 paperBack(vec2 suv, vec3 under) {
  vec2 q = suv * vec2(aspect(), 1.0);
  float g = snoise(vec2(q.x * 60.0, q.y * 600.0)) * 0.5 + snoise(q * 250.0) * 0.5;
  // Wet paper turns faintly translucent: the pattern ghosts through
  return mix(PAPER * (0.975 + 0.02 * g), under, 0.10);
}

vec3 table(vec2 uv) {
  vec2 q = uv * vec2(aspect(), 1.0);
  float wood = snoise(vec2(q.x * 1.5, q.y * 22.0)) * 0.5 + 0.5;
  return TABLE * (0.85 + 0.3 * wood);
}

// A sheet occupying `rect` (uv min, size) on the table, with drop shadow
vec3 sheetOnTable(vec2 uv, vec4 rect, bool front, float lift) {
  vec2 suv = (uv - rect.xy) / rect.zw;
  vec3 col = table(uv);
  vec2 sd = (uv - rect.xy - vec2(0.006, -0.010) * (1.0 + 2.0 * lift)) / rect.zw;
  vec2 o = max(max(-sd, sd - 1.0), 0.0) * rect.zw * vec2(aspect(), 1.0);
  col *= 1.0 - 0.55 * smoothstep(0.03 + 0.03 * lift, 0.0, length(o));
  if (any(lessThan(suv, vec2(0.0))) || any(greaterThan(suv, vec2(1.0)))) return col;
  return front ? printView(suv) : paperBack(suv, bathView(suv));
}

void main() {
  vec2 uv = v_uv;
  vec2 q = (uv - 0.5) * vec2(aspect(), 1.0);

  if (u_printPhase == 0) {
    fragColor = vec4(drawTool(bathView(uv), q), 1.0);
    return;
  }

  if (u_printPhase == 1) {
    // Paper laid from the left edge, rolling across the bath
    float t = u_printT;
    float edgeX = mix(-0.08, 1.08, t * t * (3.0 - 2.0 * t)) + 0.04 * (uv.y - 0.5);
    vec3 col = bathView(uv);
    if (uv.x < edgeX) {
      col = paperBack(uv, col);
      col *= 1.0 + 0.05 * smoothstep(edgeX - 0.05, edgeX, uv.x);
    } else {
      col *= 1.0 - 0.35 * smoothstep(edgeX + 0.05, edgeX, uv.x);
    }
    fragColor = vec4(col, 1.0);
    return;
  }

  // Phases 2 and 3: the sheet lifted onto the table and turned over. The
  // sheet keeps the bath's aspect so the print is a true mirror image.
  vec2 size = vec2(1.0 - 2.0 * SHEET_INSET);
  if (u_printPhase == 2) {
    float t = u_printT;
    float shrink = smoothstep(0.0, 0.35, t);
    vec2 sz = mix(vec2(1.0), size, shrink);
    float flip = cos(3.14159265 * smoothstep(0.25, 1.0, t));
    vec2 rsz = vec2(sz.x * abs(flip), sz.y);
    vec4 rect = vec4(0.5 - rsz * 0.5, rsz);
    fragColor = vec4(sheetOnTable(uv, rect, flip < 0.0, 1.0 - abs(flip)), 1.0);
    return;
  }

  vec4 rect = vec4(0.5 - size * 0.5, size);
  fragColor = vec4(sheetOnTable(uv, rect, true, 0.0), 1.0);
}
