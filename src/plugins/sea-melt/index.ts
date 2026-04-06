import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import { EngineContext } from '../../engine/types';
import { ParamSlider } from '../../engine/ParamSlider';
import fragmentSrc from './display.glsl';

export class SeaMeltPlugin extends FragmentShaderPlugin {
  readonly name = 'Sea Melt';

  private sliders!: ParamSlider;
  private warpStrength = 0.35;
  private crestWidth = 0.035;
  private driftSpeed = 0.06;
  private crestCount = 3.0;

  protected fragmentSource() {
    return fragmentSrc;
  }

  init(ctx: EngineContext) {
    super.init(ctx);

    this.sliders = new ParamSlider();
    this.sliders.addSlider({
      label: 'Warp Strength', min: 0.0, max: 0.8, value: this.warpStrength, step: 0.01,
      onChange: (v) => { this.warpStrength = v; },
    });
    this.sliders.addSlider({
      label: 'Crest Width', min: 0.01, max: 0.08, value: this.crestWidth, step: 0.005,
      onChange: (v) => { this.crestWidth = v; },
    });
    this.sliders.addSlider({
      label: 'Drift Speed', min: 0.0, max: 0.15, value: this.driftSpeed, step: 0.005,
      onChange: (v) => { this.driftSpeed = v; },
    });
    this.sliders.addSlider({
      label: 'Crest Count', min: 1.0, max: 6.0, value: this.crestCount, step: 0.5,
      onChange: (v) => { this.crestCount = v; },
    });
  }

  protected setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, _ctx: EngineContext) {
    gl.uniform1f(gl.getUniformLocation(program, 'u_warpStrength'), this.warpStrength);
    gl.uniform1f(gl.getUniformLocation(program, 'u_crestWidth'), this.crestWidth);
    gl.uniform1f(gl.getUniformLocation(program, 'u_driftSpeed'), this.driftSpeed);
    gl.uniform1f(gl.getUniformLocation(program, 'u_crestCount'), this.crestCount);
  }

  destroy(ctx: EngineContext) {
    super.destroy(ctx);
    this.sliders.destroy();
  }
}
