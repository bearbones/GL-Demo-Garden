#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
void main() {
  vec2 p=(v_uv-0.5)*vec2(u_resolution.x/u_resolution.y,1.0);
  float pool=exp(-dot(p*vec2(0.9,1.1),p*vec2(0.9,1.1))*2.3);
  vec3 color=mix(vec3(0.055,0.069,0.072),vec3(0.15,0.18,0.18),pool);
  color+=(hash(floor(gl_FragCoord.xy))-0.5)*0.012;
  fragColor=vec4(color,1.0);
}
