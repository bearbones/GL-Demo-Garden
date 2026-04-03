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

  // 5-point Laplacian stencil
  vec4 L = texture(u_state, v_uv + vec2(-u_texelSize.x, 0.0));
  vec4 R = texture(u_state, v_uv + vec2( u_texelSize.x, 0.0));
  vec4 U = texture(u_state, v_uv + vec2(0.0,  u_texelSize.y));
  vec4 D = texture(u_state, v_uv + vec2(0.0, -u_texelSize.y));

  float lapA = (L.r + R.r + U.r + D.r) - 4.0 * A;
  float lapB = (L.g + R.g + U.g + D.g) - 4.0 * B;

  // Gray-Scott reaction-diffusion
  float dA = 0.5;   // Diffusion rate for A
  float dB = 0.25;  // Diffusion rate for B
  float reaction = A * B * B;

  float newA = A + (dA * lapA - reaction + u_feed * (1.0 - A)) * u_dt;
  float newB = B + (dB * lapB + reaction - (u_kill + u_feed) * B) * u_dt;

  // Mouse seeds chemical B
  float mouseDist = length(v_uv - u_mouse);
  float seed = u_mouseDown * 0.9 * exp(-mouseDist * mouseDist * 800.0);
  newB += seed;

  fragColor = vec4(clamp(newA, 0.0, 1.0), clamp(newB, 0.0, 1.0), 0.0, 1.0);
}
