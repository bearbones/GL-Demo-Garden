#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "./background.glsl"

in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform int u_palette;

void main() {
  vec2 uvA = vec2(v_uv.x * u_resolution.x / u_resolution.y, v_uv.y);
  fragColor = vec4(paintedPond(v_uv, uvA, u_palette), 1.0);
}
