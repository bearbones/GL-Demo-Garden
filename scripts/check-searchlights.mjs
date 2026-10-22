// Run npm run test:searchlights to build and check a local production preview.
// BASE_URL can target an existing server. CAPTURE_LOOP=1 also writes 96 PNGs
// at a controlled 12 fps; ARTIFACT_DIR chooses their destination.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = process.env.BASE_URL ? null : await preview({ preview: { host: '127.0.0.1', port: 4188, strictPort: true } });
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188';
const artifacts = resolve(process.env.ARTIFACT_DIR ?? '/tmp/gl-demo-garden-searchlights');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
let assertions = 0;
const check = (condition, description) => { assert.ok(condition, description); assertions++; };
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.addInitScript(() => {
    let time = 0, next = 0;
    const callbacks = new Map();
    Object.defineProperty(performance, 'now', { value: () => time });
    window.requestAnimationFrame = callback => { callbacks.set(++next, callback); return next; };
    window.cancelAnimationFrame = id => callbacks.delete(id);
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, options) {
      return getContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
    };
    window.searchlightFrames = {};
    window.searchlightStep = (name, count, dt) => {
      for (let i = 0; i < count; i++) {
        time += dt * 1000;
        const pending = [...callbacks.values()];
        callbacks.clear();
        pending.forEach(callback => callback(time));
      }
      const canvas = document.querySelector('canvas');
      const gl = canvas.getContext('webgl2');
      const bytes = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      window.searchlightFrames[name] = { bytes, width: canvas.width, height: canvas.height };
      let hash = 2166136261, lit = 0;
      for (let i = 0; i < bytes.length; i++) hash = Math.imul(hash ^ bytes[i], 16777619);
      for (let i = 0; i < bytes.length; i += 4) {
        if (0.2126 * bytes[i] + 0.7152 * bytes[i + 1] + 0.0722 * bytes[i + 2] > 90) lit++;
      }
      return { hash: hash >>> 0, lit, error: gl.getError() };
    };
  });
  const step = (name, count = 1, dt = 1 / 60) => page.evaluate(
    ({ name, count, dt }) => window.searchlightStep(name, count, dt), { name, count, dt },
  );
  const select = (label, value) => page.getByLabel(label, { exact: true }).selectOption(value);
  const slider = (label, value) => page.getByLabel(label, { exact: true }).fill(String(value));
  // A small image-space neighborhood tolerates antialiasing while preserving the
  // physical claim: a point beyond the silhouette must lose direct illumination.
  const luminance = (name, x, y) => page.evaluate(({ name, x, y }) => {
    const { bytes, width, height } = window.searchlightFrames[name];
    const px = Math.round(width / 2 + x * height);
    const py = Math.round(height / 2 + y * height);
    let value = 0;
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      const i = ((py + oy) * width + px + ox) * 4;
      value += 0.2126 * bytes[i] + 0.7152 * bytes[i + 1] + 0.0722 * bytes[i + 2];
    }
    return value / 25;
  }, { name, x, y });
  const aim = (x, y) => page.mouse.click(400 + x * 600, 300 - y * 600);

  await page.goto(`${base.replace(/\/$/, '')}/#searchlights`);
  await select('Motion', 'paused');
  const frozen = await step('frozen');
  check(frozen.error === 0 && frozen.lit > 10000, 'Default composition renders illuminated haze without a GL error');
  check((await step('held', 5)).hash === frozen.hash, 'Freeze holds haze, dust, lights and shadows together');
  await select('Lamps', '1');
  await select('Forms', '3');
  await aim(0.55, -0.30);
  await step('unlit');
  // Lamp (-0.43 * 4/3, -0.36), disc (0, 0.04), sample 60% beyond the disc.
  const shadowPoint = { x: 0.344, y: 0.28 };
  await aim(shadowPoint.x, shadowPoint.y);
  check(await page.getByLabel('Aim', { exact: true }).inputValue() === 'hand', 'Canvas aiming switches out of automatic sweep');
  await step('open');
  await select('Forms', '2');
  await step('disc');
  const openBehind = await luminance('open', shadowPoint.x, shadowPoint.y);
  const blockedBehind = await luminance('disc', shadowPoint.x, shadowPoint.y);
  const unlitBehind = await luminance('unlit', shadowPoint.x, shadowPoint.y);
  check(openBehind - unlitBehind > 8 && Math.abs(blockedBehind - unlitBehind) < 0.01,
    'A disc shadow matches the unlit background; open light exceeds 8 quantization levels');
  const openBefore = await luminance('open', -0.2867, -0.16);
  const blockedBefore = await luminance('disc', -0.2867, -0.16);
  check(Math.abs(openBefore - blockedBefore) < 0.01, 'The same disc cannot darken a sample in front of it');
  await aim(0, 0.04);
  check((await step('aimInside')).error === 0, 'Aiming into the opaque form remains valid');
  check(await luminance('aimInside', shadowPoint.x, shadowPoint.y) < openBehind * 0.55, 'Aiming into a form does not punch light through it');

  // A ray crossing the middle of a slat must be blocked even when its endpoints
  // are far from that ray; this catches endpoint-only segment-distance mistakes.
  await select('Forms', '3');
  await aim(0.2053, 0.312);
  await step('openSlat');
  await select('Forms', '1');
  await step('slat');
  const openSlat = await luminance('openSlat', 0.2053, 0.312);
  const blockedSlat = await luminance('slat', 0.2053, 0.312);
  const unlitSlat = await luminance('unlit', 0.2053, 0.312);
  check(openSlat - unlitSlat > 8 && Math.abs(blockedSlat - unlitSlat) < 0.01,
    'A slat middle casts the same full shadow as the unlit background');

  await select('Forms', '3');
  await aim(0.1, 0.10);
  await slider('Cone width °', 10);
  const narrow = await step('narrow');
  await slider('Cone width °', 46);
  const wide = await step('wide');
  check(wide.lit > narrow.lit * 2, 'Cone width meaningfully changes illuminated area');
  await slider('Cone width °', 24);
  const one = await step('one');
  await select('Lamps', '2');
  const two = await step('two');
  check(two.hash !== one.hash, 'Second lamp contributes to the field');
  check(await luminance('two', 0.1, 0.10) > await luminance('one', 0.1, 0.10) * 1.15,
    'Crossing beams add illumination at their shared target');
  await select('Light', '2');
  check((await step('rose')).hash !== two.hash, 'Palette changes the rendered light');
  await select('Lamps', '3');
  check((await step('three')).error === 0, 'Third lamp renders without a GL error');

  await page.getByRole('button', { name: 'Resume sweep', exact: true }).click();
  check(await page.getByLabel('Aim', { exact: true }).inputValue() === 'sweep', 'Resume sweep releases manual aim');
  await select('Motion', 'live');
  const moving = await step('moving', 6);
  check((await step('later', 6)).hash !== moving.hash, 'Live sweep and haze advance');
  const beforePace = await step('beforePace', 1, 0);
  await slider('Sweep pace', 1.1);
  check((await step('afterPace', 1, 0)).hash === beforePace.hash, 'Changing pace preserves the current phase');

  // Capture a normal composition and a distinct slat study with tools hidden.
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await step('reset', 1, 0);
  await page.getByRole('button', { name: 'Hide interface', exact: true }).click();
  await page.screenshot({ path: `${artifacts}/searchlights-default.png` });
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
  await select('Forms', '1');
  await select('Light', '1');
  await select('Lamps', '3');
  await step('slats', 24, 1 / 12);
  await page.getByRole('button', { name: 'Hide interface', exact: true }).click();
  await page.screenshot({ path: `${artifacts}/searchlights-slats.png` });
  await page.getByRole('button', { name: 'Show controls', exact: true }).click();
  await page.getByRole('button', { name: 'Restart', exact: true }).click();
  await select('Motion', 'paused');
  await page.getByRole('button', { name: 'Hide interface', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  check((await step('portrait')).error === 0, 'Portrait composition renders without a GL error');
  await page.screenshot({ path: `${artifacts}/searchlights-portrait.png` });
  // At this aspect, touch exactly on the left lamp exercises zero-length aim.
  await page.mouse.click(390 * 0.07, 844 * 0.86);
  check((await step('sourceAim')).error === 0, 'Aiming at a lamp origin has a defined fallback direction');
  await page.setViewportSize({ width: 1, height: 1 });
  check((await step('tiny')).error === 0, 'Tiny canvas remains valid');

  if (process.env.CAPTURE_LOOP === '1') {
    await page.setViewportSize({ width: 640, height: 426 });
    await page.getByRole('button', { name: 'Show controls', exact: true }).click();
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    await page.getByRole('button', { name: 'Hide interface', exact: true }).click();
    const frames = `${artifacts}/loop`;
    await mkdir(frames, { recursive: true });
    for (let i = 0; i < 96; i++) {
      await step('loop', 1, 1 / 12);
      await page.screenshot({ path: `${frames}/${String(i).padStart(3, '0')}.png` });
    }
  }
  check(errors.length === 0, `No browser or shader errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ assertions, renderer: 'Chromium / SwiftShader', artifacts,
    shadow: { unlitBehind, openBehind, blockedBehind, openBefore, blockedBefore, unlitSlat, openSlat, blockedSlat } }, null, 2));
} finally {
  await browser.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
}
