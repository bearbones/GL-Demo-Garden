// No dev server or build needed: compile the actual mark shaders directly.
// Run: node scripts/check-ripple-marks.mjs
// Serialize software GPU runs with: flock /tmp/gl-garden-browser.lock node scripts/check-ripple-marks.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = resolve(process.env.ARTIFACT_DIR ?? '/tmp/gl-demo-garden-ripple-marks');
await mkdir(artifacts, { recursive: true });

// Resolve the same relative includes used by Vite, without copying geometry,
// coverage, palette, or noise implementations into this test.
async function shaderSource(file, ancestors = []) {
  assert.ok(!ancestors.includes(file), `Cyclic shader include: ${file}`);
  const source = await readFile(file, 'utf8');
  let expanded = '', end = 0;
  for (const match of source.matchAll(/^[\t ]*#include[\t ]+"([^"]+)"[\t ]*$/gm)) {
    expanded += source.slice(end, match.index);
    expanded += await shaderSource(resolve(dirname(file), match[1]), [...ancestors, file]);
    end = match.index + match[0].length;
  }
  return expanded + source.slice(end);
}

const [vertex, fragment] = await Promise.all([
  shaderSource(resolve(root, 'src/plugins/ripple-drop/marks.vert')),
  shaderSource(resolve(root, 'src/plugins/ripple-drop/display.glsl')),
]);
const hash = source => createHash('sha256').update(source).digest('hex');

// The reference changes only the primitive footprint. It runs the identical
// product fragment shader, including its screen coordinates and pixel filter.
const referenceVertex = `#version 300 es
precision highp float;
layout(location = 0) in vec4 a_ripple;
uniform vec2 u_testExtent;
flat out vec4 v_ripple;
void main() {
  vec2 corners[6] = vec2[6](vec2(0,0), vec2(1,0), vec2(0,1),
                            vec2(0,1), vec2(1,0), vec2(1,1));
  gl_Position = vec4(corners[gl_VertexID] * u_testExtent * 2.0 - 1.0, 0.0, 1.0);
  v_ripple = a_ripple;
}`;

const cases = [];
for (const kind of [0, 1, 2]) {
  for (const seed of [0.05, 0.51, 0.95]) {
    for (const lifeFraction of [0.002, 0.025, 0.15, 0.8]) {
      cases.push({ kind, seed, age: lifeFraction * 4.5, perspective: 0.15, width: 4, hand: 1 });
    }
  }
}
for (const kind of [1, 2]) {
  for (const age of [0.08, 1.7]) {
    cases.push({ kind, seed: 0.35, age, perspective: 1, width: 1, hand: 0 });
  }
}
cases.push(
  { kind: 0, seed: 0.51, age: -0.03, perspective: 0.35, width: 2.2, hand: 1 },
  { kind: 0, seed: 0.95, age: -0.3, perspective: 0.35, width: 2.2, hand: 1 },
);

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  const page = await browser.newPage();
  const result = await page.evaluate(({ vertex, fragment, referenceVertex, cases }) => {
    const width = 320, height = 240;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is unavailable');
    const programs = [];
    let buffer, vao, texture, framebuffer;
    const backgroundEncoded = [64, 64, 64, 255];
    const background = new Uint8Array(width * height * 4);
    for (let i = 0; i < background.length; i += 4) background.set(backgroundEncoded, i);
    function compile(type, source) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Shader compilation failed: ${log}`);
      }
      return shader;
    }
    function program(vertexSource) {
      const shaders = [];
      const value = gl.createProgram();
      programs.push(value);
      try {
        shaders.push(compile(gl.VERTEX_SHADER, vertexSource));
        shaders.push(compile(gl.FRAGMENT_SHADER, fragment));
        shaders.forEach(shader => gl.attachShader(value, shader));
        gl.linkProgram(value);
        if (!gl.getProgramParameter(value, gl.LINK_STATUS)) {
          throw new Error(`Shader link failed: ${gl.getProgramInfoLog(value)}`);
        }
        return value;
      } finally {
        shaders.forEach(shader => gl.deleteShader(shader));
      }
    }
    function render(program, parameters, extent = [1, 1]) {
      // Upload encoded bytes directly: gl.clearColor would require reasoning
      // about clear conversion separately from the production blend path.
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, background);
      gl.useProgram(program);
      gl.bufferData(gl.ARRAY_BUFFER,
        new Float32Array([0.5, 0.5, 0, parameters.kind + parameters.seed]), gl.STATIC_DRAW);
      gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
      gl.uniform2f(gl.getUniformLocation(program, 'u_testExtent'), ...extent);
      for (const [name, value] of Object.entries({
        u_time: parameters.age, u_squash: parameters.perspective, u_life: 4.5,
        u_strokeWidth: parameters.width, u_handDrawn: parameters.hand, u_lineBoil: 1,
      })) gl.uniform1f(gl.getUniformLocation(program, name), value);
      gl.uniform1i(gl.getUniformLocation(program, 'u_palette'), 0);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    }
    function compare(actual, expected) {
      let differingPixels = 0, maxChannelDelta = 0, visiblePixels = 0;
      const samples = [];
      for (let i = 0; i < actual.length; i += 4) {
        if (expected[i] !== backgroundEncoded[0] || expected[i + 1] !== backgroundEncoded[1]
            || expected[i + 2] !== backgroundEncoded[2]) visiblePixels++;
        let differs = false;
        for (let channel = 0; channel < 4; channel++) {
          const delta = Math.abs(actual[i + channel] - expected[i + channel]);
          maxChannelDelta = Math.max(maxChannelDelta, delta);
          differs ||= delta !== 0;
        }
        if (differs) {
          differingPixels++;
          if (samples.length < 8) samples.push({
            x: (i / 4) % width, yFromBottom: Math.floor(i / 4 / width),
            actual: Array.from(actual.slice(i, i + 4)), expected: Array.from(expected.slice(i, i + 4)),
          });
        }
      }
      return { differingPixels, maxChannelDelta, visiblePixels, samples };
    }
    function png(pixels) {
      const image = document.createElement('canvas');
      image.width = width;
      image.height = height;
      const context = image.getContext('2d');
      const data = context.createImageData(width, height);
      for (let y = 0; y < height; y++) {
        data.data.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - y - 1) * width * 4);
      }
      context.putImageData(data, 0, 0);
      return image.toDataURL('image/png').split(',')[1];
    }
    try {
      const bounded = program(vertex), reference = program(referenceVertex);
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.viewport(0, 0, width, height);
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, background);
      framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('The sRGB mark framebuffer is incomplete');
      }
      const encoding = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0, gl.FRAMEBUFFER_ATTACHMENT_COLOR_ENCODING);
      if (encoding !== gl.SRGB) throw new Error('The mark attachment is not sRGB');
      const initialized = new Uint8Array(background.length);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, initialized);
      if (!initialized.every((value, index) => value === background[index])) {
        throw new Error('Encoded neutral background did not round-trip through the sRGB attachment');
      }
      // Match production: shader RGB is linear, while the sRGB attachment
      // decodes the neutral destination before blending and encodes storage.
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const results = [], images = [];
      for (const parameters of cases) {
        const actual = render(bounded, parameters), expected = render(reference, parameters);
        const comparison = compare(actual, expected);
        results.push({ ...parameters, ...comparison });
        if (comparison.differingPixels && !images.length) {
          images.push({ name: 'bounded.png', base64: png(actual) }, { name: 'reference.png', base64: png(expected) });
        }
      }
      // A deliberately half-screen primitive must lose ink. This proves the
      // comparison detects clipped coverage without mutating product shaders.
      const control = { kind: 1, seed: 0.51, age: 0.675, perspective: 0.15, width: 4, hand: 1 };
      const negativeControl = compare(render(reference, control, [0.5, 1]), render(reference, control));
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
      return { width, height, renderer, targetFormat: 'SRGB8_ALPHA8', backgroundEncoded,
        glError: gl.getError(), cases: results, negativeControl, images };
    } finally {
      programs.forEach(program => gl.deleteProgram(program));
      if (buffer) gl.deleteBuffer(buffer);
      if (vao) gl.deleteVertexArray(vao);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (texture) gl.deleteTexture(texture);
    }
  }, { vertex, fragment, referenceVertex, cases });

  const { images, ...receipt } = result;
  receipt.sourceHashes = { vertex: hash(vertex), fragment: hash(fragment) };
  for (const image of images) await writeFile(resolve(artifacts, image.name), Buffer.from(image.base64, 'base64'));
  await writeFile(resolve(artifacts, 'receipt.json'), JSON.stringify(receipt, null, 2));
  assert.equal(result.glError, 0, `GL error; inspect ${artifacts}/receipt.json`);
  const failures = result.cases.filter(test => test.differingPixels || test.visiblePixels === 0);
  assert.deepEqual(failures, [], `Bounded/fullscreen coverage differs or is empty; inspect ${artifacts}/receipt.json`);
  assert.ok(result.negativeControl.differingPixels > 0, 'Clipped-primitive negative control must lose coverage');
  console.log(JSON.stringify({ cases: cases.length, exactRGBA: true, targetFormat: result.targetFormat, renderer: result.renderer,
    negativeControlPixels: result.negativeControl.differingPixels, artifacts }, null, 2));
} finally {
  await browser.close();
}
