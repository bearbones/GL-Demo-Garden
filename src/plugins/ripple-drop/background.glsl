// A held background painting: broad horizontal washes, soft reflected foliage,
// and faint pigment tooth. No time or frame coordinates enter this layer.
// Requires noise.glsl. Eight simplex evaluations per pixel; no octave loop.
vec3 paintedPond(vec2 uv, vec2 uvA, int palette) {
  vec3 deep = vec3(0.105, 0.160, 0.235);
  vec3 body = vec3(0.205, 0.290, 0.365);
  vec3 wash = vec3(0.310, 0.395, 0.455);
  vec3 shade = vec3(0.085, 0.135, 0.190);
  if (palette == 1) {
    deep = vec3(0.080, 0.145, 0.145);
    body = vec3(0.155, 0.255, 0.235);
    wash = vec3(0.285, 0.365, 0.305);
    shade = vec3(0.070, 0.120, 0.120);
  } else if (palette == 2) {
    deep = vec3(0.165, 0.225, 0.285);
    body = vec3(0.265, 0.335, 0.385);
    wash = vec3(0.370, 0.435, 0.470);
    shade = vec3(0.140, 0.200, 0.245);
  }

  // Brush direction matters more than a fractal cloud field. The large forms
  // belong to the composition; the noise only softens their painted edges.
  float broad = snoise(uvA * vec2(1.4, 4.8) + vec2(4.8, 17.3));
  float drag = snoise(uvA * vec2(2.3, 31.0) + vec2(13.4, 9.2));
  float dry = snoise(uvA * vec2(7.0, 108.0) + vec2(31.7, 2.4));
  float scumble = snoise(uvA * vec2(19.0, 43.0) + vec2(8.1, 29.6));
  float outline = snoise(vec2(uv.x * 8.0, 23.6));
  float broken = snoise(uvA * vec2(3.5, 48.0) + vec2(62.5, 1.8));
  float pigment = snoise(uvA * 235.0 + vec2(2.3, 41.5));
  float tooth = snoise(uvA * 590.0 + vec2(37.8, 19.2));

  vec3 color = mix(deep, body, 0.54 + 0.22 * uv.y + broad * 0.10);
  float y = uv.y + 0.012 * broad + 0.004 * scumble;

  // Three wide, overlapping brush passes. Their different slopes and lengths
  // avoid regular bands; the lightest pass leaves breathing room for the ink.
  float lowerPass = smoothstep(0.13, 0.23, y + uv.x * 0.035)
                  * (1.0 - smoothstep(0.33, 0.43, y + uv.x * 0.035));
  float middlePass = smoothstep(0.38, 0.47, y - uv.x * 0.050)
                   * (1.0 - smoothstep(0.62, 0.70, y - uv.x * 0.050));
  middlePass *= smoothstep(0.02, 0.30, uv.x)
              * (1.0 - smoothstep(0.80, 1.10, uv.x));
  float upperPass = smoothstep(0.68, 0.76, y + uv.x * 0.020)
                  * (1.0 - smoothstep(0.84, 0.93, y + uv.x * 0.020));
  color = mix(color, wash, lowerPass * 0.10 + middlePass * 0.24 + upperPass * 0.10);

  // Blunt canopy shapes reflected at the sides and back of the pond. These
  // are deliberately low-contrast paint masses, not a second outlined scene.
  float edgeRoughness = 0.020 * outline + 0.010 * scumble;
  float leftEdge = 0.08 + 0.105 * smoothstep(0.30, 0.90, uv.y)
                 + 0.035 * sin(uv.y * 13.0 + 0.8) + edgeRoughness;
  float rightEdge = 0.94 - 0.13 * smoothstep(0.38, 0.92, uv.y)
                  + 0.030 * sin(uv.y * 16.0 + 2.1) - edgeRoughness;
  float leftCanopy = 1.0 - smoothstep(leftEdge - 0.025, leftEdge + 0.055, uv.x);
  float rightCanopy = smoothstep(rightEdge - 0.055, rightEdge + 0.025, uv.x);
  float canopy = max(leftCanopy, rightCanopy) * smoothstep(0.16, 0.62, uv.y);
  float backEdge = 0.89 + 0.025 * sin(uv.x * 10.0 + 0.3) + edgeRoughness;
  float backCanopy = smoothstep(backEdge - 0.055, backEdge + 0.035, uv.y);
  // Horizontal interruptions read as reflected brush marks instead of clouds.
  float reflectionBreaks = 0.70 + 0.30 * smoothstep(-0.35, 0.55, broken + drag * 0.35);
  color = mix(color, shade, max(canopy * 0.55, backCanopy * 0.25) * reflectionBreaks);

  // Uneven pigment loading is held with the painting, separate from the film
  // grain added later. Fine tooth is derivative-filtered on small viewports.
  float toothFootprint = max(length(dFdx(uvA)), length(dFdy(uvA))) * 590.0;
  float toothVisible = 1.0 - smoothstep(0.45, 1.20, toothFootprint);
  color += vec3(0.012, 0.013, 0.013) * drag;
  color += vec3(0.0050, 0.0055, 0.0055) * dry;
  color += vec3(0.0035) * pigment + vec3(0.0020) * tooth * toothVisible;
  return clamp(color, 0.0, 1.0);
}

vec3 rippleInk(int palette) {
  if (palette == 1) return vec3(0.920, 0.920, 0.815);
  if (palette == 2) return vec3(0.875, 0.910, 0.915);
  return vec3(0.880, 0.920, 0.925);
}
