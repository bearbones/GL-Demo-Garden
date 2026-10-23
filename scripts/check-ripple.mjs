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
        // Follow the texture actually sampled by the final display pass. A large
        // unrelated background allocation must not conceal low-resolution ink.
        const dimensions = new Map(), bindings = new Map(), attachments = new Map();
        let unit = gl.TEXTURE0, framebuffer = null;
        const activeTexture = gl.activeTexture.bind(gl), bindTexture = gl.bindTexture.bind(gl);
        const bindFramebuffer = gl.bindFramebuffer.bind(gl), texImage2D = gl.texImage2D.bind(gl);
        gl.activeTexture = value => { unit = value; return activeTexture(value); };
        gl.bindTexture = (target, texture) => { bindings.set(unit, texture); return bindTexture(target, texture); };
        gl.bindFramebuffer = (target, object) => {
          if (target !== gl.READ_FRAMEBUFFER) framebuffer = object;
          return bindFramebuffer(target, object);
        };
        gl.texImage2D = (...args) => {
          if (typeof args[3] === 'number') dimensions.set(bindings.get(unit), { width: args[3], height: args[4] });
          return texImage2D(...args);
        };
        const framebufferTexture2D = gl.framebufferTexture2D.bind(gl);
        gl.framebufferTexture2D = (...args) => {
          if (framebuffer && args[1] === gl.COLOR_ATTACHMENT0) attachments.set(framebuffer, args[3]);
          return framebufferTexture2D(...args);
        };
        const drawArrays = gl.drawArrays.bind(gl);
        gl.drawArrays = (...args) => {
          if (!framebuffer) window.rippleDisplaySource = dimensions.get(bindings.get(gl.TEXTURE0));
          return drawArrays(...args);
        };
        const uniformNames = new Map(), getUniformLocation = gl.getUniformLocation.bind(gl);
        const uniform1f = gl.uniform1f.bind(gl), uploads = new Map();
        gl.getUniformLocation = (program, name) => {
          const location = getUniformLocation(program, name);
          if (location) uniformNames.set(location, name);
          return location;
        };
        gl.uniform1f = (location, value) => {
          if (uniformNames.get(location) === 'u_time') window.rippleLocalTime = value;
          return uniform1f(location, value);
        };
        for (const method of ['bufferData', 'bufferSubData']) {
          const original = gl[method].bind(gl);
          gl[method] = (...args) => {
            const data = args[method === 'bufferData' ? 1 : 2];
            if (args[0] === gl.ARRAY_BUFFER && data instanceof Float32Array) {
              uploads.set(gl.getParameter(gl.ARRAY_BUFFER_BINDING), Array.from(data));
            }
            return original(...args);
          };
        }
        const drawInstances = gl.drawArraysInstanced.bind(gl);
        gl.drawArraysInstanced = (...args) => {
          const buffer = gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
          window.rippleDrawnInstances = { count: args[3], data: uploads.get(buffer)?.slice(0, args[3] * 4) };
          window.rippleInkTarget = { ...dimensions.get(attachments.get(framebuffer)), viewport: Array.from(gl.getParameter(gl.VIEWPORT)) };
          return drawInstances(...args);
        };
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
      return { hash: hash >>> 0, width: canvas.width, height: canvas.height,
        displaySource: window.rippleDisplaySource, inkTarget: window.rippleInkTarget, error: gl.getError() };
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
    window.rippleInkStats = (name, empty) => {
      const frame = frames.get(name), background = frames.get(empty);
      let mass = 0, sx = 0, sy = 0, minX = frame.width, maxX = 0, minY = frame.height, maxY = 0;
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        const i = (y * frame.width + x) * 4;
        const weight = Math.max(0, (frame.bytes[i] - background.bytes[i]) * 0.2126
          + (frame.bytes[i + 1] - background.bytes[i + 1]) * 0.7152
          + (frame.bytes[i + 2] - background.bytes[i + 2]) * 0.0722 - 3);
        mass += weight; sx += (x + 0.5) * weight; sy += (y + 0.5) * weight;
        if (weight > 10) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
      return { mass, x: sx / mass, y: sy / mass, width: maxX - minX + 1, height: maxY - minY + 1 };
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
  // The bounded gain keeps default grain visible at this 600px test height,
  // while the standalone optics check covers its low-resolution cutoff.
  await slider('Film grain', 0.45);
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

  // One short maximum-rate interval schedules one drop. Its submitted arrival
  // point is only a reference: the assertions below require the rendered streak
  // to approach that point and a visible ring to appear there afterward.
  await page.evaluate(() => { window.rippleSavedRandom = Math.random; Math.random = () => 0.5; });
  await slider('Rain', 1);
  await step('', 1, 0.07);
  await slider('Rain', 0);
  const rainEntity = await page.evaluate(() => window.rippleDrawnInstances);
  check(rainEntity?.count === 1 && rainEntity.data?.length === 4, 'The isolated rain interval submits exactly one falling entity');
  await page.evaluate(() => { Math.random = window.rippleSavedRandom; });
  const [rainX, rainY, arrival] = rainEntity.data;
  const target = { x: rainX * empty.width, y: rainY * empty.height };
  const advanceTo = async (name, time) => {
    const remaining = time - await page.evaluate(() => window.rippleLocalTime);
    const count = Math.max(0, Math.ceil(remaining / 0.09));
    return step(name, count, count ? remaining / count : 0);
  };
  const inkStats = name => page.evaluate(name => window.rippleInkStats(name, 'empty'), name);
  const saveCanvas = async name => {
    const png = await page.locator('canvas').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]);
    await writeFile(`${artifacts}/${name}.png`, Buffer.from(png, 'base64'));
  };
  await advanceTo('rain-early', arrival - 0.30);
  const earlyRain = await inkStats('rain-early');
  await saveCanvas('rain-early');
  await advanceTo('rain-late', arrival - 0.10);
  const lateRain = await inkStats('rain-late');
  await saveCanvas('rain-late');
  check(earlyRain.mass > 100 && lateRain.mass > 100 && earlyRain.y > lateRain.y + 10 && lateRain.y > target.y,
    'A visible rain streak descends toward the pond before its arrival');
  check(Math.hypot(lateRain.x - target.x, lateRain.y - target.y) < Math.hypot(earlyRain.x - target.x, earlyRain.y - target.y),
    'The falling stroke moves closer to its eventual impact point');
  await advanceTo('rain-impact', arrival + 0.35);
  const impact = await inkStats('rain-impact');
  await saveCanvas('rain-impact');
  check(impact.mass > 100 && Math.hypot(impact.x - target.x, impact.y - target.y) < 2.5 && impact.width > lateRain.width + 4,
    'The same rain entity becomes a visibly widening ring at its submitted impact point');
  receipts.rain = { entity: rainEntity.data, target, early: earlyRain, late: lateRain, impact };
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  check((await step()).hash === empty.hash, 'Clearing after a rain impact restores the exact empty plate');

  const rainControl = page.getByLabel('Rain', { exact: true });
  check(await rainControl.evaluate(input => input.labels[0]?.control === input), 'The Rain label is associated with its native range');
  await rainControl.focus();
  await page.keyboard.press('End');
  check(await rainControl.inputValue() === '1', 'Native End key reaches maximum rain');
  await page.keyboard.press('ArrowLeft');
  check(await rainControl.inputValue() === '0.95', 'Native arrow key changes rain by one step');
  check((await step('', 15, 0.1)).hash !== empty.hash, 'Changing native rain control creates visible rainfall after its above-frame flight');
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  await select('Playback', 'paused');
  const cleared = await step();
  await page.getByRole('button', { name: 'Shower', exact: true }).click();
  const shower = await step();
  check(shower.hash !== cleared.hash, 'Shower adds visible marks while paused');
  check((await step('', 6, 0.1)).hash === shower.hash, 'Shower preserves paused playback');
  await page.getByRole('button', { name: 'Clear pond', exact: true }).click();
  check((await step()).hash === empty.hash, 'Clear removes the paused airborne shower as well as landed ripples');
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
    'Portrait DPR2 renders a 780×1688 output without GL errors');
  const nativeInk = frame => frame.inkTarget?.width >= frame.width && frame.inkTarget?.height >= frame.height
    && frame.inkTarget.viewport[2] >= frame.width && frame.inkTarget.viewport[3] >= frame.height
    && frame.displaySource.width >= frame.width && frame.displaySource.height >= frame.height;
  check(nativeInk(retina),
    'Portrait DPR2 ink reaches the photographic finish at native pixel resolution');
  check((await step()).hash === retina.hash && JSON.stringify(await resources()) === JSON.stringify(initialResources),
    'DPR2 resize preserves paused pixels and balanced GL resources');
  // Browser screenshots retain the context's original CSS scale after a CDP
  // density change; save actual canvas pixels for the high-density receipt.
  const retinaPng = await page.locator('canvas').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]);
  await writeFile(`${artifacts}/ripple-portrait-dpr2.png`, Buffer.from(retinaPng, 'base64'));
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await cdp.detach();
  await page.setViewportSize({ width: 1920, height: 1080 });
  const fullHD = await step();
  check(fullHD.error === 0 && nativeInk(fullHD),
    '1080p ink reaches the photographic finish without thin-line upsampling');
  receipts.renderTargets = { retina, fullHD };
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
