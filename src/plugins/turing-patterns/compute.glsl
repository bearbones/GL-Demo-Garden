#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;
uniform vec2 u_texelSize;
uniform float u_feed;
uniform float u_kill;
uniform float u_dt;
uniform vec2 u_mouse;
uniform float u_mouseDown;

void main() {
  // Sample current state: r=A concentration, g=B concentration
  vec4 state = texture(u_state, v_uv);
  float A = state.r;
  float B = state.g;

  // 9-point Laplacian stencil (weighted, more isotropic)
  vec2 tx = u_texelSize;
  vec4 L  = texture(u_state, v_uv + vec2(-tx.x,  0.0));
  vec4 R  = texture(u_state, v_uv + vec2( tx.x,  0.0));
  vec4 U  = texture(u_state, v_uv + vec2( 0.0,   tx.y));
  vec4 D  = texture(u_state, v_uv + vec2( 0.0,  -tx.y));
  vec4 LU = texture(u_state, v_uv + vec2(-tx.x,  tx.y));
  vec4 RU = texture(u_state, v_uv + vec2( tx.x,  tx.y));
  vec4 LD = texture(u_state, v_uv + vec2(-tx.x, -tx.y));
  vec4 RD = texture(u_state, v_uv + vec2( tx.x, -tx.y));

  float lapA = 0.2 * (L.r + R.r + U.r + D.r) + 0.05 * (LU.r + RU.r + LD.r + RD.r) - 1.0 * A;
  float lapB = 0.2 * (L.g + R.g + U.g + D.g) + 0.05 * (LU.g + RU.g + LD.g + RD.g) - 1.0 * B;

  // Gray-Scott reaction-diffusion
  float dA = 1.0;    // Diffusion rate for A
  float dB = 0.5;    // Diffusion rate for B
  float reaction = A * B * B;

  float newA = A + (dA * lapA - reaction + u_feed * (1.0 - A)) * u_dt;
  float newB = B + (dB * lapB + reaction - (u_kill + u_feed) * B) * u_dt;

  // Mouse seeds chemical B
  float mouseDist = length(v_uv - u_mouse);
  float seed = u_mouseDown * 0.9 * exp(-mouseDist * mouseDist * 800.0);
  newB += seed;

  fragColor = vec4(clamp(newA, 0.0, 1.0), clamp(newB, 0.0, 1.0), 0.0, 1.0);
}
