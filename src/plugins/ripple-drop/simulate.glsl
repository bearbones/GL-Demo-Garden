#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_state;    // .r = current height, .g = previous height
uniform vec2 u_resolution;    // simulation texture size
uniform float u_damping;      // wave damping factor (0.990 - 0.999)
uniform float u_waveSpeed;    // wave propagation speed
uniform vec2 u_dropPos;       // normalized position of new drop (-1 = none)
uniform float u_dropStrength; // impulse strength for new drop

void main() {
  vec2 texel = 1.0 / u_resolution;

  // Sample current and neighbor heights
  float h  = texture(u_state, v_uv).r;          // current height
  float hp = texture(u_state, v_uv).g;          // previous height
  float hL = texture(u_state, v_uv + vec2(-texel.x, 0.0)).r;
  float hR = texture(u_state, v_uv + vec2( texel.x, 0.0)).r;
  float hU = texture(u_state, v_uv + vec2(0.0,  texel.y)).r;
  float hD = texture(u_state, v_uv + vec2(0.0, -texel.y)).r;

  // Discrete 2D wave equation: h_next = 2h - h_prev + c^2 * laplacian(h)
  float laplacian = (hL + hR + hU + hD) - 4.0 * h;
  float c2 = u_waveSpeed * u_waveSpeed;
  float hNext = 2.0 * h - hp + c2 * laplacian;

  // Damping
  hNext *= u_damping;

  // Add drop impulse
  if (u_dropPos.x >= 0.0) {
    float dist = length(v_uv - u_dropPos);
    float impulse = u_dropStrength * exp(-dist * dist * 800.0);
    hNext += impulse;
  }

  // Store: .r = new height (becomes "current" next frame), .g = old current (becomes "previous")
  fragColor = vec4(hNext, h, 0.0, 1.0);
}
