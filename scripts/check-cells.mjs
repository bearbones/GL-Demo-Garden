// Run with: node scripts/check-cells.mjs
// This numerical oracle checks candidate coverage, not GPU/CPU float identity.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shader = readFileSync(new URL('../src/plugins/wobbly-cells/fragment.glsl', import.meta.url), 'utf8');
const controls = readFileSync(new URL('../src/plugins/wobbly-cells/index.ts', import.meta.url), 'utf8');
const capture = (text, pattern) => {
  const match = text.match(pattern);
  assert.ok(match, `Shader or control contract changed: ${pattern}`);
  return match.slice(1).map(Number);
};
const [wobbleLimit] = capture(shader, /min\(u_wobble, ([\d.]+)\)/);
const [searchRadius, searchEnd] = capture(shader, /for \(int x = -(\d+); x <= (\d+); x\+\+\)/);
assert.deepEqual(capture(shader, /for \(int y = -(\d+); y <= (\d+); y\+\+\)/), [searchRadius, searchEnd]);
assert.equal(searchRadius, searchEnd);
const [wobbleMin, wobbleMax] = capture(controls, /label: 'Wobble', min: ([\d.]+), max: ([\d.]+)/);
const [strengthMin, strengthMax] = capture(controls, /label: 'Lens strength', min: ([\d.]+), max: ([\d.]+)/);
const [radiusMin, radiusMax] = capture(controls, /label: 'Lens radius', min: ([\d.]+), max: ([\d.]+)/);
assert.equal(wobbleMin, 0);
assert.equal(wobbleMax, wobbleLimit);
assert.ok(wobbleLimit < 0.5 && strengthMin === 0 && strengthMax < 1 && radiusMin > 0);
// Fail visibly if the spatial model changes without updating this oracle.
assert.ok(shader.includes('vec2 cellWorld = neighbor + offset;'));
assert.ok(!/cellWorld\s*[+\-*/]=/.test(shader));
assert.ok(shader.includes('uv += fromMouse * u_lens * exp(-dot(fromMouse, fromMouse) / (u_radius * u_radius));'));
assert.ok(shader.includes('vec2 cellId = floor(uv);'));
assert.ok(shader.includes('vec2 neighbor = cellId + vec2(x, y);'));
const [base, frequency, variation, phase] = capture(shader,
  /vec2 offset = ([\d.]+) \+ min\(u_wobble, [\d.]+\) \* sin\(u_time \* \(([\d.]+) \+ rnd \* ([\d.]+)\) \+ rnd \* ([\d.]+)\)/);
assert.equal(base, 0.5, 'The coverage proof assumes centers oscillate around tile centers');
assert.ok(shader.indexOf('vec2 cellId = floor(uv);') > shader.indexOf('uv += fromMouse'));
const hashCoefficients = capture(shader, /p = vec2\(dot\(p, vec2\(([\d.]+), ([\d.]+)\)\), dot\(p, vec2\(([\d.]+), ([\d.]+)\)\)\)/);
const [hashScale] = capture(shader, /return fract\(sin\(p\) \* ([\d.]+)\)/);

// At least the home center and one adjacent center lie inside this radius.
// Every omitted site must be farther away, independent of its random phase.
const nearestTwoBound = Math.hypot(1 + wobbleLimit, 0.5 + wobbleLimit);
const excludedBound = searchRadius + base - wobbleLimit;
assert.ok(nearestTwoBound < excludedBound, 'Search radius no longer guarantees both nearest centers');

let state = 0x5ea1c311;
const random = () => ((state = (Math.imul(1664525, state) + 1013904223) >>> 0) / 4294967296);
const fract = value => value - Math.floor(value);
const hash = (x, y) => [
  fract(Math.sin(x * hashCoefficients[0] + y * hashCoefficients[1]) * hashScale),
  fract(Math.sin(x * hashCoefficients[2] + y * hashCoefficients[3]) * hashScale),
];
const cases = 24000;
let oldNearestMisses = 0, oldSecondMisses = 0, newMisses = 0;
for (let i = 0; i < cases; i++) {
  const origin = [Math.floor(random() * 32) - 16, Math.floor(random() * 24) - 12];
  const query = [origin[0] + (i % 4 < 2 ? (i % 2 ? 1 - 1e-7 : 1e-7) : random()), origin[1] + random()];
  const mouse = query.map(value => value + (random() - 0.5) * 8);
  const time = random() * 300;
  const wobble = i % 3 === 0 ? wobbleLimit : random() * wobbleLimit;
  const radius = radiusMin + random() * (radiusMax - radiusMin);
  const strength = (random() * 2 - 1) * strengthMax;
  const fromMouse = query.map((value, axis) => value - mouse[axis]);
  const lens = strength * Math.exp(-(fromMouse[0] ** 2 + fromMouse[1] ** 2) / radius ** 2);
  const warped = query.map((value, axis) => value + fromMouse[axis] * lens);

  function errors(point, original) {
    const center = point.map(Math.floor), oracle = [], local = [];
    const localRadius = original ? 1 : searchRadius;
    const oracleRadius = Math.max(5, searchRadius + 3);
    for (let y = -oracleRadius; y <= oracleRadius; y++) {
      for (let x = -oracleRadius; x <= oracleRadius; x++) {
        const id = [center[0] + x, center[1] + y], rnd = hash(...id);
        const site = id.map((value, axis) => value + base + (original ? 0.4 : wobble)
          * Math.sin(time * (frequency + rnd[axis] * variation) + rnd[axis] * phase));
        if (original) {
          // Original 3x3 search + displaced sites: a deliberate negative control.
          const dx = mouse[0] - site[0], dy = mouse[1] - site[1];
          const attraction = 0.6 * Math.exp(-(dx * dx + dy * dy) * 0.15);
          site[0] += dx * attraction;
          site[1] += dy * attraction;
        }
        const distance = (point[0] - site[0]) ** 2 + (point[1] - site[1]) ** 2;
        oracle.push(distance);
        if (Math.abs(x) <= localRadius && Math.abs(y) <= localRadius) local.push(distance);
      }
    }
    oracle.sort((a, b) => a - b);
    local.sort((a, b) => a - b);
    return [Math.abs(local[0] - oracle[0]), Math.abs(local[1] - oracle[1])];
  }
  const old = errors(query, true), fixed = errors(warped, false);
  if (old[0] > 1e-10) oldNearestMisses++;
  if (old[1] > 1e-10) oldSecondMisses++;
  if (fixed.some(error => error > 1e-10)) newMisses++;
}
assert.equal(newMisses, 0, 'Current neighborhood missed a nearest center');
assert.ok(oldNearestMisses > 0 && oldSecondMisses > 0, 'Negative control did not reproduce original bug');
console.log(JSON.stringify({ cases, searchRadius, wobbleLimit, nearestTwoBound, excludedBound,
  oldNearestMisses, oldSecondMisses, newMisses }, null, 2));
