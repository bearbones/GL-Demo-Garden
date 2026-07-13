#version 300 es
precision highp float;

// Fracture Modes model: stamps revealed sections of a precomputed
// weakest-path polyline into the damage field as thin capsules.
// The paths themselves are found on the CPU (Dijkstra through a seeded
// toughness grid) when the slab is baked; strikes only reveal them.

in vec2 v_uv;
out vec4 fragColor;

const int MAX_SEGS = 24;

uniform sampler2D u_state;
uniform vec4 u_segs[MAX_SEGS];      // segment endpoints (a.xy, b.xy), aspect-corrected uv
uniform float u_segDepth[MAX_SEGS]; // stamp depth per segment
uniform int u_segCount;
uniform float u_width;              // capsule half-width, units of frame height
uniform float u_aspect;

void main() {
  vec4 st = texture(u_state, v_uv);
  vec2 p = vec2(v_uv.x * u_aspect, v_uv.y);

  float d = st.r;
  for (int i = 0; i < MAX_SEGS; i++) {
    if (i >= u_segCount) break;
    vec2 a = u_segs[i].xy;
    vec2 b = u_segs[i].zw;
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    float dist = length(pa - ba * h);
    d = max(d, u_segDepth[i] * smoothstep(u_width, u_width * 0.25, dist));
  }

  fragColor = vec4(d, st.g, 0.0, 1.0);
}
