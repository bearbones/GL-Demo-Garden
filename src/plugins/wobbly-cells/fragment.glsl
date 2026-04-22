#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

// Hash function for pseudo-random cell centers
vec2 hash(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

void main() {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv * aspect;
  vec2 mouse = u_mouse * aspect;

  float scale = 6.0;
  uv *= scale;
  mouse *= scale;

  // Voronoi
  vec2 cellId = floor(uv);
  float minDist = 1e9;
  float secondDist = 1e9;
  vec3 cellSeed = vec3(0.0);
  vec2 closestCellWorld = vec2(0.0);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = cellId + vec2(x, y);
      vec2 rnd = hash(neighbor);

      // Wobble the cell centers over time
      vec2 offset = 0.5 + 0.4 * sin(u_time * (0.8 + rnd * 0.7) + rnd * 6.2831);

      // Mouse attraction: pull nearby cells toward the mouse
      vec2 cellWorld = neighbor + offset;
      vec2 toMouse = mouse - cellWorld;
      float mouseDist = length(toMouse);
      float attraction = 0.6 * exp(-mouseDist * mouseDist * 0.15);
      cellWorld += toMouse * attraction;

      float d = length(uv - cellWorld);
      if (d < minDist) {
        secondDist = minDist;
        minDist = d;
        cellSeed = vec3(rnd, fract(rnd.x + rnd.y));
        closestCellWorld = cellWorld;
      } else if (d < secondDist) {
        secondDist = d;
      }
    }
  }

  // Edge detection from distance difference
  float diff = secondDist - minDist;
  float aa = fwidth(diff);
  float borderW = 0.04;
  float edge = smoothstep(borderW - aa, borderW + aa, diff);

  // Neon/pastel palette: high lightness floor so colors never go dark.
  // cos(...) produces [-1, 1]; we remap to [0.55, 1.0] for a bright base.
  vec3 hueA = 0.775 + 0.225 * cos(6.2831 * (cellSeed + vec3(0.0, 0.33, 0.67)) + u_time * 0.3);
  // Second color: hue-shifted partner for an intra-cell gradient.
  vec3 hueB = 0.775 + 0.225 * cos(6.2831 * (cellSeed + vec3(0.15, 0.48, 0.82)) + u_time * 0.3 + 1.9);

  // Per-cell gradient direction, slowly rotating.
  float ang = 6.2831 * cellSeed.z + u_time * 0.25;
  vec2 gradDir = vec2(cos(ang), sin(ang));

  // Project local offset onto the gradient direction, normalise to ~[0, 1].
  vec2 local = uv - closestCellWorld;
  float t = clamp(dot(local, gradDir) * 1.2 + 0.5, 0.0, 1.0);
  t = smoothstep(0.0, 1.0, t);

  vec3 baseColor = mix(hueA, hueB, t);

  // Soft pastel edge rather than near-black, keeps overall image light.
  vec3 edgeColor = vec3(0.92, 0.94, 0.98);

  vec3 color = mix(edgeColor, baseColor, edge);

  // Subtle inner glow, tinted by the gradient.
  color += 0.1 * exp(-minDist * 4.0) * baseColor;

  fragColor = vec4(color, 1.0);
}
