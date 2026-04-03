#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_prevState;   // previous heightfield (ping-pong read)
uniform vec2 u_resolution;
uniform float u_damping;         // wave damping factor
uniform float u_waveSpeed;       // wave propagation speed
uniform vec2 u_impulsePos;       // normalized click position (-1 if none)
uniform float u_impulseStrength; // impulse magnitude

void main() {
  vec2 texel = 1.0 / u_resolution;

  // Current and neighbor heights from previous state
  // .r = current height, .g = previous height
  vec4 state = texture(u_prevState, v_uv);
  float h = state.r;
  float hPrev = state.g;

  // Laplacian (4-neighbor stencil)
  float hL = texture(u_prevState, v_uv + vec2(-texel.x, 0.0)).r;
  float hR = texture(u_prevState, v_uv + vec2( texel.x, 0.0)).r;
  float hU = texture(u_prevState, v_uv + vec2(0.0,  texel.y)).r;
  float hD = texture(u_prevState, v_uv + vec2(0.0, -texel.y)).r;
  float laplacian = (hL + hR + hU + hD) - 4.0 * h;

  // Wave equation: h_next = 2h - h_prev + c^2 * laplacian - damping
  float c2 = u_waveSpeed * u_waveSpeed;
  float hNext = 2.0 * h - hPrev + c2 * laplacian;
  hNext *= u_damping;

  // Apply impulse if click happened
  if (u_impulsePos.x >= 0.0) {
    float dist = length(v_uv - u_impulsePos);
    float impulse = u_impulseStrength * exp(-dist * dist * 800.0);
    hNext += impulse;
  }

  // Store: .r = new height, .g = old height (for next frame's velocity term)
  fragColor = vec4(hNext, h, 0.0, 1.0);
}
