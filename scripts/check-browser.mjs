import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const artifacts = resolve(process.env.ARTIFACT_DIR ?? '/tmp/gl-demo-garden-checks');
await mkdir(artifacts, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4187, strictPort: true } });
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
let assertions = 0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Own the animation clock so screenshots and pixel comparisons test simulation
  // behavior rather than machine speed. Preserve readback only in this test page.
  await page.addInitScript(() => {
    let now = 0, nextId = 0;
    const frames = new Map();
    Object.defineProperty(performance, 'now', { value: () => now });
    window.requestAnimationFrame = callback => { frames.set(++nextId, callback); return nextId; };
    window.cancelAnimationFrame = id => frames.delete(id);
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
      return getContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
    };
    window.gardenStep = (count = 1) => {
      for (let i = 0; i < count; i++) {
        now += 1000 / 60;
        const pending = [...frames.values()];
        frames.clear();
        pending.forEach(callback => callback(now));
      }
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 2166136261;
      for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
      return { hash: hash >>> 0, width: canvas.width, height: canvas.height, error: gl.getError() };
    };
  });
  const step = (count = 1) => page.evaluate(n => window.gardenStep(n), count);
  const go = async id => {
    // A hash-only goto preserves the existing document and drawer preference.
    // Start a new document when testing viewport-specific initial state.
    await page.goto('about:blank');
    await page.goto(`http://127.0.0.1:4187/#${id}`);
    await page.locator('#demo-select option').first().waitFor({ state: 'attached' });
  };
  await go('wobbly-cells');
  check(await page.getByLabel('Density', { exact: true }).evaluate(input => input.labels[0]?.control === input),
    'Visible slider label is associated with the range rather than its output');
  await page.locator('.param-slider').filter({ has: page.getByLabel('Density', { exact: true }) }).locator('span').click();
  check(await page.getByLabel('Density', { exact: true }).evaluate(input => document.activeElement === input),
    'Clicking the visible slider label focuses the range');
  await page.getByLabel('Animation', { exact: true }).selectOption('freeze');
  const frozen = await step();
  check((await step(3)).hash === frozen.hash, 'Cells Freeze keeps the rendered field stable');
  await page.getByRole('button', { name: 'Hide interface', exact: true }).click();
  check(await page.locator('#garden-ui').isHidden(), 'Hide removes navigation and all controls');
  const hidden = await step();
  check(hidden.width === frozen.width && hidden.height === frozen.height && hidden.hash === frozen.hash,
    'Hiding UI preserves canvas dimensions and simulation pixels');
  await page.screenshot({ path: `${artifacts}/cells-hidden.png` });
  await page.keyboard.press('h');
  check(await page.locator('#garden-ui').isVisible(), 'H restores controls');
  await page.locator('#drawer-toggle').click();
  check(await page.locator('#garden-drawer').isHidden(), 'Drawer collapses separately');
  check((await step()).hash === frozen.hash, 'Collapsing the drawer preserves the simulation');
  await page.locator('#drawer-toggle').click();
  await page.getByLabel('Density', { exact: true }).fill('6.25');
  check(await page.getByLabel('Density', { exact: true }).evaluate(el => el.parentElement.querySelector('output').value) === '6.25',
    'Slider output preserves quarter-step precision');
  await page.getByLabel('Density', { exact: true }).focus();
  await page.keyboard.press('h');
  check(await page.locator('#garden-ui').isHidden(), 'H works while a range slider has focus');
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  check(await page.getByLabel('Density', { exact: true }).inputValue() === '6', 'Restart restores defaults');

  await go('turing-patterns');
  await page.getByLabel('Playback', { exact: true }).selectOption('paused');
  const paused = await step();
  check((await step(4)).hash === paused.hash, 'Paused chemistry holds its pixels');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  const emptyPattern = await step();
  await page.mouse.click(600, 300);
  const planted = await step();
  check(planted.hash !== emptyPattern.hash, 'Plant brush works while paused');
  check((await step(4)).hash === planted.hash, 'A tap is consumed once');
  await page.getByRole('button', { name: 'Step', exact: true }).click();
  const stepped = await step();
  check(stepped.hash !== planted.hash, 'Step evolves the planted pattern');
  check((await step(4)).hash === stepped.hash, 'Step stays paused afterward');
  await page.getByLabel('Recipe', { exact: true }).selectOption('divide');
  check(await page.getByLabel('Feed rate', { exact: true }).inputValue() === '0.0367', 'Recipe synchronizes precise chemistry controls');

  await go('ripple-drop');
  // Animated film grain must not satisfy a motion assertion on its own.
  await page.getByLabel('Finish', { exact: true }).selectOption('drawing');
  await page.getByLabel('Hand drawn', { exact: true }).fill('0');
  await page.getByLabel('Line boil', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  const emptyPond = await step();
  await page.mouse.click(600, 300);
  await step(29);
  const ringFrames = [];
  for (let i = 0; i < 4; i++) ringFrames.push((await step()).hash);
  check(new Set(ringFrames).size === 4, 'Ripple changes on every 60Hz sample, without cel-clock holds');
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  check((await step(4)).hash === emptyPond.hash, 'Clear pond restores exact background and stops rain');
  await page.getByLabel('Mark', { exact: true }).selectOption('spiral');
  await page.mouse.click(600, 300);
  check((await step(30)).hash !== ringFrames[0], 'Explicit spiral tool renders a different mark');
  await page.screenshot({ path: `${artifacts}/ripple-tools.png` });

  await go('stone-break');
  const intactStone = await step();
  await page.mouse.click(600, 300);
  const struckStone = await step(60);
  check(struckStone.hash !== intactStone.hash, 'A strike grows visible cracks');
  for (let i = 0; i < 4; i++) { await page.mouse.click(600, 300); await step(); }
  const brokenStone = await step(180);
  check(brokenStone.hash !== struckStone.hash, 'Repeated strikes separate the fragments');
  await page.getByRole('button', { name: 'Reassemble', exact: true }).click();
  check((await step(60)).hash === intactStone.hash, 'Reassembly restores the exact intact slab');
  await page.getByRole('button', { name: 'New stone', exact: true }).click();
  check((await step()).hash !== intactStone.hash, 'New stone changes the slab');

  await go('bubble-physics');
  await step(30);
  await page.getByLabel('Playback', { exact: true }).selectOption('paused');
  const pausedBubbles = await step();
  check((await step(5)).hash === pausedBubbles.hash, 'Paused bubbles hold both water and surfaces');
  await page.getByLabel('Bubble size', { exact: true }).fill('1.6');
  const largerBubbles = await step();
  check(largerBubbles.hash !== pausedBubbles.hash, 'Size changes affect existing visible bubbles');
  await page.getByRole('button', { name: 'Release cluster', exact: true }).click();
  check((await step()).hash !== largerBubbles.hash, 'Release cluster immediately adds bubbles');
  await page.getByRole('button', { name: 'New stream', exact: true }).click();
  const newBubbles = await step();
  check(newBubbles.hash !== pausedBubbles.hash, 'New stream generates a new arrangement');
  check((await step(5)).hash === newBubbles.hash, 'New stream preserves paused playback');

  // Navigate all demos in one session: resource teardown and shared UI ownership.
  const ids = await page.locator('#demo-select option').evaluateAll(options => options.map(option => option.value));
  check(JSON.stringify([...ids].sort()) === JSON.stringify([
    'bubble-physics', 'paper-marbling', 'ripple-drop', 'sea-melt', 'searchlights',
    'stone-break', 'turing-patterns', 'wobbly-cells',
  ]), 'Gallery contains the eight retained/replacement demos');
  for (const id of [...ids, 'wobbly-cells']) {
    await page.locator('#demo-select').selectOption(id);
    await page.waitForFunction(value => location.hash === `#${value}`, id);
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    const frame = await step(2);
    check(frame.error === 0, `${id} renders without a WebGL error`);
    check(await page.locator('.param-panel').count() === 1, `${id} cleans up the previous panel`);
  }
  await page.evaluate(() => { location.hash = '__proto__'; });
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
  check(await page.locator('#demo-select').inputValue() === 'wobbly-cells', 'Unknown hash preserves active demo');
  await step();
  await page.screenshot({ path: `${artifacts}/desktop-tools.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await go('wobbly-cells');
  await step();
  check(await page.locator('#garden-drawer').isHidden(), 'Mobile starts with tools collapsed');
  await page.screenshot({ path: `${artifacts}/mobile-collapsed.png` });
  await page.locator('#drawer-toggle').click();
  check(await page.locator('#garden-drawer').isVisible(), 'Mobile tools open on tap');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile has no horizontal overflow');
  await page.getByRole('button', { name: 'Clear lens', exact: true }).scrollIntoViewIfNeeded();
  const bounds = await page.getByRole('button', { name: 'Clear lens', exact: true }).boundingBox();
  check(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844, 'Bottom tools are reachable by scrolling');
  await page.locator('#garden-drawer').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: `${artifacts}/mobile-tools.png` });
  await page.getByRole('button', { name: 'Hide interface', exact: true }).click();
  check(await page.getByRole('button', { name: 'Show controls', exact: true }).isVisible(), 'Mobile retains a touch restore control');
  for (const id of ['stone-break', 'searchlights', 'bubble-physics']) {
    await go(id);
    const frame = await step(3);
    check(frame.error === 0, `${id} renders on a portrait canvas`);
    check(await page.locator('#garden-drawer').isHidden(), `${id} starts unobstructed on mobile`);
    await page.screenshot({ path: `${artifacts}/mobile-${id}.png` });
  }
  for (const retired of ['laser-bird', 'glass-water']) {
    await go(retired);
    await step();
    check(await page.locator('#demo-select').inputValue() === 'wobbly-cells', `${retired} bookmark returns to the gallery`);
    check(new URL(page.url()).hash === '#wobbly-cells', `${retired} bookmark is normalized`);
  }
  await go('lighthouse-vigil');
  check(await page.locator('#demo-select').inputValue() === 'searchlights', 'Former lighthouse bookmark opens Searchlights');
  check(new URL(page.url()).hash === '#searchlights', 'Former lighthouse bookmark is normalized');
  check(errors.length === 0, `No browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ assertions, demos: ids.length, renderer: 'Chromium / SwiftShader', artifacts }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
