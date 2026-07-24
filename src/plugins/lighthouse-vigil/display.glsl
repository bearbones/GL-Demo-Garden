#version 300 es
precision highp float;

#include "../../shaders/lib/noise.glsl"
#include "../../shaders/lib/sdf2d.glsl"
#include "../../shaders/lib/anime-style.glsl"

in vec2 v_uv;
out vec4 fragColor;

uniform float u_time;
uniform vec2  u_resolution;
uniform float u_beamSpeed;
uniform float u_beamWidth;
uniform float u_swell;
uniform float u_haze;

const float PI  = 3.14159265;
const float TAU = 6.28318530;

// ── Palette ────────────────────────────────────────────────────────
const vec3 SKY_TOP     = vec3(0.018, 0.028, 0.072);
const vec3 SKY_HAZE    = vec3(0.070, 0.090, 0.160);
const vec3 MOON_SILVER = vec3(0.93, 0.96, 1.00);
const vec3 MOONLIGHT   = vec3(0.60, 0.68, 0.86);
const vec3 BEAM_WARM   = vec3(1.00, 0.87, 0.55);
const vec3 WATER_DEEP  = vec3(0.012, 0.040, 0.085);
const vec3 WATER_MID   = vec3(0.055, 0.115, 0.195);
const vec3 WATER_LIT   = vec3(0.105, 0.175, 0.265);
const vec3 ROCK_DARK   = vec3(0.045, 0.048, 0.070);
const vec3 INK         = vec3(0.008, 0.010, 0.020);

const float HORIZON = -0.10;

// Scene anchors, set once in main() (x positions scale with aspect)
float g_cliffL, g_cliffR;
vec2  g_moon, g_lantern, g_boatPos;
mat2  g_boatR;

// ── Cliff heightfield (implicit: >0 above rock) ────────────────────
float cliffField(vec2 p) {
  float wob = fbm3(p * 2.6 + 7.3) * 0.055;
  float x = p.x + wob;
  float rise = smoothstep(g_cliffL, g_cliffR, x);
  float h = mix(-0.55, 0.165, rise);
  h += fbm3(vec2(x * 9.0, 3.7)) * 0.018 * rise;
  return p.y - h;
}

// ── Rotating beam ──────────────────────────────────────────────────
// The lens rotates in the horizontal plane; on screen the beam sweeps
// left/right and blooms into a flash when it faces the viewer.
// Returns vec2(volumetric fog term, surface lighting term).
vec2 beamTerms(vec2 p) {
  vec2 v = p - g_lantern;
  float r = length(v);
  float ang = atan(v.y, v.x);
  float c = cos(u_time * u_beamSpeed);
  float ac = abs(c);
  // A slightly down-tilted lens rotating in the horizontal plane: the
  // projected slope steepens as the beam swings toward the viewer, so each
  // rotation the beam dives down across the near water (and the boat).
  float slope = -0.12 / max(ac, 0.18);
  float axis = atan(slope, sign(c));
  float dAng = abs(mod(ang - axis + PI, TAU) - PI);
  float flashK = pow(clamp(1.0 - ac, 0.0, 1.0), 6.0);
  float halfW = u_beamWidth * (0.55 + 0.45 * ac) / max(ac, 0.16);
  float wedge  = 1.0 - smoothstep(halfW * 0.45, halfW, dAng);
  float fringe = (1.0 - smoothstep(halfW, halfW * 3.2, dAng)) * 0.30;
  float fall = exp(-r * 1.35);
  float fog = 0.72 + 0.28 * fbm3(p * 3.0 + vec2(-u_time * 0.18, u_time * 0.03));
  float streak = 0.85 + 0.15 * snoise(vec2(r * 9.0 - u_time * 1.6, dAng * 30.0));
  float facing = 0.62 + 0.38 * ac + 1.4 * flashK;
  float vol = (wedge + fringe) * fall * fog * streak * facing;
  float surf = (1.0 - smoothstep(halfW * 0.6, halfW * 1.2, dAng))
             * exp(-r * 1.0) * (0.7 + 0.3 * ac + flashK);
  return vec2(vol, surf);
}

// ── Boat SDFs (boat-local space, origin at hull midline) ───────────
float sdTriangle(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}

const float BOAT_S = 1.25;

float hullSD(vec2 q) { return max(sdCircle(q - vec2(0.0, 0.105), 0.132), q.y - 0.012); }
float mastSD(vec2 q) { return sdLine(q, vec2(0.0, 0.012), vec2(0.0, 0.175)) - 0.0042; }
float sailSD(vec2 q) { return sdTriangle(q, vec2(0.010, 0.030), vec2(0.010, 0.162), vec2(0.104, 0.036)); }
float jibSD(vec2 q)  { return sdTriangle(q, vec2(-0.010, 0.026), vec2(-0.010, 0.150), vec2(-0.094, 0.028)); }
float boomSD(vec2 q) { return sdLine(q, vec2(0.004, 0.026), vec2(0.112, 0.031)) - 0.0035; }

float boatField(vec2 wp) {
  vec2 q = g_boatR * (wp - g_boatPos) / BOAT_S;
  float d = min(hullSD(q), min(mastSD(q), sailSD(q)));
  return min(d, min(jibSD(q), boomSD(q))) * BOAT_S;
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;
  vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time;
  float px = 1.5 / u_resolution.y;

  // Scene anchors
  g_cliffL  = aspect * 0.145;
  g_cliffR  = aspect * 0.245;
  g_moon    = vec2(-aspect * 0.30, 0.315);
  float bx  = aspect * 0.335;
  g_lantern = vec2(bx, 0.393);

  float rock = u_swell * (0.14 * sin(t * 0.85) + 0.06 * sin(t * 1.53 + 1.2));
  float bob  = u_swell * (0.012 * sin(t * 0.85 + 0.9) + 0.007 * sin(t * 1.31 + 2.0));
  g_boatPos = vec2(-aspect * 0.21, -0.265 + bob);
  float cr = cos(rock), sr = sin(rock);
  g_boatR = mat2(cr, -sr, sr, cr);

  // Water line with gentle chop
  float chop = u_swell * (0.0055 * sin(p.x * 9.0 + t * 1.15)
                        + 0.0045 * snoise(vec2(p.x * 4.0 - t * 0.32, 2.0)));
  float wl = HORIZON + chop;
  float waterMask = smoothstep(px, -px, p.y - wl);

  float c = cos(t * u_beamSpeed);
  float flashK = pow(clamp(1.0 - abs(c), 0.0, 1.0), 6.0);

  vec2 bt = beamTerms(p);

  // ── Sky ──────────────────────────────────────────────────────────
  float skyT = clamp((p.y - HORIZON) / (0.5 - HORIZON), 0.0, 1.0);
  vec3 sky = mix(SKY_HAZE, SKY_TOP, pow(skyT, 0.75));
  float moonD = length(p - g_moon);
  sky += MOONLIGHT * 0.16 * exp(-moonD * 3.2);

  // Clouds: two warped fbm layers posterized into hard-edged cel shapes —
  // slate cores, a lining band on every edge that silvers near the moon,
  // and a warm glow wherever the beam is currently passing through them.
  vec2 cq = vec2(p.x * 0.85 - t * 0.014, p.y * 2.0);
  vec2 cw = vec2(snoise(cq * 1.6 + 3.1), snoise(cq * 1.6 + 9.4)) * 0.10;
  float cd = fbm3(cq + cw) * 0.62 + fbm3(cq * 2.4 + vec2(17.0, -t * 0.02)) * 0.38;
  float cMask = smoothstep(0.20, 0.24, cd) * smoothstep(0.06, 0.18, skyT);
  float cCore = smoothstep(0.30, 0.42, cd);
  float lining = smoothstep(0.20, 0.235, cd) * (1.0 - smoothstep(0.235, 0.29, cd));
  float nearMoon = exp(-moonD * 1.8);
  vec3 cCol = mix(vec3(0.060, 0.072, 0.115), vec3(0.028, 0.034, 0.065), cCore);
  cCol += MOONLIGHT * lining * (0.035 + 0.80 * nearMoon);
  cCol += BEAM_WARM * min(bt.x, 1.2) * 0.55;
  sky = mix(sky, cCol, cMask * 0.95);

  // Stars (occluded by cloud)
  vec2 sgv = p * 26.0;
  vec2 cell = floor(sgv);
  float sh = hash21(cell);
  vec2 soff = (hash22(cell) - 0.5) * 0.6;
  float sd = length(fract(sgv) - 0.5 - soff);
  float tw = 0.55 + 0.45 * sin(t * 2.2 + sh * 40.0);
  float star = smoothstep(0.045, 0.0, sd) * step(0.82, sh) * tw;
  star *= smoothstep(0.02, 0.12, skyT) * (1.0 - exp(-moonD * 2.5) * 0.9) * (1.0 - cMask);
  sky += MOON_SILVER * star * 0.8;

  // Moon disc with posterized maria
  float moonR = 0.062;
  float mD = moonD - moonR;
  float moonMask = smoothstep(px, -px, mD);
  float crater = smoothstep(0.15, 0.45, fbm3(p * 24.0 + 11.0));
  vec3 moonCol = mix(MOON_SILVER, MOON_SILVER * 0.80, crater * 0.7);
  moonCol *= 0.94 + 0.06 * smoothstep(moonR, -moonR, p.x - g_moon.x);
  sky += MOONLIGHT * softGlow(mD, 0.55, 9.0) * (1.0 - moonMask);
  vec3 col = mix(sky, moonCol, moonMask);

  // ── Water ────────────────────────────────────────────────────────
  float depth = max(wl - p.y, 0.0);
  float persp = 1.0 / (depth + 0.055);
  vec2 wuv = vec2(p.x * (0.55 + persp * 0.18), persp * 0.85 + t * 0.22);
  float wn = fbm3(wuv * 2.2) * 0.5 + 0.5;
  wn += 0.18 * sin(persp * 3.0 - t * 1.1 + p.x * 2.0);
  float band = floor(clamp(wn, 0.0, 1.0) * 4.0 + 0.5) / 4.0;
  vec3 waterCol = mix(WATER_DEEP, WATER_MID, band);
  waterCol = mix(waterCol, WATER_LIT, smoothstep(0.16, 0.0, depth) * 0.5);

  // Moon glitter path — silver dashes widening toward the viewer
  float gW = 0.05 + depth * 0.30;
  float gMask = smoothstep(gW, gW * 0.35, abs(p.x - g_moon.x * 0.96));
  float dash = step(0.76, 0.5 + 0.5 * snoise(vec2(p.x * (40.0 + depth * 90.0), persp * 7.0 + t * 1.3)));
  float glit = gMask * dash * smoothstep(0.0, 0.03, depth) * smoothstep(0.34, 0.10, depth);
  waterCol += MOON_SILVER * glit * 0.40;

  // Beam catching the swell: glints ride the quantized wave bands, so the
  // pool of light inherits the water's cel steps instead of flat-filling.
  waterCol += BEAM_WARM * clamp(bt.y * 1.5, 0.0, 1.0) * (0.08 + 0.55 * band * band);
  vec2 rp = vec2(p.x + snoise(vec2(p.y * 12.0, t * 0.7)) * 0.006 * u_swell, 2.0 * wl - p.y);
  waterCol += BEAM_WARM * beamTerms(rp).x * (0.4 + 0.6 * band) * 0.18 * u_haze * exp(-depth * 3.0);

  col = mix(col, waterCol, waterMask);

  // ── Cliff & lighthouse masks (needed to occlude the beam) ────────
  float cf = cliffField(p);
  float cliffMask = smoothstep(px, -px, cf) * smoothstep(wl - 0.012, wl + 0.004, p.y);

  float baseY = 0.090, topY = 0.360;
  float ty = clamp((p.y - baseY) / (topY - baseY), 0.0, 1.0);
  float hw = mix(0.056, 0.031, ty);
  float towerD = max(abs(p.x - bx) - hw, max(baseY - p.y, p.y - topY));
  float galD   = max(abs(p.x - bx) - 0.046, max(0.360 - p.y, p.y - 0.372));
  float roomD  = max(abs(p.x - bx) - 0.026, max(0.372 - p.y, p.y - 0.412));
  float ry = clamp((p.y - 0.412) / 0.048, 0.0, 1.0);
  float roofD  = max(abs(p.x - bx) - mix(0.034, 0.003, ry), max(0.412 - p.y, p.y - 0.460));
  float lhD = min(min(towerD, galD), min(roomD, roofD));
  float lhMask = smoothstep(px, -px, lhD);

  vec2 e = vec2(0.004, 0.0);
  vec2 mlDir = normalize(g_moon - p);

  // ── Volumetric beam over sky and sea ─────────────────────────────
  float beamVis = bt.x * (1.0 - cliffMask) * (1.0 - lhMask)
                * smoothstep(wl - 0.005, wl + 0.012, p.y);
  col += BEAM_WARM * beamVis * u_haze;

  // ── Lighthouse (drawn first — the cliff crest then occludes its base,
  // so the tower rises from behind the rock instead of floating on it) ──
  float stripe = mod(floor((p.y - baseY) / 0.054), 2.0);
  vec3 lhBase = mix(vec3(0.80, 0.82, 0.88), vec3(0.45, 0.15, 0.17), stripe);
  // Pseudo-cylindrical cel shading: moon key from the left with a hard
  // three-step terminator rolling into core shadow on the right, plus a
  // silver edge highlight just inside the moonlit rim.
  float cyl = clamp((p.x - bx) / max(hw, 1e-4), -1.0, 1.0);
  float lam = clamp(0.52 - 0.62 * cyl, 0.0, 1.0);
  float shadeBand = floor(lam * 3.0 + 0.34) / 3.0;
  vec3 towerCol = lhBase * (0.10 + 0.38 * shadeBand);
  towerCol += MOONLIGHT * 0.15 * shadeBand;
  towerCol += MOON_SILVER * 0.22 * smoothstep(0.30, 0.08, abs(cyl + 0.78));
  // Warm underglow spilling down the shaft from the lantern room
  float lg = exp(-length(p - g_lantern) * 4.5) * (0.75 + 1.5 * flashK);
  towerCol += BEAM_WARM * floor(clamp(lg, 0.0, 1.0) * 3.0) / 3.0 * 0.30;
  // Lit keeper's windows down the shaft
  for (int i = 0; i < 3; i++) {
    float wy = 0.150 + float(i) * 0.068;
    float wD = length(vec2((p.x - bx) * 1.7, p.y - wy)) - 0.013;
    towerCol = mix(towerCol, vec3(0.030, 0.028, 0.048), smoothstep(px, -px, wD));
    towerCol += BEAM_WARM * 0.75 * smoothstep(0.002, -0.006, wD);
  }
  vec3 galleryCol = vec3(0.030, 0.032, 0.050);
  vec3 roofCol = vec3(0.050, 0.055, 0.085)
               + MOONLIGHT * 0.30 * smoothstep(0.004, -0.018, p.x - bx);
  float mull = step(0.72, abs(sin((p.x - bx) * 260.0)));
  vec3 roomCol = BEAM_WARM * (1.05 + 0.8 * flashK) * (1.0 - mull * 0.75);

  vec3 lhCol = towerCol;
  lhCol = mix(lhCol, galleryCol, smoothstep(px, -px, galD));
  lhCol = mix(lhCol, roomCol,    smoothstep(px, -px, roomD));
  lhCol = mix(lhCol, roofCol,    smoothstep(px, -px, roofD));
  col = mix(col, lhCol, lhMask);
  col = mix(col, INK, smoothstep(px * 2.0, px * 0.5, abs(lhD)) * 0.85);

  // Gallery railing: posts and a handrail silhouetted around the lantern
  float railX = smoothstep(0.048, 0.044, abs(p.x - bx)) * smoothstep(0.026, 0.030, abs(p.x - bx));
  float railBand = smoothstep(0.372, 0.375, p.y) * smoothstep(0.402, 0.398, p.y);
  float posts = step(0.92, abs(sin((p.x - bx) * 500.0)));
  float handrail = smoothstep(px * 1.6, px * 0.4, abs(p.y - 0.400))
                 * smoothstep(0.048, 0.044, abs(p.x - bx));
  col = mix(col, INK * 1.4, clamp(railBand * railX * posts + handrail, 0.0, 1.0) * 0.9);

  // ── Cliff in silvery repose (over the tower base — grounds it) ───
  vec2 cn = normalize(vec2(cliffField(p + e.xy) - cf, cliffField(p + e.yx) - cf) + 1e-5);
  float dif = clamp(dot(cn, mlDir), 0.0, 1.0);
  float moonBand = floor(dif * 3.0 + 0.35) / 3.0;
  float rockTex = floor((fbm3(p * 6.5 + 3.0) * 0.5 + 0.5) * 3.0) / 3.0;
  vec3 cliffCol = ROCK_DARK * (0.55 + rockTex * 0.5);
  cliffCol += MOONLIGHT * moonBand * 0.34 * (0.6 + 0.4 * rockTex);
  float crest = smoothstep(-0.012, -0.001, cf) * step(0.35, dif);
  cliffCol += MOONLIGHT * crest * 0.4;
  cliffCol += BEAM_WARM * floor(clamp(bt.y * 1.8, 0.0, 1.0) * 2.0) / 2.0 * 0.25
            * clamp(dot(cn, normalize(g_lantern - p)), 0.0, 1.0);
  cliffCol += BEAM_WARM * 0.10 * exp(-length(p - vec2(bx, 0.16)) * 6.0);
  // Moon-cast shadow of the tower falling across the headland
  vec2 sdir = normalize(vec2(1.0, -0.20));
  vec2 srel = p - vec2(bx, 0.10);
  float along = dot(srel, sdir);
  float perpd = abs(dot(srel, vec2(-sdir.y, sdir.x)));
  float shad = step(0.02, along) * smoothstep(0.055, 0.042, perpd) * smoothstep(0.60, 0.20, along);
  cliffCol *= 1.0 - shad * 0.5;
  cliffCol *= 0.5 + 0.5 * smoothstep(wl, wl + 0.25, p.y);
  col = mix(col, cliffCol, cliffMask);
  col = mix(col, INK, smoothstep(px * 2.2, px * 0.4, abs(cf)) * 0.8
                    * smoothstep(wl, wl + 0.02, p.y));

  // Surf breaking at the cliff base
  float foamN = snoise(vec2(p.x * 40.0 - t * 0.8, p.y * 40.0));
  float foam = smoothstep(0.035, 0.0, abs(p.y - wl))
             * smoothstep(0.12, 0.01, abs(cf)) * step(0.0, foamN);
  col += MOON_SILVER * foam * 0.4;

  // Lantern glow + flash flare (after the cliff so it blooms over the crest)
  float lr = length(p - g_lantern);
  col += BEAM_WARM * softGlow(lr, 0.30 + 0.9 * flashK, 26.0);
  col += BEAM_WARM * flashK * exp(-abs(p.y - g_lantern.y) * 40.0) * exp(-lr * 2.2) * 1.2;

  // ── Boat ─────────────────────────────────────────────────────────
  vec2 q = g_boatR * (p - g_boatPos) / BOAT_S;
  float hD    = hullSD(q) * BOAT_S;
  float mD2   = mastSD(q) * BOAT_S;
  float sD    = sailSD(q) * BOAT_S;
  float jD    = jibSD(q) * BOAT_S;
  float boomD = boomSD(q) * BOAT_S;
  float bD = min(min(hD, boomD), min(mD2, min(sD, jD)));
  float boatMask = smoothstep(px, -px, bD);

  // Wobbly dark reflection of hull + mast, drawn beneath the boat first
  // (a mirrored sail reads as a blob, so the canvas stays out of it)
  float bwl = g_boatPos.y - 0.015;
  vec2 rp2 = vec2(p.x + snoise(vec2(p.y * 18.0, t * 0.8)) * 0.004, 2.0 * bwl - p.y);
  vec2 q2 = g_boatR * (rp2 - g_boatPos) / BOAT_S;
  float rD = min(hullSD(q2), mastSD(q2)) * BOAT_S;
  float rMask = smoothstep(px * 2.0, -px * 2.0, rD)
              * smoothstep(0.0, -0.01, p.y - bwl)
              * smoothstep(0.16, 0.03, bwl - p.y)
              * smoothstep(0.20, 0.13, abs(p.x - g_boatPos.x));
  col = mix(col, INK * 1.6 + WATER_MID * 0.3, rMask * 0.35);

  vec2 nb = normalize(vec2(boatField(p + e.xy) - bD, boatField(p + e.yx) - bD) + 1e-5);
  vec3 bCol;
  float warmGain;
  float sailGlow = 0.0;
  if (bD == sD || bD == jD) {
    bCol = (bD == sD) ? vec3(0.27, 0.29, 0.36) : vec3(0.22, 0.24, 0.31);
    warmGain = 1.0;
    sailGlow = 1.0;
    float seam = smoothstep(0.0026, 0.0008, abs(q.y - 0.064))
               + smoothstep(0.0026, 0.0008, abs(q.y - 0.100))
               + smoothstep(0.0026, 0.0008, abs(q.y - 0.136));
    bCol *= 1.0 - clamp(seam, 0.0, 1.0) * 0.22;
  } else if (bD == mD2 || bD == boomD) {
    bCol = vec3(0.055, 0.050, 0.070);
    warmGain = 0.45;
  } else {
    bCol = vec3(0.075, 0.066, 0.092);
    warmGain = 0.6;
    // painted sheer stripe along the gunwale, dark boot-top at the waterline
    bCol = mix(bCol, vec3(0.34, 0.12, 0.13), smoothstep(0.0030, 0.0012, abs(q.y - 0.004)));
    bCol = mix(bCol, vec3(0.030, 0.028, 0.040), smoothstep(-0.012, -0.020, q.y));
  }
  float beamFace = clamp(dot(nb, normalize(g_lantern - p)), 0.0, 1.0);
  float lightAmt = clamp(bt.y * 2.4, 0.0, 1.0) * (0.30 + 0.70 * beamFace);
  bCol += BEAM_WARM * floor(lightAmt * 3.0 + 0.34) / 3.0 * warmGain * 0.9;
  bCol += BEAM_WARM * min(bt.x, 1.2) * sailGlow * 0.8;  // canvas backlit by the passing beam
  float mif = clamp(dot(nb, mlDir), 0.0, 1.0);
  bCol += MOONLIGHT * floor(mif * 2.0 + 0.45) / 2.0 * 0.20;
  float rim = smoothstep(-0.016, -0.004, bD) * step(0.45, mif);
  bCol += MOONLIGHT * rim * 0.55;
  col = mix(col, bCol, boatMask);
  col = mix(col, INK, smoothstep(px * 2.2, px * 0.5, abs(bD)) * 0.9);

  // Ink dashes of foam at the hull waterline
  float hullWater = smoothstep(0.02, 0.0, abs(p.y - bwl))
                  * smoothstep(0.17, 0.11, abs(p.x - g_boatPos.x));
  float fdash = step(0.35, snoise(vec2(p.x * 55.0 - t * 0.6, p.y * 90.0 + t * 0.9)));
  col += MOON_SILVER * hullWater * fdash * 0.22 * (1.0 - boatMask);

  // ── Grade ────────────────────────────────────────────────────────
  col += BEAM_WARM * flashK * 0.05;
  float vig = smoothstep(1.25, 0.45, length(p * vec2(0.85, 1.15)));
  col *= 0.55 + 0.45 * vig;
  col += (hash21(gl_FragCoord.xy + fract(t)) - 0.5) * 0.015;

  fragColor = vec4(col, 1.0);
}
