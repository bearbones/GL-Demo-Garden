// Build first, then run node scripts/check-ripple.mjs. BASE_URL can target an
// existing server. The controlled RAF clock checks motion, never native FPS.
// Serialize SwiftShader with other captures: flock /tmp/gl-garden-browser.lock ...
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const artifacts = resolve(process.env.ARTIFACT_DIR ?? '/tmp/gl-demo-garden-ripple');
await mkdir(artifacts, { recursive: true });
const server = process.env.BASE_URL ? null : await preview({ preview: { host: '127.0.0.1', port: 4189, strictPort: true } });
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4189';
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], receipts = { renderer: 'Chromium SwiftShader; deterministic frames are not native-device FPS', radii: [], resources: [], checks: [] };
const check = (condition, message) => { assert.ok(condition, message); receipts.checks.push(message); };
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().startsWith('[vite] failed to connect to websocket')) errors.push(message.text());
  });
  // Prevent development hot reload from replacing the deterministic page mid-run.
  if (process.env.BASE_URL) await page.routeWebSocket('**', socket => socket.close());
  await page.addInitScript(() => {
    let time = 0, next = 0, seed = 942013;
    const callbacks = new Map(), frames = new Map();
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    Object.defineProperty(performance, 'now', { value: () => time });
    window.requestAnimationFrame = callback => { callbacks.set(++next, callback); return next; };
    window.cancelAnimationFrame = id => callbacks.delete(id);
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
      const gl = getContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
      if (type === 'webgl2' && gl && !gl.rippleTracked) {
        gl.rippleTracked = true;
        const live = {};
        for (const kind of ['Texture', 'Framebuffer', 'Buffer', 'VertexArray', 'Program', 'Shader']) {
          const objects = new Set(), create = gl[`create${kind}`].bind(gl), destroy = gl[`delete${kind}`].bind(gl);
          live[kind] = objects;
          gl[`create${kind}`] = (...args) => { const object = create(...args); if (object) objects.add(object); return object; };
          gl[`delete${kind}`] = object => { objects.delete(object); return destroy(object); };
        }
        window.rippleResources = () => Object.fromEntries(Object.entries(live).map(([kind, objects]) => [kind, objects.size]));
      }
      return gl;
    };
    window.rippleStep = (name, count = 1, dt = 1 / 60) => {
      for (let i = 0; i < count; i++) {
        time += dt * 1000;
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach(callback => callback(time));
      }
      const canvas = document.querySelector('canvas'), gl = canvas.getContext('webgl2');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const bytes = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      let hash = 2166136261;
      for (const value of bytes) hash = Math.imul(hash ^ value, 16777619);
      if (name) frames.set(name, { bytes, width: canvas.width, height: canvas.height });
      return { hash: hash >>> 0, width: canvas.width, height: canvas.height, error: gl.getError() };
    };
    // Compare the rendered mark with its exact empty plate. A brightness-weighted
    // outer annulus gives a subpixel radius, so fade/grain alone cannot satisfy
    // the motion check. There is no dependency on the shader's growth formula.
    window.rippleRadius = (name, empty, cx, cy) => {
      const frame = frames.get(name), background = frames.get(empty);
      const samples = [];
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        const i = (y * frame.width + x) * 4;
        const weight = Math.max(0, (frame.bytes[i] - background.bytes[i]) * 0.2126
          + (frame.bytes[i + 1] - background.bytes[i + 1]) * 0.7152
          + (frame.bytes[i + 2] - background.bytes[i + 2]) * 0.0722 - 3);
        if (weight > 0) samples.push({ radius: Math.hypot(x + 0.5 - cx, y + 0.5 - cy), weight });
      }
      samples.sort((a, b) => a.radius - b.radius);
      const total = samples.reduce((sum, sample) => sum + sample.weight, 0);
      let accumulated = 0, edge = 0;
      for (const sample of samples) { accumulated += sample.weight; if (accumulated > total * 0.98) { edge = sample.radius; break; } }
      const outer = samples.filter(sample => sample.radius > edge - 5 && sample.radius < edge + 2);
      const mass = outer.reduce((sum, sample) => sum + sample.weight, 0);
      return { radius: outer.reduce((sum, sample) => sum + sample.radius * sample.weight, 0) / mass, mass, edge };
    };
  });
  const step = (name = '', count = 1, dt = 1 / 60) => page.evaluate(({ name, count, dt }) => window.rippleStep(name, count, dt), { name, count, dt });
  const select = (label, value) => page.getByLabel(label, { exact: true }).selectOption(value);
  const slider = (label, value) => page.getByLabel(label, { exact: true }).fill(String(value));
  const resources = () => page.evaluate(() => window.rippleResources());
  await page.goto(`${base.replace(/\/$/, '')}/#ripple-drop`);
  await page.getByLabel('Playback', { exact: true }).waitFor({ state: 'attached' });
  check(await page.getByLabel('Finish', { exact: true }).inputValue() === 'photographed', 'Photographed cels are the default finish');
  check(await page.getByLabel('Rain', { exact: true }).inputValue() === '0.4', 'Rain starts at the intended default');
  await step('', 10, 0.1);
  await select('Playback', 'paused');
  const paused = await step('paused-photo');
  check(paused.error === 0, 'Ripple rendering passes compile and draw without GL errors');
  check((await step('', 6, 0.1)).hash === paused.hash, 'Pause holds art, grain, gate weave and optical finish together');
  await slider('Optical softness', 0);
  const changedPaused = await step();
  check(changedPaused.hash !== paused.hash, 'Optical softness updates existing art while paused');
  check((await step('', 5)).hash === changedPaused.hash, 'A paused control edit does not resume the film clock');
  await slider('Optical softness', 0.55);
  await step();
  await page.screenshot({ path: `${artifacts}/ripple-paused-photo.png` });

  await select('Finish', 'drawing');
  await slider('Hand drawn', 0);
  await slider('Line boil', 0);
  await slider('Perspective', 1);
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  check(await page.getByLabel('Rain', { exact: true }).inputValue() === '0', 'Clear pond also sets the visible Rain control to zero');
  const empty = await step('empty');
  await select('Playback', 'live');
  check((await step('', 6, 0.1)).hash === empty.hash, 'A cleared drawing remains an exact empty plate over time');
  await page.mouse.click(600, 300);
  await step('', 23);
  for (let i = 0; i < 12; i++) {
    const name = `motion-${i}`;
    await step(name);
    receipts.radii.push(await page.evaluate(({ name }) => window.rippleRadius(name, 'empty', 600, 300), { name }));
  }
  const advances = receipts.radii.slice(1).map((sample, i) => sample.radius - receipts.radii[i].radius);
  check(receipts.radii.every(sample => Number.isFinite(sample.radius) && sample.mass > 100), 'An isolated tap has a measurable outer stroke');
  check(advances.every(value => value > 0.10 && value < 2.0), `The actual ring expands on every 60Hz sample without held radii or jumps: ${advances.map(n => n.toFixed(3)).join(', ')}`);
  await page.screenshot({ path: `${artifacts}/ripple-continuous-ring.png` });
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  check((await step('', 12, 0.1)).hash === empty.hash, 'Clear removes all marks and prevents subsequent rain');

  // Isolate the emulsion from optical breathing, weave, rain and ink. At 120Hz
  // each 24Hz film exposure lasts five samples; this is distinct from the
  // continuous geometric radius measured above.
  await select('Finish', 'photographed');
  await slider('Optical softness', 0);
  await slider('Gate weave', 0);
  const grainHashes = [];
  for (let i = 0; i < 26; i++) grainHashes.push((await step('', 1, 1 / 120)).hash);
  const changes = grainHashes.flatMap((hash, i) => i > 0 && hash !== grainHashes[i - 1] ? [i] : []);
  const filmHolds = changes.slice(1).map((index, i) => index - changes[i]);
  receipts.filmHolds = filmHolds;
  check(filmHolds.length >= 3 && filmHolds.every(count => count >= 4 && count <= 6),
    `Isolated film grain changes at 24Hz while holding intermediate exposures: ${filmHolds.join(', ')} samples at 120Hz`);
  await slider('Film grain', 0);
  check((await step('', 6, 0.1)).hash === empty.hash, 'Zero film controls exactly restore the clean static drawing');
  await select('Finish', 'drawing');
  await slider('Optical softness', 0.55);
  await slider('Film grain', 0.45);
  await slider('Gate weave', 0.35);

  const rainControl = page.getByLabel('Rain', { exact: true });
  check(await rainControl.evaluate(input => input.labels[0]?.control === input), 'The Rain label is associated with its native range');
  await rainControl.focus();
  await page.keyboard.press('End');
  check(await rainControl.inputValue() === '1', 'Native End key reaches maximum rain');
  await page.keyboard.press('ArrowLeft');
  check(await rainControl.inputValue() === '0.95', 'Native arrow key changes rain by one step');
  check((await step('', 8, 0.1)).hash !== empty.hash, 'Changing native rain control creates visible rainfall');
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  await select('Playback', 'paused');
  const cleared = await step();
  await page.getByRole('button', { name: 'Shower', exact: true }).click();
  const shower = await step();
  check(shower.hash !== cleared.hash, 'Shower adds visible marks while paused');
  check((await step('', 6, 0.1)).hash === shower.hash, 'Shower preserves paused playback');
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  await select('Mark', 'spiral');
  await select('Playback', 'live');
  await page.mouse.click(600, 300);
  const spiral = await step('', 5, 0.1);
  check(spiral.hash !== empty.hash, 'The explicit spiral brush draws a visible mark');
  await select('Playback', 'paused');
  const paletteHashes = [];
  for (const palette of ['dusk', 'moss', 'rain']) {
    await select('Palette', palette);
    paletteHashes.push((await step()).hash);
  }
  check(new Set(paletteHashes).size === 3, 'All three palettes visibly change the frozen scene');
  await select('Finish', 'photographed');
  await slider('Hand drawn', 0.8);
  await slider('Line boil', 0.35);
  await slider('Perspective', 0.35);
  const photo = await step();
  await page.screenshot({ path: `${artifacts}/ripple-tools.png` });
  await page.getByRole('button', { name: 'Hide interface', exact: true }).click();
  check((await step()).hash === photo.hash, 'Hiding the interface preserves photographed canvas pixels');

  const initialResources = await resources();
  receipts.resources.push({ state: 'desktop', ...initialResources });
  await page.setViewportSize({ width: 390, height: 844 });
  const portrait = await step();
  check(portrait.width === 390 && portrait.height === 844 && portrait.error === 0, 'Portrait resize draws the full 390×844 canvas without GL errors');
  check(JSON.stringify(await resources()) === JSON.stringify(initialResources), 'Resizing replaces the art target without accumulating GL objects');
  check((await step('', 5)).hash === portrait.hash, 'Paused film remains stable after portrait resize');
  await page.screenshot({ path: `${artifacts}/ripple-portrait.png` });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: false });
  const retina = await step();
  check(retina.width === 780 && retina.height === 1688 && retina.error === 0,
    'Portrait DPR2 renders a 780×1688 output through the bounded photographic plate');
  check((await step()).hash === retina.hash && JSON.stringify(await resources()) === JSON.stringify(initialResources),
    'DPR2 resize preserves paused pixels and balanced GL resources');
  // Browser screenshots retain the context's original CSS scale after a CDP
  // density change; save actual canvas pixels for the high-density receipt.
  const retinaPng = await page.locator('canvas').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]);
  await writeFile(`${artifacts}/ripple-portrait-dpr2.png`, Buffer.from(retinaPng, 'base64'));
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await cdp.detach();
  await page.setViewportSize({ width: 800, height: 600 });
  check((await step()).error === 0, 'Resizing back to desktop preserves a valid render target');
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
  for (let cycle = 0; cycle < 4; cycle++) {
    await page.locator('#demo-select').selectOption('sea-melt');
    await step();
    const away = await resources();
    await page.locator('#demo-select').selectOption('ripple-drop');
    const returned = await step();
    const current = await resources();
    receipts.resources.push({ cycle, away, returned: current });
    check(returned.error === 0 && JSON.stringify(current) === JSON.stringify(initialResources), `Navigation cycle ${cycle + 1} releases and recreates Ripple GL resources without growth`);
  }
  check(errors.length === 0, `No browser application errors: ${errors.join('; ')}`);
  receipts.status = 'passed';
  console.log(`Ripple checks passed: ${receipts.checks.length} assertions. Artifacts: ${artifacts}`);
} catch (error) {
  receipts.status = 'failed';
  receipts.failure = error.stack;
  throw error;
} finally {
  receipts.errors = errors;
  await writeFile(`${artifacts}/results.json`, `${JSON.stringify(receipts, null, 2)}\n`);
  await browser.close();
  if (server) await new Promise(resolveClose => server.httpServer.close(resolveClose));
}
