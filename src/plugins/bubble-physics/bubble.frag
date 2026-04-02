#version 300 es
precision highp float;

in vec2 v_local;
in float v_opacity;

out vec4 fragColor;

void main() {
  float dist = length(v_local);

  // Discard outside circle
  if (dist > 1.0) discard;

  // Soft edge
  float alpha = smoothstep(1.0, 0.85, dist) * v_opacity;

  // Base bubble color: pale blue-white
  vec3 color = vec3(0.55, 0.75, 0.9);

  // Rim brightening (Fresnel-like)
  float rim = smoothstep(0.5, 0.95, dist);
  color += vec3(0.15, 0.2, 0.25) * rim;

  // Inner gradient: slightly darker toward bottom for 3D depth
  float shade = 1.0 - v_local.y * 0.15;
  color *= shade;

  // Specular highlight: small bright dot near top-left
  vec2 highlightCenter = vec2(-0.3, -0.35);
  float highlightDist = length(v_local - highlightCenter);
  float highlight = smoothstep(0.25, 0.05, highlightDist) * 0.7;
  color += vec3(highlight);

  // Secondary smaller highlight
  vec2 h2 = vec2(-0.15, -0.5);
  float hd2 = length(v_local - h2);
  color += vec3(smoothstep(0.12, 0.02, hd2) * 0.3);

  fragColor = vec4(color, alpha);
}
