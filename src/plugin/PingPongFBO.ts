export class PingPongFBO {
  private fbos: [WebGLFramebuffer, WebGLFramebuffer];
  private textures: [WebGLTexture, WebGLTexture];
  private current: 0 | 1 = 0;
  width: number;
  height: number;

  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    initialData: ArrayBufferView | null = null,
  ) {
    this.width = width;
    this.height = height;

    // Required for rendering to float textures
    const ext = gl.getExtension('EXT_color_buffer_float');
    if (!ext) throw new Error('EXT_color_buffer_float not supported');

    this.textures = [this.createTexture(gl, width, height, initialData), this.createTexture(gl, width, height, initialData)];
    this.fbos = [this.createFBO(gl, this.textures[0]), this.createFBO(gl, this.textures[1])];
  }

  private createTexture(
    gl: WebGL2RenderingContext,
    w: number,
    h: number,
    data: ArrayBufferView | null,
  ): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  private createFBO(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fbo;
  }

  bindWrite(gl: WebGL2RenderingContext) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[this.current]);
    gl.viewport(0, 0, this.width, this.height);
  }

  bindRead(gl: WebGL2RenderingContext, unit = 0) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[1 - this.current]);
  }

  swap() {
    this.current = (1 - this.current) as 0 | 1;
  }

  get readTexture(): WebGLTexture {
    return this.textures[1 - this.current];
  }

  destroy(gl: WebGL2RenderingContext) {
    gl.deleteFramebuffer(this.fbos[0]);
    gl.deleteFramebuffer(this.fbos[1]);
    gl.deleteTexture(this.textures[0]);
    gl.deleteTexture(this.textures[1]);
  }

  resize(gl: WebGL2RenderingContext, width: number, height: number, initialData: ArrayBufferView | null = null) {
    this.destroy(gl);
    this.width = width;
    this.height = height;
    this.textures = [this.createTexture(gl, width, height, initialData), this.createTexture(gl, width, height, initialData)];
    this.fbos = [this.createFBO(gl, this.textures[0]), this.createFBO(gl, this.textures[1])];
    this.current = 0;
  }
}
