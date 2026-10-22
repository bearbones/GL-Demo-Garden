#version 300 es
precision highp float;
#include "./water.glsl"
in vec2 v_local;
in vec2 v_world;
flat in vec4 v_bubble;
flat in vec4 v_surface;
uniform vec2 u_resolution;
uniform float u_time;
out vec4 fragColor;
void main() {
  float angle = length(v_local) > 1e-6 ? atan(v_local.y, v_local.x) : 0.0;
  // Low surface modes are driven by the spring's recovery after contact.
  float flex = v_surface.w * (0.65 * cos(angle * 3.0 + v_bubble.w + u_time * 2.4)
                             + 0.35 * sin(angle * 2.0 - u_time * 1.8));
  vec2 q = v_local / (1.0 + flex);
  float r = length(q);
  float aa = clamp(1.0 / (v_bubble.z * u_resolution.y), 0.005, 0.12);
  if (r > 1.0 + aa) discard;
  float z = sqrt(max(1.0 - min(r * r, 1.0), 0.0));
  float deformation = length(v_surface.xy);
  float stretch = exp(deformation);
  float tilt = deformation > 1e-6 ? 0.5 * atan(v_surface.y, v_surface.x) : 0.0;
  float c = cos(tilt), s = sin(tilt);
  mat2 rotation = mat2(c, s, -s, c);
  vec3 n = normalize(vec3(rotation * (q / vec2(stretch, 1.0 / stretch)), z));
  vec3 ray = refract(vec3(0.0, 0.0, -1.0), n, 1.333);
  float reflected = smoothstep(0.66, 0.85, r);
  vec2 offset = mix(ray.xy / max(abs(ray.z), 0.35) * v_bubble.z * 0.42,
                    -n.xy * v_bubble.z * 0.65, smoothstep(0.64, 0.74, r));
  float aspect = u_resolution.x / u_resolution.y;
  vec3 color = waterColor(v_world + offset, aspect, u_time);
  float fresnel = pow(1.0 - z, 2.8);
  color *= 1.0 - 0.10 * reflected - 0.08 * fresnel;
  color += vec3(0.008, 0.024, 0.025) * z;
  vec3 mirror = reflect(vec3(0.0, 0.0, -1.0), n);
  // The broad overhead light bends into an interior crescent. Unlike a
  // painted dot, the reflection follows the deformed surface normal.
  float reflectionBand = exp(-pow((mirror.y - 0.80) / 0.18, 2.0))
                       * smoothstep(-0.75, 0.35, -mirror.x);
  color += vec3(0.55, 0.80, 0.75) * reflectionBand * 0.23;
  color += vec3(0.12, 0.32, 0.40) * pow(max(-mirror.y, 0.0), 3.0) * 0.12;

  // Broad reflected arcs and a thin meniscus replace the old painted dots.
  vec2 direction = normalize(n.xy + vec2(1e-5));
  float upper = pow(max(dot(direction, normalize(vec2(-0.55, 0.83))), 0.0), 3.0);
  float lower = pow(max(dot(direction, normalize(vec2(0.55, -0.83))), 0.0), 5.0);
  float rim = exp(-pow((r - 0.965) / max(0.024, aa * 0.75), 2.0));
  float crescent = exp(-pow((r - 0.86) / 0.105, 2.0));
  color += vec3(0.70, 0.92, 0.88) * rim * (0.12 + upper * 0.88 + lower * 0.38);
  color += vec3(0.28, 0.56, 0.58) * crescent * upper * 0.38;
  color += vec3(0.08, 0.27, 0.32) * crescent * lower * 0.22;
  // A dark inner edge gives the air/water interface depth at grazing angles.
  color *= 1.0 - exp(-pow((r - 0.87) / 0.05, 2.0)) * reflected * 0.12;
  float alpha = (1.0 - smoothstep(1.0 - aa, 1.0 + aa, r)) * v_surface.z;
  fragColor = vec4(color, alpha);
}
