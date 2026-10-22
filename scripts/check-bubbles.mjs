// Standalone deterministic dynamics checks; no browser or dev server needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/plugins/bubble-physics/simulation.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } });
const { BubbleSimulation, BUBBLE_STEP, MAX_BUBBLES } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));

function run(schedule, seconds = 12) {
  const sim = new BubbleSimulation(1.6, 12345);
  let elapsed = 0, frame = 0;
  while (elapsed < seconds - 1e-10) {
    const dt = Math.min(schedule[frame++ % schedule.length], seconds - elapsed);
    sim.advance(dt);
    elapsed += dt;
  }
  return sim;
}
const reference = run([1 / 60]);
let maxScheduleDifference = 0;
for (const schedule of [[1 / 30], [1 / 144], [0.019, 0.007, 0.038, 0.011, 0.025]]) {
  const sim = run(schedule);
  assert.equal(sim.bubbles.length, reference.bubbles.length, 'spawn/removal counts depend only on elapsed simulation time');
  assert.equal(sim.time, reference.time, 'all schedules execute the same fixed steps');
  for (let i = 0; i < sim.bubbles.length; i++) {
    for (const key of Object.keys(reference.bubbles[i])) {
      const difference = Math.abs(sim.bubbles[i][key] - reference.bubbles[i][key]);
      maxScheduleDifference = Math.max(maxScheduleDifference, difference);
      assert.ok(difference < 1e-10, `schedule differs at bubble ${i}, ${key}: ${difference}`);
    }
  }
}

function isolated(radius) {
  const sim = new BubbleSimulation(1.6, 7);
  sim.bubbles.length = 0;
  sim.settings.release = 0;
  sim.settings.flow = 0;
  const bubble = sim.emit(0.8, 0.1, radius);
  for (let i = 0; i < 120; i++) sim.advance(1 / 60);
  return { sim, bubble };
}
const small = isolated(0.015), large = isolated(0.055);
assert.ok(large.bubble.y > small.bubble.y + 0.1, 'larger bubbles visibly rise faster');
assert.ok(large.bubble.qx > small.bubble.qx, 'larger rising bubbles flatten more');
const originalRadius = small.bubble.radius;
small.sim.setSize(1.5);
assert.equal(small.bubble.radius, originalRadius * 1.5, 'size changes affect existing bubbles');

const contact = new BubbleSimulation(1.6, 9);
contact.bubbles.length = 0;
contact.settings.release = 0;
contact.settings.flow = 0;
const a = contact.emit(0.8, 0.5, 0.04), b = contact.emit(0.8, 0.5, 0.04);
contact.advance(BUBBLE_STEP);
const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
const contactExtent = contact.support(a, dx / distance, dy / distance) + contact.support(b, dx / distance, dy / distance);
assert.ok(distance > 0 && contactExtent - distance < 0.04 * a.radius, 'coincident bubbles separate without singular normals');
assert.ok(a.contactX < 0 && b.contactX < 0, 'side contact compresses both bubbles in the contact direction');
assert.ok(a.qx < a.pqx, 'contact immediately begins a visible deformation response');
const contactQx = a.qx;
for (let i = 0; i < 120; i++) contact.advance(BUBBLE_STEP);
assert.ok(a.qx > contactQx, 'the shape recovers as contact pressure subsides');

const held = new BubbleSimulation(1.6, 10);
held.bubbles.length = 0;
held.settings.release = 0;
held.settings.flow = 0;
const sheltered = held.emit(0.8, 0.4, 0.035);
held.setPointer(0.8, 0.52, true);
for (let i = 0; i < 120; i++) held.advance(BUBBLE_STEP);
assert.ok(sheltered.y < 0.46, 'a stationary pressure surface holds a rising bubble beneath it');
const heldY = sheltered.y;
held.setPointer(0.8, 0.52, false);
for (let i = 0; i < 120; i++) held.advance(BUBBLE_STEP);
assert.ok(sheltered.y > heldY + 0.12, 'release restores the bubble\'s upward motion');

const stress = new BubbleSimulation(1.6, 22);
stress.settings.release = 12;
stress.settings.flow = 2;
stress.settings.rise = 1.75;
stress.setSize(1.6);
let maxSpeed = 0, maxShape = 0, maxCount = 0;
for (let frame = 0; frame < 1200; frame++) {
  const t = frame / 60;
  stress.setPointer(0.8 + 0.52 * Math.sin(t * 1.2), 0.48 + 0.30 * Math.cos(t * 1.7), true);
  if (frame % 120 === 0) stress.releaseCluster();
  stress.advance(1 / 60);
  assert.ok(stress.bubbles.length <= MAX_BUBBLES);
  maxCount = Math.max(maxCount, stress.bubbles.length);
  for (const bubble of stress.bubbles) {
    for (const value of Object.values(bubble)) assert.ok(Number.isFinite(value), 'all bubble state remains finite under stirring/contact');
    const shape = Math.hypot(bubble.qx, bubble.qy), speed = Math.hypot(bubble.vx, bubble.vy);
    maxShape = Math.max(shape, maxShape); maxSpeed = Math.max(speed, maxSpeed);
    assert.ok(shape <= 0.30000001, 'deformation stays inside the explicit surface bound');
    assert.ok(speed < 6, 'contacts and stirring never create runaway velocity');
    assert.ok(bubble.x > -0.2 && bubble.x < stress.aspect + 0.2);
  }
}
stress.setPointer(0, 0, false);
stress.resize(0.46);
for (let i = 0; i < 120; i++) stress.advance(1 / 60);
for (const bubble of stress.bubbles) assert.ok(Number.isFinite(bubble.x + bubble.y + bubble.qx + bubble.qy), 'portrait resize remains finite');

console.log(JSON.stringify({ fixedStep: BUBBLE_STEP, elapsedSeconds: reference.time, comparedSchedules: ['60 Hz', '30 Hz', '144 Hz', 'jittered'], maxScheduleDifference,
  riseAfterTwoSeconds: { smallY: small.bubble.y, largeY: large.bubble.y }, coincidentContactPenetration: contactExtent - distance,
  heldThenReleasedRise: sheltered.y - heldY, stressSeconds: 20, maxSpeed, maxShape, maxCount, checks: 'passed' }, null, 2));
