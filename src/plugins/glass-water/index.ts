import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import { EngineContext } from '../../engine/types';
import { ParamSlider } from '../../engine/ParamSlider';
import fragmentSrc from './display.glsl';

export class GlassWaterPlugin extends FragmentShaderPlugin {
  readonly name = 'Glass Water';

  private sliders!: ParamSlider;
  private warpStrength = 0.45;
  private coarseWidth = 0.012;
  private fineWidth = 0.005;
  private driftSpeed = 0.06;
  private coarseLevels = 4.0;

  protected fragmentSource() {
    return fragmentSrc;
  }

  init(ctx: EngineContext) {
    super.init(ctx);

    this.sliders = new ParamSlider();
    this.sliders.addSlider({
      label: 'Warp Strength', min: 0.0, max: 1.0, value: this.warpStrength, step: 0.01,
      onChange: (v) => { this.warpStrength = v; },
    });
    this.sliders.addSlider({
      label: 'Crest Width', min: 0.004, max: 0.025, value: this.coarseWidth, step: 0.001,
      onChange: (v) => { this.coarseWidth = v; },
    });
    this.sliders.addSlider({
      label: 'Detail Width', min: 0.001, max: 0.012, value: this.fineWidth, step: 0.001,
      onChange: (v) => { this.fineWidth = v; },
    });
    this.sliders.addSlider({
      label: 'Drift Speed', min: 0.0, max: 0.15, value: this.driftSpeed, step: 0.005,
      onChange: (v) => { this.driftSpeed = v; },
    });
    this.sliders.addSlider({
      label: 'Crest Count', min: 2.0, max: 8.0, value: this.coarseLevels, step: 0.5,
      onChange: (v) => { this.coarseLevels = v; },
    });
  }

  protected setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, _ctx: EngineContext) {
    gl.uniform1f(gl.getUniformLocation(program, 'u_warpStrength'), this.warpStrength);
    gl.uniform1f(gl.getUniformLocation(program, 'u_coarseWidth'), this.coarseWidth);
    gl.uniform1f(gl.getUniformLocation(program, 'u_fineWidth'), this.fineWidth);
    gl.uniform1f(gl.getUniformLocation(program, 'u_driftSpeed'), this.driftSpeed);
    gl.uniform1f(gl.getUniformLocation(program, 'u_coarseLevels'), this.coarseLevels);
  }

  destroy(ctx: EngineContext) {
    super.destroy(ctx);
    this.sliders.destroy();
  }
}
