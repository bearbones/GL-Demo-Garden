#version 300 es

// Per-vertex: unit quad corners
layout(location = 0) in vec2 a_corner;   // (-1,-1) to (1,1)

// Per-instance: bubble data
layout(location = 1) in vec4 a_bubble;   // (x, y, radius, opacity)  — all in pixels

uniform vec2 u_resolution;

out vec2 v_local;    // local coordinate within quad (-1 to 1)
out float v_opacity;

void main() {
  float x      = a_bubble.x;
  float y      = a_bubble.y;
  float radius = a_bubble.z;
  v_opacity    = a_bubble.w;
  v_local      = a_corner;

  // Expand quad corner by radius, offset by bubble position
  vec2 pos = vec2(x, y) + a_corner * (radius + 1.0); // +1 for soft edge

  // Convert pixel coords to clip space (origin top-left → NDC)
  vec2 ndc = (pos / u_resolution) * 2.0 - 1.0;
  ndc.y = -ndc.y; // flip Y: pixel y-down → NDC y-up

  gl_Position = vec4(ndc, 0.0, 1.0);
}
