// Standalone optical regression: node scripts/check-ripple-optics.mjs
// Compiles the actual finish shader against synthetic light profiles; no server
// or build is needed. SwiftShader measurements are not native-device FPS.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const artifacts = resolve(process.env.ARTIFACT_DIR ?? '/tmp/gl-demo-garden-ripple-optics');
const shader = readFileSync(root + 'src/plugins/ripple-drop/photograph.glsl', 'utf8').replace('#include "../../shaders/lib/noise.glsl"', readFileSync(root + 'src/shaders/lib/noise.glsl', 'utf8'));
const vertex = readFileSync(root + 'src/shaders/fullscreen-quad.vert', 'utf8');
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let result;
try {
const page = await browser.newPage();
result = await page.evaluate(({ shader, vertex }) => {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true, antialias:false });
  if (!gl) throw new Error('WebGL2 unavailable');
  const compile = (type, source) => {
    const stage = gl.createShader(type); gl.shaderSource(stage, source); gl.compileShader(stage);
    if (!gl.getShaderParameter(stage, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(stage));
    return stage;
  };
  const program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, shader)); gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program); gl.bindVertexArray(gl.createVertexArray());
  const locations = Object.fromEntries(['u_scene','u_resolution','u_artResolution','u_time','u_softness','u_grain','u_weave','u_blurAxis','u_finish'].map(name => [name,gl.getUniformLocation(program,name)]));
  const makeTexture = () => {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  };
  const source=makeTexture(), scratch=makeTexture(), fbo=gl.createFramebuffer();
  const inputFor=(width,height,kind) => {
    canvas.width=width; canvas.height=height; gl.viewport(0,0,width,height);
    const pixels=new Uint8Array(width*height*4);
    for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
      const at=(y*width+x)*4;
      const distance=Math.abs(x-Math.floor(width/2));
      let value=kind==='impulse' ? (x===Math.floor(width/2) && y===Math.floor(height/2) ? 255:0)
        : kind==='line' ? (distance===0 ? 255:0)
        : kind==='step' ? (x>=Math.floor(width/2) ? 255:0)
        : kind==='flat' ? 115 : (x*37+y*19)%256;
      pixels[at]=value; pixels[at+1]=kind==='random' ? (value*3)%256:value; pixels[at+2]=kind==='random' ? (value*7)%256:value; pixels[at+3]=kind==='random' ? 180+(x%76):255;
    }
    for(const [tex,data] of [[source,pixels],[scratch,null]]) {
      gl.bindTexture(gl.TEXTURE_2D,tex); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,data);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,scratch,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('incomplete FBO');
    gl.uniform1i(locations.u_scene,0);
    for(const name of ['u_resolution','u_artResolution']) gl.uniform2f(locations[name],width,height);
    return pixels;
  };
  const render=(softness=0.55,grain=0,weave=0,time=1.25) => {
    for(const [name,value] of Object.entries({u_softness:softness,u_grain:grain,u_weave:weave,u_time:time})) gl.uniform1f(locations[name],value);
    if(softness>0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo); gl.bindTexture(gl.TEXTURE_2D,source); gl.uniform2f(locations.u_blurAxis,1,0); gl.uniform1i(locations.u_finish,0); gl.drawArrays(gl.TRIANGLES,0,3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.bindTexture(gl.TEXTURE_2D,softness>0?scratch:source); gl.uniform2f(locations.u_blurAxis,0,1); gl.uniform1i(locations.u_finish,1); gl.drawArrays(gl.TRIANGLES,0,3);
    const pixels=new Uint8Array(canvas.width*canvas.height*4); gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.getError()!==gl.NO_ERROR) throw new Error('WebGL error');
    return pixels;
  };
  const diff=(a,b) => {
    let count=0,max=0;
    for(let i=0;i<a.length;i++) {const d=Math.abs(a[i]-b[i]);if(d)count++;max=Math.max(max,d);}
    return {count,max};
  };
  const decode=byte => {const c=byte/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
  const profiles=[];
  for(const height of [720,1688,2532]) for(const softness of [.55,1]) {
    const width=64, cx=32,cy=Math.floor(height/2); inputFor(width,height,'impulse');
    const image=render(softness);let mass=0,meanX=0,meanY=0,vx=0,vy=0;
    const axisX=[],axisY=[];
    for(let y=cy-20;y<=cy+20;y++)for(let x=cx-20;x<=cx+20;x++) {
      const light=decode(image[(y*width+x)*4]);mass+=light;meanX+=light*(x-cx);meanY+=light*(y-cy);vx+=light*(x-cx)**2;vy+=light*(y-cy)**2;
    }
    for(let i=-20;i<=20;i++) {axisX.push(image[(cy*width+cx+i)*4]);axisY.push(image[((cy+i)*width+cx)*4]);}
    profiles.push({height,softness,mass,centroid:[meanX/mass,meanY/mass],sigma:[Math.sqrt(vx/mass),Math.sqrt(vy/mass)],referenceSigma:[Math.sqrt(vx/mass)*720/height,Math.sqrt(vy/mass)*720/height],axisX,axisY});
  }
  const random=inputFor(192,128,'random'), clean=render(0,0,0,1),cleanLater=render(0,0,0,100);
  const flat=inputFor(128,128,'flat'),smallGrain=render(0,1,0,1);
  inputFor(64,720,'flat');
  const ga=render(0,1,0,1.001),gb=render(0,1,0,1.020),gc=render(0,1,0,1.050);
  const flatOutput=render(1,0,0,1);
  const flatError=diff(flatOutput,new Uint8Array(flatOutput.length).map((_,i)=>i%4===3?255:115));
  inputFor(64,720,'step');
  const edge=render(); const stepProfile=[];
  for(let x=16;x<48;x++) stepProfile.push(edge[(360*64+x)*4]);
  inputFor(64,720,'line'); const a=render(.55,.45,.35,1.25),b=render(.55,.45,.35,1.25);
  render(1,1,1,2);
  return {profiles,passthrough:diff(random,clean),cleanTimeInvariant:diff(clean,cleanLater),subNyquistGrain:diff(flat,smallGrain),grainWithinFrame:diff(ga,gb),grainNextFrame:diff(ga,gc),flatField:flatError,stepProfile,pausedFinish:diff(a,b),glErrors:0};
}, {shader,vertex});
} finally { await browser.close(); }

// A normalized diffusion must conserve linear light. Allow 2.5% on the
// deliberately worst-case one-pixel impulse after two RGBA8 roundings.
// Profile monotonicity independently rejects detached blur copies/halos.
try {
for(const profile of result.profiles) {
  assert.ok(Math.abs(profile.mass-1)<.025,`ink energy drift: ${JSON.stringify(profile)}`);
  assert.ok(profile.centroid.every(v=>Math.abs(v)<.025),'impulse centroid drift');
  for(const axis of [profile.axisX,profile.axisY]) {
    for(let i=1;i<=20;i++)assert.ok(axis[20+i]<=axis[20+i-1],`detached lobe: ${axis}`);
    for(let i=0;i<20;i++)assert.ok(axis[i]<=axis[i+1],`detached lobe: ${axis}`);
  }
  assert.ok(Math.abs(profile.sigma[0]/profile.sigma[1]-1)<.025,'anisotropic spread');
}
assert.equal(result.passthrough.count,0);assert.equal(result.cleanTimeInvariant.count,0);assert.equal(result.subNyquistGrain.count,0);assert.equal(result.grainWithinFrame.count,0);assert.ok(result.grainNextFrame.count>0);assert.equal(result.flatField.count,0);assert.equal(result.pausedFinish.count,0);
for(let i=1;i<result.stepProfile.length;i++) assert.ok(result.stepProfile[i]>=result.stepProfile[i-1],'edge reverses/ghosts');
result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.failure = error.message;
  throw error;
} finally {
  mkdirSync(artifacts,{recursive:true});
  writeFileSync(resolve(artifacts,'results.json'),JSON.stringify(result,null,2) + '\n');
}
const energy = result.profiles.map(profile => profile.mass);
console.log(`Ripple optical quality passed: 6 impulse profiles, monotone edge, identity, grain cadence and pause checks. Linear energy retained ${(Math.min(...energy)*100).toFixed(2)}–${(Math.max(...energy)*100).toFixed(2)}%. Artifacts: ${artifacts}`);
