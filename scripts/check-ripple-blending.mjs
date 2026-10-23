// Production sRGB composition regression: node scripts/check-ripple-blending.mjs
// Runs the real plate, instanced ink, and photographic shaders without a server.
// A translated horizontal portion of a ring must retain its integrated light.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(process.env.ARTIFACT_DIR ?? '/tmp/gl-demo-garden-ripple-blending');
const shader = path => {
  const file = resolve(root, path);
  return readFileSync(file, 'utf8').replace(/^\s*#include "([^"]+)"\s*$/gm,
    (_, include) => shader(resolve(dirname(file), include)));
};
const sources = {
  quad: shader('src/shaders/fullscreen-quad.vert'),
  marks: shader('src/plugins/ripple-drop/marks.vert'),
  plate: shader('src/plugins/ripple-drop/plate.glsl'),
  ink: shader('src/plugins/ripple-drop/display.glsl'),
  photo: shader('src/plugins/ripple-drop/photograph.glsl'),
  // Read the production palette as data, independently of its ink-output
  // conversion. This avoids hard-coding colors into the energy oracle.
  palette: `#version 300 es\nprecision highp float;\n${shader('src/shaders/lib/noise.glsl')}\n${shader('src/plugins/ripple-drop/background.glsl')}\nout vec4 fragColor;uniform int palette;void main(){fragColor=vec4(rippleInk(palette),1.0);}`,
};
const browser = await chromium.launch({ headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let result;
try {
  const page = await browser.newPage();
  result = await page.evaluate(sources => {
    const width = 64, height = 720;
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    const compile = (type, source) => {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = (vertex, fragment) => {
      const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    const copying = program(sources.quad, sources.plate);
    const drawing = program(sources.marks, sources.ink);
    const photograph = program(sources.quad, sources.photo);
    const paletteProgram = program(sources.quad, sources.palette);
    const locate = (p, names) => Object.fromEntries(names.map(name => [name, gl.getUniformLocation(p, name)]));
    const ink = locate(drawing, ['u_resolution', 'u_time', 'u_squash', 'u_life', 'u_strokeWidth', 'u_handDrawn', 'u_lineBoil', 'u_palette']);
    const photo = locate(photograph, ['u_scene', 'u_resolution', 'u_artResolution', 'u_time', 'u_softness', 'u_grain', 'u_weave', 'u_blurAxis', 'u_finish', 'u_sourceLinear']);
    const quad = gl.createVertexArray(), marks = gl.createVertexArray(), instance = gl.createBuffer();
    gl.bindVertexArray(marks); gl.bindBuffer(gl.ARRAY_BUFFER, instance); gl.bufferData(gl.ARRAY_BUFFER, 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.vertexAttribDivisor(0, 1);
    const texture = format => {
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, name, gl.LINEAR);
      for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, name, gl.CLAMP_TO_EDGE);
      return tex;
    };
    const target = format => {
      const tex = texture(format), fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete photographic framebuffer');
      return { tex, fbo, encoding: gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING) };
    };
    const background = texture(gl.RGBA8), plate = target(gl.SRGB8_ALPHA8), scratch = target(gl.RGBA8);
    gl.viewport(0, 0, width, height);
    const read = () => {
      const pixels = new Uint8Array(width * height * 4); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error during sRGB composition');
      return pixels;
    };
    const upload = pixels => {
      gl.bindTexture(gl.TEXTURE_2D, background); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    };
    const copyBackground = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, plate.fbo); gl.bindVertexArray(quad); gl.useProgram(copying); gl.disable(gl.BLEND);
      gl.bindTexture(gl.TEXTURE_2D, background); gl.uniform1i(gl.getUniformLocation(copying, 'u_background'), 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const finish = softness => {
      gl.bindVertexArray(quad); gl.useProgram(photograph); gl.disable(gl.BLEND); gl.bindTexture(gl.TEXTURE_2D, plate.tex);
      gl.uniform1i(photo.u_scene, 0); gl.uniform1i(photo.u_sourceLinear, 1);
      gl.uniform2f(photo.u_resolution, width, height); gl.uniform2f(photo.u_artResolution, width, height);
      for (const [name, value] of Object.entries({ u_time: 1, u_softness: softness, u_grain: 0, u_weave: 0 })) gl.uniform1f(photo[name], value);
      if (softness > 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, scratch.fbo); gl.uniform2f(photo.u_blurAxis, 1, 0); gl.uniform1i(photo.u_finish, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, scratch.tex); gl.uniform1i(photo.u_sourceLinear, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.uniform2f(photo.u_blurAxis, 0, 1); gl.uniform1i(photo.u_finish, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
      return read();
    };
    const difference = (a, b) => {
      let changed = 0, max = 0;
      for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d) changed++; max = Math.max(max, d); }
      return { comparedBytes: a.length, changed, max };
    };
    const decode = value => { const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; };
    const luminance = (pixels, at) => .2126 * decode(pixels[at]) + .7152 * decode(pixels[at + 1]) + .0722 * decode(pixels[at + 2]);
    const ramp = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) { ramp[i * 4] = i % 256; ramp[i * 4 + 1] = (i * 3) % 256; ramp[i * 4 + 2] = (i * 7) % 256; ramp[i * 4 + 3] = 255; }
    upload(ramp); copyBackground(); const cleanRamp = difference(ramp, finish(0));
    const blue = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) blue.set([41, 59, 79, 255], i * 4);
    upload(blue);
    const paletteBytes = [];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindVertexArray(quad); gl.useProgram(paletteProgram);
    for (let palette = 0; palette < 3; palette++) {
      gl.uniform1i(gl.getUniformLocation(paletteProgram, 'palette'), palette); gl.drawArrays(gl.TRIANGLES, 0, 3); paletteBytes.push(Array.from(read().slice(0, 4)));
    }
    const drawRing = (strokeWidth, phase, palette) => {
      copyBackground(); gl.useProgram(drawing); gl.bindVertexArray(marks); gl.bindBuffer(gl.ARRAY_BUFFER, instance);
      // Translation changes only the mark's placement. The outer arc's ROI
      // is found from readback below, rather than duplicating curve geometry.
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array([.5, .45 + phase / height, 0, 1.5]));
      gl.uniform2f(ink.u_resolution, width, height);
      for (const [name, value] of Object.entries({ u_time: 1, u_squash: .35, u_life: 4.5, u_strokeWidth: strokeWidth, u_handDrawn: 0, u_lineBoil: 0 })) gl.uniform1f(ink[name], value);
      gl.uniform1i(ink.u_palette, palette);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1); gl.disable(gl.BLEND);
    };
    const phaseProfiles = [], fullInk = [];
    for (let palette = 0; palette < 3; palette++) {
      drawRing(4, 0, palette); const opaque = finish(0);
      // A wide arc contains fully covered pixels. Its brightest pixel must
      // reproduce the production palette, catching missing/double decoding.
      let peakAt = 0, peak = -1;
      for (let y = 0; y < height; y++) { const at = (y * width + width / 2) * 4, light = luminance(opaque, at); if (light > peak) { peak = light; peakAt = at; } }
      fullInk.push({ palette, expected: paletteBytes[palette], actual: Array.from(opaque.slice(peakAt, peakAt + 4)) });
      for (const strokeWidth of [.65, 1.05, 2.3]) for (const softness of [0, .55]) {
        copyBackground(); const baseline = finish(softness);
        drawRing(strokeWidth, 0, palette); const first = finish(0);
        const x = width / 2;
        let highest = -1;
        for (let y = 0; y < height; y++) {
          const at = (y * width + x) * 4;
          if (luminance(first, at) - luminance(blue, at) > .01) highest = y;
        }
        if (highest < 0) throw new Error('Production ring did not render');
        // The top and adjacent inner ring are more than ten pixels apart;
        // this fixed window contains the complete top arc and its diffusion.
        const lower = highest - 5, upper = highest + 6;
        const energy = image => {
          let sum = 0;
          for (let y = lower; y <= upper; y++) {
            const at = (y * width + x) * 4;
            sum += luminance(image, at) - luminance(baseline, at);
          }
          return sum;
        };
        const energies = [];
        for (let phase = 0; phase <= 1.001; phase += .125) { drawRing(strokeWidth, phase, palette); energies.push(energy(finish(softness))); }
        const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
        phaseProfiles.push({ palette, strokeWidth, softness, energies, phaseRangeOverMean: (Math.max(...energies) - Math.min(...energies)) / mean });
      }
    }
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      plateIsSRGB: plate.encoding === gl.SRGB, scratchIsLinear: scratch.encoding === gl.LINEAR,
      cleanRamp, fullInk, phaseProfiles, glErrors: 0 };
  }, sources);
} finally { await browser.close(); }

try {
  assert.equal(result.plateIsSRGB, true); assert.equal(result.scratchIsLinear, true);
  assert.equal(result.cleanRamp.changed, 0, 'background/clean sRGB roundtrip changed encoded colors');
  for (const palette of result.fullInk) assert.deepEqual(palette.actual, palette.expected, `palette ${palette.palette}: ink output was not decoded exactly once`);
  for (const profile of result.phaseProfiles) {
    // Three 8-bit targets introduce quantization, particularly for subpixel
    // strokes. A 3% bound is well below the 13–49% encoded-blend defect and
    // still permits the measured rounding of very thin, dim marks.
    assert.ok(profile.phaseRangeOverMean < .03, `subpixel brightness changed: ${JSON.stringify(profile)}`);
  }
  result.status = 'passed';
} catch (error) { result.status = 'failed'; result.failure = error.message; throw error; }
finally { mkdirSync(artifacts, { recursive: true }); writeFileSync(resolve(artifacts, 'results.json'), JSON.stringify(result, null, 2) + '\n'); }
const worst = Math.max(...result.phaseProfiles.map(profile => profile.phaseRangeOverMean));
console.log(`Ripple linear blending passed: ${result.phaseProfiles.length} production arc phase sweeps, all palette endpoints, exact ${result.cleanRamp.comparedBytes}-byte clean ramp. Maximum phase variation ${(worst * 100).toFixed(2)}%. Artifacts: ${artifacts}`);
