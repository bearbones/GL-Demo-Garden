import { createProgram } from '../engine/gl-utils';
import quadVert from '../shaders/fullscreen-quad.vert';
export class FragmentShaderPlugin {
    constructor() {
        this.program = null;
        this.vao = null;
        this.uTime = null;
        this.uResolution = null;
        this.uMouse = null;
        this.mousePos = [0.5, 0.5];
    }
    init(ctx) {
        const { gl } = ctx;
        this.program = createProgram(gl, quadVert, this.fragmentSource());
        this.uTime = gl.getUniformLocation(this.program, 'u_time');
        this.uResolution = gl.getUniformLocation(this.program, 'u_resolution');
        this.uMouse = gl.getUniformLocation(this.program, 'u_mouse');
        this.vao = gl.createVertexArray();
    }
    render(ctx) {
        const { gl } = ctx;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, ctx.width, ctx.height);
        gl.useProgram(this.program);
        gl.uniform1f(this.uTime, ctx.time);
        gl.uniform2f(this.uResolution, ctx.width, ctx.height);
        gl.uniform2f(this.uMouse, this.mousePos[0], this.mousePos[1]);
        if (this.setUniforms && this.program) {
            this.setUniforms(gl, this.program, ctx);
        }
        gl.bindVertexArray(this.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    onGesture(_ctx, event) {
        this.mousePos = [event.pos.x, event.pos.y];
    }
    destroy(ctx) {
        const { gl } = ctx;
        if (this.program)
            gl.deleteProgram(this.program);
        if (this.vao)
            gl.deleteVertexArray(this.vao);
        this.program = null;
        this.vao = null;
    }
}
