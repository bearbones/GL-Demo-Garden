#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_scale;
uniform float u_wobble;
uniform float u_seam;
uniform float u_glow;
uniform float u_radius;
uniform float u_lens;
uniform int u_palette;
uniform float u_seed;

// Hash function for pseudo-random cell centers
vec2 hash(vec2 p) {
  p += u_seed;
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

void main() {
  vec2 aspect = vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 uv = v_uv * aspect;
  vec2 mouse = u_mouse * aspect;

  uv *= u_scale;
  mouse *= u_scale;

  // A continuous lens bends the sample domain instead of moving centers out
  // of their lattice tiles. Its strength stays below 1, so neither gather
  // nor spread folds the domain over itself.
  vec2 fromMouse = uv - mouse;
  uv += fromMouse * u_lens * exp(-dot(fromMouse, fromMouse) / (u_radius * u_radius));

  // Voronoi
  vec2 cellId = floor(uv);
  float minDist = 1e9;
  float secondDist = 1e9;
  vec3 cellSeed = vec3(0.0);
  vec2 closestCellWorld = vec2(0.0);

  // Centers stay in [0.05, 0.95] of their home tile. The home center and a
  // center across the nearest vertical tile edge are both within 1.734;
  // every center omitted by this 5x5 window is at least 2.05 away. Thus both
  // nearest centers remain available across integer sample boundaries.
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 neighbor = cellId + vec2(x, y);
      vec2 rnd = hash(neighbor);

      // Wobble the cell centers over time
      vec2 offset = 0.5 + min(u_wobble, 0.45) * sin(u_time * (0.8 + rnd * 0.7) + rnd * 6.2831);
      vec2 cellWorld = neighbor + offset;

      vec2 local = uv - cellWorld;
      float d = dot(local, local);
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
  minDist = sqrt(minDist);
  secondDist = sqrt(secondDist);

  // Edge detection from distance difference
  float diff = secondDist - minDist;
  float aa = max(fwidth(diff), 0.0001);
  float edge = smoothstep(u_seam - aa, u_seam + aa, diff);

  // Neon/pastel palette: high lightness floor so colors never go dark.
  // cos(...) produces [-1, 1]; we remap to [0.55, 1.0] for a bright base.
  vec3 hueA = 0.775 + 0.225 * cos(6.2831 * (cellSeed + vec3(0.0, 0.33, 0.67)) + u_time * 0.3);
  // Second color: hue-shifted partner for an intra-cell gradient.
  vec3 hueB = 0.775 + 0.225 * cos(6.2831 * (cellSeed + vec3(0.15, 0.48, 0.82)) + u_time * 0.3 + 1.9);
  vec3 edgeColor = vec3(0.92, 0.94, 0.98);
  if (u_palette == 1) {
    hueA = mix(vec3(0.12, 0.43, 0.51), vec3(0.60, 0.91, 0.78), cellSeed.x);
    hueB = mix(vec3(0.26, 0.67, 0.70), vec3(0.83, 0.94, 0.72), cellSeed.y);
    edgeColor = vec3(0.87, 0.96, 0.90);
  } else if (u_palette == 2) {
    hueA = mix(vec3(0.86, 0.34, 0.36), vec3(0.98, 0.76, 0.54), cellSeed.x);
    hueB = mix(vec3(0.94, 0.56, 0.47), vec3(0.99, 0.88, 0.70), cellSeed.y);
    edgeColor = vec3(1.0, 0.94, 0.82);
  } else if (u_palette == 3) {
    hueA = mix(vec3(0.10, 0.14, 0.18), vec3(0.25, 0.32, 0.36), cellSeed.x);
    hueB = mix(vec3(0.17, 0.22, 0.25), vec3(0.37, 0.44, 0.45), cellSeed.y);
    edgeColor = vec3(0.90, 0.89, 0.82);
  }

  // Per-cell gradient direction, slowly rotating.
  float ang = 6.2831 * cellSeed.z + u_time * 0.25;
  vec2 gradDir = vec2(cos(ang), sin(ang));

  // Project local offset onto the gradient direction, normalise to ~[0, 1].
  vec2 local = uv - closestCellWorld;
  float t = clamp(dot(local, gradDir) * 1.2 + 0.5, 0.0, 1.0);
  t = smoothstep(0.0, 1.0, t);

  vec3 baseColor = mix(hueA, hueB, t);

  vec3 color = mix(edgeColor, baseColor, edge);

  // Subtle inner glow, tinted by the gradient.
  color += u_glow * exp(-minDist * 4.0) * baseColor;

  fragColor = vec4(color, 1.0);
}
