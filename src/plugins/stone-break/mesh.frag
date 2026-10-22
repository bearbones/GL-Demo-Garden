#version 300 es
precision highp float;
in vec2 v_surface;
in vec4 v_color;
in float v_kind;
uniform float u_seed;
uniform int u_material;
out vec4 fragColor;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+1.0), f.x), f.y);
}
void main() {
  vec3 color=v_color.rgb;
  if(v_kind > 0.5) {
    vec2 p=v_surface+mod(u_seed,127.0)*0.071;
    float broad=noise(p*6.0), medium=noise(p*29.0), grain=hash(floor(p*460.0));
    vec3 base=vec3(0.63,0.58,0.47);
    if(u_material==1) base=vec3(0.29,0.37,0.39);
    if(u_material==2) base=vec3(0.65,0.43,0.36);
    float layers=sin(p.y*24.0+noise(p*3.0)*3.0);
    color*=base*(0.90+broad*0.10+medium*0.025+noise(p*120.0)*0.045+(grain-0.5)*0.14+layers*0.012);
    color*=1.0+v_surface.y*0.06-v_surface.x*0.025;
    // Dry mineral flecks, restrained enough to leave the fracture legible.
    color+=vec3(0.09,0.085,0.07)*step(0.984,grain);
  }
  fragColor=vec4(color,v_color.a);
}
