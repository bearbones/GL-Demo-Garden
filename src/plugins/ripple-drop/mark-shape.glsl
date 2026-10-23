// Shared geometry for the instance bounds and their ink. Coordinates use
// canvas-height units; arrival is the instant the head reaches the pond.
float rainSpeed(float seed) { return 0.95 + seed * 0.45; }
float rainLength(float seed) { return 0.075 + seed * 0.075; }
vec2 rainHead(vec4 mark, float time, float aspect) {
  return vec2(mark.x * aspect, mark.y)
       + vec2(-0.10, 1.0) * (mark.z - time) * rainSpeed(fract(mark.w));
}
float rippleRadius(vec4 mark) {
  float kind = floor(mark.w), seed = fract(mark.w);
  return (kind < 0.5 ? 0.080 : kind < 1.5 ? 0.175 : 0.16)
       * mix(1.20, 0.65, mark.y) * (0.80 + 0.40 * seed);
}
vec2 rippleCenter(vec4 mark, float time, float aspect) {
  float seed = fract(mark.w);
  return vec2(mark.x * aspect, mark.y)
       + vec2(cos(seed * 37.0), sin(seed * 37.0) * 0.35) * (time - mark.z) * 0.003;
}
