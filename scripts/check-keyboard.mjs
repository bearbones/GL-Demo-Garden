import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const artifacts = resolve(process.env.ARTIFACT_DIR ?? '/tmp/gl-demo-garden-keyboard');
await mkdir(artifacts, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4191, strictPort: true } });
const browser = await chromium.launch({ headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const checks = [], errors = [];
const check = (condition, message) => { assert.ok(condition, message); checks.push(message); };
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    let now = 0, id = 0, seed = 4312;
    const callbacks = new Map(), names = new WeakMap();
    const uniforms = {};
    let instances = [];
    Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    Object.defineProperty(performance, 'now', { value: () => now });
    window.requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
    window.cancelAnimationFrame = key => callbacks.delete(key);
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
      return getContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
    };
    const proto = WebGL2RenderingContext.prototype, locate = proto.getUniformLocation;
    proto.getUniformLocation = function(program, name) {
      const location = locate.call(this, program, name);
      if (location) names.set(location, name);
      return location;
    };
    for (const method of ['uniform1f', 'uniform1i', 'uniform2f', 'uniform4f']) {
      const original = proto[method];
      proto[method] = function(location, ...values) {
        if (location) uniforms[names.get(location)] = values;
        return original.call(this, location, ...values);
      };
    }
    const upload = proto.bufferSubData;
    proto.bufferSubData = function(...args) {
      if (args[2] instanceof Float32Array) instances = Array.from(args[2].slice(0, 8));
      return upload.apply(this, args);
    };
    window.keyboardStep = (count, dt) => {
      for (let i = 0; i < count; i++) {
        now += dt * 1000;
        const pending = [...callbacks.values()]; callbacks.clear();
        pending.forEach(callback => callback(now));
      }
      const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const pixels = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let hash = 2166136261;
      for (const value of pixels) hash = Math.imul(hash ^ value, 16777619);
      let paintHash;
      if (document.querySelector('#demo-select').value === 'paper-marbling') {
        // The display adds moving water reflections even over settled paint.
        // Inspect the actual paint texture to distinguish those from a stuck comb.
        const paint = gl.getParameter(gl.TEXTURE_BINDING_2D);
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, paint, 0);
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        paintHash = 2166136261;
        for (const value of pixels) paintHash = Math.imul(paintHash ^ value, 16777619);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(framebuffer);
      }
      return { hash: hash >>> 0, paintHash, uniforms, instances, error: gl.getError() };
    };
  });
  const step = (count = 1, dt = 1 / 60) => page.evaluate(({ count, dt }) => window.keyboardStep(count, dt), { count, dt });
  // Idle settling needs elapsed time, not hundreds of identical display draws.
  const settle = frames => step(Math.ceil(frames / 6), 0.1);
  const select = (label, value) => page.getByLabel(label, { exact: true }).selectOption(value);
  const button = name => page.getByRole('button', { name, exact: true }).click();
  const focus = () => page.locator('canvas').focus();
  const go = async id => {
    console.log(`Checking ${id}`);
    await page.goto('about:blank');
    await page.goto(`http://127.0.0.1:4191/#${id}`);
    await page.locator('#demo-select option').first().waitFor({ state: 'attached' });
    await step();
    check((await page.locator('#keyboard-hint').textContent()).includes('↑'), `${id}: keyboard hint present`);
  };
  const hold = async (key, frames = 60, dt = 1 / 60) => {
    await focus(); await page.keyboard.down(key);
    const result = await step(frames, dt);
    await page.keyboard.up(key);
    check(result.error === 0, `${key}: no WebGL error`);
    return result;
  };
  const capture = async name => {
    await page.locator('#garden-ui').evaluate(el => { el.hidden = true; });
    await page.screenshot({ path: `${artifacts}/${name}.png` });
    await page.locator('#garden-ui').evaluate(el => { el.hidden = false; });
  };

  await go('wobbly-cells');
  await select('Animation', 'freeze');
  const cells = await step();
  const bent = await hold('ArrowRight');
  check(bent.hash !== cells.hash && bent.uniforms.u_mouse[0] > 0.7, 'Cells: keys bend the frozen mosaic to the right');
  await settle(150);
  const settledCells = await settle(60);
  check((await settle(60)).hash === settledCells.hash, 'Cells: released lens settles');
  await capture('wobbly-cells');
  await page.getByLabel('Density', { exact: true }).focus();
  const density = Number(await page.getByLabel('Density', { exact: true }).inputValue());
  await page.keyboard.press('ArrowRight');
  check(Number(await page.getByLabel('Density', { exact: true }).inputValue()) > density, 'Focused range retains native arrow behavior');
  check((await step()).uniforms.u_mouse[0] === settledCells.uniforms.u_mouse[0], 'Focused range does not steer the demo');
  await focus(); await page.keyboard.down('ArrowLeft'); await step(10);
  await page.getByLabel('Palette', { exact: true }).focus(); await settle(180);
  const focused = await settle(60);
  check((await settle(60)).hash === focused.hash, 'Moving focus to a select releases held movement');
  await page.keyboard.up('ArrowLeft');
  await focus(); await page.keyboard.down('ArrowLeft'); await step(10);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await settle(180); const blurred = await settle(60);
  check((await settle(60)).hash === blurred.hash, 'Window blur releases held movement');
  await page.keyboard.up('ArrowLeft');

  await hold('ArrowRight', 8);
  await button('Clear lens'); await settle(120);
  check(Math.abs((await step()).uniforms.u_lens[0]) < 1e-8, 'Clear lens stops keyboard momentum from reactivating it');

  await go('turing-patterns');
  await select('Playback', 'paused'); await button('Clear'); const empty = await step();
  const seed = await hold('ArrowRight');
  check(seed.hash !== empty.hash, 'Turing: keyboard seeds change the actual paused chemistry');
  check((await step(30)).hash === seed.hash, 'Turing: release stops planting without advancing paused chemistry');
  check(await page.locator('.arrow-cursor-seed').isVisible(), 'Turing: seed tip is visible');
  await select('Brush', 'erase');
  const erased = await hold('ArrowLeft');
  check(erased.hash !== seed.hash, 'Turing: keyboard respects Erase');
  await select('Brush', 'seed'); await hold('ArrowDown', 35); await select('Playback', 'live'); await step(45);
  await capture('turing-patterns');

  await go('bubble-physics');
  const natural = await step(60);
  await go('bubble-physics');
  const pushed = await hold('ArrowRight');
  check(pushed.instances[0] > natural.instances[0] + 0.15, 'Bubbles: keyboard current displaces bubbles relative to equal-time idle run');
  await hold('ArrowDown', 50); await capture('bubble-physics');

  await go('ripple-drop');
  await select('Playback', 'paused'); await button('Clear pond'); const pond = await step();
  const wake = await hold('ArrowRight', 60);
  check(wake.hash !== pond.hash, 'Ripple: skating leaves actual ink in the paused pond');
  check((await step(30)).hash === wake.hash, 'Ripple: paused wake holds on release');
  await select('Playback', 'live'); await hold('ArrowDown', 30); await hold('ArrowLeft', 30);
  const skaterBefore = await page.locator('.arrow-cursor-skater').evaluate(el => parseFloat(el.style.left));
  await step(10);
  const skaterAfter = await page.locator('.arrow-cursor-skater').evaluate(el => parseFloat(el.style.left));
  check(skaterAfter < skaterBefore, 'Ripple: skater coasts after release');
  await capture('ripple-drop');

  await go('sea-melt');
  const calmSea = await step(60);
  await go('sea-melt');
  const surge = await hold('ArrowRight');
  check(surge.hash !== calmSea.hash && surge.uniforms.u_tide[0] > 0.1, 'Sea: tide visibly changes the equal-time foam field');
  const reversed = await hold('ArrowLeft', 45);
  check(reversed.uniforms.u_tide[2] < 0 && reversed.uniforms.u_turn[0] < 0, 'Sea: reversal turns the current and bends the foam');
  await capture('sea-melt');
  const calm = await settle(240);
  check(Math.hypot(...calm.uniforms.u_tide.slice(2)) < 0.0001, 'Sea: released surge relaxes to background drift');

  await go('stone-break');
  const slab = await step();
  const cracked = await hold('ArrowUp', 30);
  check(cracked.hash !== slab.hash, 'Stone: first part of Up reveals fractures');
  const opened = await hold('ArrowUp', 65);
  check(opened.hash !== cracked.hash, 'Stone: continued Up separates the matching fragments');
  check((await settle(90)).hash === opened.hash, 'Stone: release holds a partially opened slab');
  const rocked = await hold('ArrowRight', 40);
  check(rocked.hash !== opened.hash, 'Stone: lateral arrows rock the open pieces');
  await capture('stone-break');
  await hold('ArrowDown', 180);
  check((await settle(90)).hash === slab.hash, 'Stone: Down restores the exact original slab');

  await go('searchlights');
  await select('Motion', 'paused'); const lights = await step();
  const aimed = await hold('ArrowRight', 40);
  check(aimed.hash !== lights.hash && await page.getByLabel('Aim', { exact: true }).inputValue() === 'hand', 'Lights: arrows aim the frozen lights and select manual aim');
  check((await step(60)).hash === aimed.hash, 'Lights: release holds the aim');
  await capture('searchlights');
  await button('Resume sweep');
  await focus(); await page.keyboard.down('ArrowLeft'); await page.keyboard.down('ArrowRight');
  await step(30);
  check(await page.getByLabel('Aim', { exact: true }).inputValue() === 'sweep', 'Opposing arrows cancel');
  await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight');
  await page.keyboard.press('ArrowUp'); await step();
  check(await page.getByLabel('Aim', { exact: true }).inputValue() === 'hand', 'A quick tap between frames is preserved');

  await page.setViewportSize({ width: 640, height: 480 });
  await go('paper-marbling'); await settle(180); const paint = await step();
  const combed = await hold('ArrowUp', 50, 1 / 30);
  check(combed.paintHash !== paint.paintHash && combed.uniforms.u_toolGeo[0] > 1, 'Marbling: keyboard pulls a visible multi-tooth comb through the paint');
  await settle(180); const lifted = await settle(120);
  check(lifted.uniforms.u_toolGeo[3] === 0 && (await settle(60)).paintHash === lifted.paintHash, 'Marbling: release lifts the comb and leaves a stable painting');
  const cross = await hold('ArrowRight', 60, 1 / 30);
  check(cross.paintHash !== lifted.paintHash && Math.abs(cross.uniforms.u_toolAxis[1]) === 1, 'Marbling: cross stroke rotates the comb and changes the paint');
  await capture('paper-marbling');
  await page.keyboard.down('ArrowUp');
  await page.evaluate(() => { location.hash = 'searchlights'; });
  await page.waitForFunction(() => document.querySelector('#demo-select').value === 'searchlights');
  await step(20);
  check(await page.getByLabel('Aim', { exact: true }).inputValue() === 'sweep', 'Demo switch clears held keys');
  check(await page.locator('.arrow-cursor').count() === 0, 'Demo switch cleans up keyboard markers');
  await page.keyboard.up('ArrowUp');

  // Same wall time, different frame schedules, with diagonal speed normalized.
  const aimRun = async (diagonal, dt) => {
    await go('searchlights'); await select('Motion', 'paused'); await focus();
    await page.keyboard.down('ArrowRight');
    if (diagonal) await page.keyboard.down('ArrowDown');
    const result = await step(Math.round(1 / dt), dt);
    await page.keyboard.up('ArrowRight'); if (diagonal) await page.keyboard.up('ArrowDown');
    return [(result.uniforms.u_mouse[0] - 0.5) * 4 / 3, result.uniforms.u_mouse[1] - 0.5];
  };
  const axial = await aimRun(false, 1 / 60), diagonal = await aimRun(true, 1 / 60);
  check(Math.abs(Math.hypot(...axial) - Math.hypot(...diagonal)) < 1e-8, 'Diagonal motion has the same physical speed as axial motion');
  for (const dt of [1 / 30, 1 / 144]) {
    const other = await aimRun(true, dt);
    check(Math.hypot(other[0] - diagonal[0], other[1] - diagonal[1]) < 1e-8, `Cursor motion agrees at ${Math.round(1 / dt)} Hz`);
  }
  check(errors.length === 0, `No browser errors: ${errors.join('; ')}`);
  await writeFile(`${artifacts}/receipt.json`, JSON.stringify({ checks, errors, screenshots: 8 }, null, 2));
  console.log(`${checks.length} keyboard checks passed; screenshots and receipt: ${artifacts}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
