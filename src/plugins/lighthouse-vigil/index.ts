import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import { EngineContext } from '../../engine/types';
import { ParamSlider } from '../../engine/ParamSlider';
import fragmentSrc from './display.glsl';

export class LighthouseVigilPlugin extends FragmentShaderPlugin {
  readonly name = 'Lighthouse Vigil';

  private sliders!: ParamSlider;
  private beamSpeed = 0.55;
  private beamWidth = 0.055;
  private swell = 0.6;
  private haze = 0.85;

  protected fragmentSource() {
    return fragmentSrc;
  }

  init(ctx: EngineContext) {
    super.init(ctx);

    this.sliders = new ParamSlider();
    this.sliders.addSlider({
      label: 'Beam Speed', min: 0.1, max: 1.5, value: this.beamSpeed, step: 0.05,
      onChange: (v) => { this.beamSpeed = v; },
    });
    this.sliders.addSlider({
      label: 'Beam Width', min: 0.02, max: 0.12, value: this.beamWidth, step: 0.005,
      onChange: (v) => { this.beamWidth = v; },
    });
    this.sliders.addSlider({
      label: 'Swell', min: 0.0, max: 1.0, value: this.swell, step: 0.05,
      onChange: (v) => { this.swell = v; },
    });
    this.sliders.addSlider({
      label: 'Haze', min: 0.2, max: 1.5, value: this.haze, step: 0.05,
      onChange: (v) => { this.haze = v; },
    });
  }

  protected setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, _ctx: EngineContext) {
    gl.uniform1f(gl.getUniformLocation(program, 'u_beamSpeed'), this.beamSpeed);
    gl.uniform1f(gl.getUniformLocation(program, 'u_beamWidth'), this.beamWidth);
    gl.uniform1f(gl.getUniformLocation(program, 'u_swell'), this.swell);
    gl.uniform1f(gl.getUniformLocation(program, 'u_haze'), this.haze);
  }

  destroy(ctx: EngineContext) {
    super.destroy(ctx);
    this.sliders.destroy();
  }
}
