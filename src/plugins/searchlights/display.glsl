#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform vec2 u_mouse;
uniform float u_time;
uniform float u_phase;
uniform float u_coneWidth;
uniform float u_haze;
uniform float u_manualAim;
uniform int u_lamps;
uniform int u_layout;
uniform int u_palette;

// This is a light field in a plane, not a ray-marched three-dimensional room.
// Capsule silhouettes, their shadow intersections and lit rims share geometry.
vec2 endsA[3];
vec2 endsB[3];
float radii[3];
int formCount;
float sceneWidth;
float formScale;

float hash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

float noise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(cell), hash(cell + vec2(1, 0)), w.x),
             mix(hash(cell + vec2(0, 1)), hash(cell + vec2(1, 1)), w.x), w.y);
}

float fogNoise(vec2 p) {
  return noise(p) * 0.57 + noise(p * 2.03 + 4.8) * 0.28 + noise(p * 4.11 + 9.3) * 0.15;
}

float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

vec2 closestPoint(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  return a + ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-8), 0.0, 1.0);
}

float pointSegment(vec2 p, vec2 a, vec2 b) { return length(p - closestPoint(p, a, b)); }

float segmentDistance(vec2 a, vec2 b, vec2 c, vec2 d) {
  vec2 ab = b - a;
  vec2 cd = d - c;
  float determinant = cross2(ab, cd);
  // Intersecting segments have zero distance. The endpoint minimum alone
  // misses crossings through a slat's middle and would leak light there.
  if (abs(determinant) > 1e-7) {
    float t = cross2(c - a, cd) / determinant;
    float s = cross2(c - a, ab) / determinant;
    if (t >= 0.0 && t <= 1.0 && s >= 0.0 && s <= 1.0) return 0.0;
  }
  return min(min(pointSegment(a, c, d), pointSegment(b, c, d)),
             min(pointSegment(c, a, b), pointSegment(d, a, b)));
}

void scene() {
  formCount = 3;
  if (u_layout == 0) {
    endsA[0] = endsB[0] = vec2(-0.10 * sceneWidth, 0.025);
    endsA[1] = endsB[1] = vec2(0.19 * sceneWidth, 0.205);
    endsA[2] = endsB[2] = vec2(0.16 * sceneWidth, -0.195);
    radii[0] = 0.086 * formScale;
    radii[1] = 0.063 * formScale;
    radii[2] = 0.043 * formScale;
  } else if (u_layout == 1) {
    endsA[0] = vec2(-0.23 * sceneWidth, 0.02);
    endsB[0] = vec2(0.10 * sceneWidth, 0.10);
    endsA[1] = vec2(-0.05 * sceneWidth, 0.20);
    endsB[1] = vec2(0.25 * sceneWidth, 0.13);
    endsA[2] = vec2(0.02 * sceneWidth, -0.20);
    endsB[2] = vec2(0.20 * sceneWidth, -0.13);
    radii[0] = radii[1] = 0.014 * formScale;
    radii[2] = 0.019 * formScale;
  } else {
    formCount = u_layout == 2 ? 1 : 0;
    endsA[0] = endsB[0] = vec2(0.0, 0.04);
    radii[0] = 0.11 * formScale;
  }
}

float visibility(vec2 source, vec2 p, int skip) {
  float visible = 1.0;
  float distanceToSample = length(p - source);
  for (int j = 0; j < 3; j++) {
    if (j >= formCount) break;
    if (j == skip) continue;
    float gap = segmentDistance(source, p, endsA[j], endsB[j]) - radii[j];
    vec2 middle = (endsA[j] + endsB[j]) * 0.5;
    float distanceToForm = max(length(closestPoint(middle, source, p) - source), 0.03);
    // Approximate aperture softness grows with distance behind the form.
    // This is a distance-based penumbra filter, not sampled area-light transport.
    // Near the form it meets the same antialiased boundary as its silhouette.
    float penumbra = 0.0008 + 0.006 * max(0.0, distanceToSample / distanceToForm - 1.0);
    visible *= smoothstep(-penumbra, penumbra, gap);
  }
  return visible;
}

vec3 lampColor(int i) {
  if (u_palette == 1) {
    if (i == 0) return vec3(0.48, 0.83, 1.0);
    if (i == 1) return vec3(0.52, 1.0, 0.80);
    return vec3(0.90, 0.93, 1.0);
  }
  if (u_palette == 2) {
    if (i == 0) return vec3(1.0, 0.45, 0.54);
    if (i == 1) return vec3(0.50, 0.46, 1.0);
    return vec3(1.0, 0.82, 0.65);
  }
  if (i == 0) return vec3(1.0, 0.79, 0.48);
  if (i == 1) return vec3(0.43, 0.72, 1.0);
  return vec3(0.80, 0.91, 1.0);
}

vec2 lampPosition(int i) {
  if (i == 0) return vec2(-0.43 * sceneWidth, -0.36);
  if (i == 1) return vec2(0.43 * sceneWidth, -0.36);
  return vec2(0.08 * sceneWidth, 0.43);
}

vec2 lampDirection(int i, vec2 source) {
  vec2 target;
  if (i == 0) target = vec2((0.12 + 0.30 * sin(u_phase)) * sceneWidth, 0.30);
  else if (i == 1) target = vec2((-0.16 + 0.27 * sin(u_phase * 0.83 + 0.7)) * sceneWidth, 0.28);
  else target = vec2(0.29 * sceneWidth * sin(u_phase * 0.71 + 2.0), -0.33);
  if (u_manualAim > 0.5) target = (u_mouse - 0.5) * vec2(u_resolution.x / u_resolution.y, 1.0);
  vec2 direction = target - source;
  return length(direction) > 0.002 ? normalize(direction) : vec2(0, i == 2 ? -1 : 1);
}

float beam(vec2 p, vec2 source, vec2 direction) {
  vec2 delta = p - source;
  float distanceToLamp = length(delta);
  float forward = dot(delta, direction);
  float lateral = abs(cross2(delta, direction));
  float width = max(forward, 0.0) * tan(u_coneWidth) + 0.004;
  float edge = 1.0 - smoothstep(width * 0.86, width * 1.09 + 0.001, lateral);
  float core = 0.78 + 0.22 * exp(-3.0 * lateral * lateral / (width * width));
  float falloff = exp(-distanceToLamp * (0.75 + 0.28 * u_haze)) / (0.42 + 0.95 * distanceToLamp);
  return edge * core * falloff * smoothstep(-0.004, 0.012, forward);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  sceneWidth = min(aspect, 1.65);
  formScale = min(aspect / 0.85, 1.0);
  scene();

  vec2 drift = vec2(-u_time * 0.026, u_time * 0.013);
  vec2 warp = vec2(noise(p * 3.1 + drift), noise(p * 3.4 - drift + 6.4)) - 0.5;
  float fog = fogNoise(p * vec2(3.2, 4.4) + drift + warp * 0.7);
  float wisps = noise(p * vec2(8.0, 21.0) + drift * 3.5 + warp);
  float density = (0.24 + 0.76 * fog) * (0.75 + 0.25 * wisps);
  float ambient = 0.35 + 0.65 * exp(-dot(p * vec2(0.85, 1.2), p * vec2(0.85, 1.2)) * 3.0);
  vec3 background = vec3(0.004, 0.0075, 0.014) * ambient;
  background += vec3(0.004, 0.006, 0.009) * fog * u_haze;

  // Sparse motes move continuously with the air; they only shine inside light.
  vec2 dustPosition = p * 92.0 + vec2(u_time * 0.62, -u_time * 0.31);
  vec2 dustCell = floor(dustPosition);
  vec2 dustOffset = fract(dustPosition) - vec2(hash(dustCell + 2.8), hash(dustCell + 7.1));
  float mote = exp(-dot(dustOffset, dustOffset) * 210.0) * step(0.976, hash(dustCell + 19.2));
  vec3 scattering = vec3(0);
  for (int i = 0; i < 3; i++) {
    if (i >= u_lamps) break;
    vec2 source = lampPosition(i);
    vec2 direction = lampDirection(i, source);
    float illumination = beam(p, source, direction) * visibility(source, p, -1);
    scattering += lampColor(i) * illumination * (density * u_haze * 0.82 + mote * 0.46);
  }
  vec3 color = background + scattering;

  // Opaque matte forms, with a narrow bevel that responds to each incident lamp.
  for (int j = 0; j < 3; j++) {
    if (j >= formCount) break;
    vec2 nearest = closestPoint(p, endsA[j], endsB[j]);
    float sd = length(p - nearest) - radii[j];
    float aa = max(fwidth(sd), 0.0004);
    float mask = 1.0 - smoothstep(-aa, aa, sd);
    if (mask > 0.0) {
      vec2 normal = normalize(p - nearest + vec2(1e-8));
      vec3 surface = vec3(0.005, 0.007, 0.011) * (0.75 + 0.25 * normal.y);
      float bevel = exp(-max(-sd, 0.0) / 0.006);
      for (int i = 0; i < 3; i++) {
        if (i >= u_lamps) break;
        vec2 source = lampPosition(i);
        vec2 direction = lampDirection(i, source);
        float diffuse = max(dot(normal, normalize(source - p)), 0.0);
        float incident = beam(p, source, direction) * visibility(source, p, j);
        surface += lampColor(i) * incident * diffuse * bevel * 0.46;
      }
      color = mix(color, surface, mask);
    }
  }

  // Restrained lens glows identify the origins without adding scenic objects.
  for (int i = 0; i < 3; i++) {
    if (i >= u_lamps) break;
    float d = length(p - lampPosition(i));
    float core = exp(-d * d / 0.000025);
    float glow = exp(-d * 95.0) * 0.12;
    color += lampColor(i) * (core * 2.2 + glow);
  }

  color *= 1.0 - 0.25 * smoothstep(0.28, 0.75, length(v_uv - 0.5));
  // Exposure rolloff preserves color in crossing beams instead of clipping white.
  color = 1.0 - exp(-color * 1.20);
  color = pow(max(color, vec3(0)), vec3(1.0 / 2.2));
  color += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(color, 1.0);
}
