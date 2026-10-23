#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform sampler2D u_background;
void main() {
  vec4 paint = texture(u_background, v_uv);
  // The sRGB ink attachment encodes this linear output after blending.
  vec3 linear = mix(pow((paint.rgb + 0.055) / 1.055, vec3(2.4)),
                    paint.rgb / 12.92, lessThanEqual(paint.rgb, vec3(0.04045)));
  fragColor = vec4(linear, paint.a);
}
