import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import { EngineContext } from '../../engine/types';
import { ParamSlider } from '../../engine/ParamSlider';
import { ArrowState } from '../../engine/ArrowInput';
import fragmentSrc from './display.glsl';

export class SeaMeltPlugin extends FragmentShaderPlugin {
  readonly name = 'Sea Melt';

  private sliders!: ParamSlider;
  private warpStrength = 0.35;
  private crestWidth = 0.035;
  private driftSpeed = 0.06;
  private crestCount = 3.0;
  private drift = 0;
  private tide = { x: 0, y: 0, vx: 0, vy: 0, turnX: 0, turnY: 0 };

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

  onKeyboard(ctx: EngineContext, keys: ArrowState) {
    const t = this.tide, dt = ctx.dt, decay = Math.exp(-dt * 2.2);
    const tx = keys.x * 0.3, ty = -keys.y * 0.3;
    // Integrate velocity instead of multiplying the new speed by total time:
    // a reversal changes the flow continuously without teleporting the foam.
    t.x += tx * dt + (t.vx - tx) * (1 - decay) / 2.2;
    t.y += ty * dt + (t.vy - ty) * (1 - decay) / 2.2;
    const turnEase = 1 - Math.exp(-dt * 4);
    t.turnX += (tx - t.vx - t.turnX) * turnEase;
    t.turnY += (ty - t.vy - t.turnY) * turnEase;
    t.vx = tx + (t.vx - tx) * decay;
    t.vy = ty + (t.vy - ty) * decay;
    this.drift += this.driftSpeed * dt;
  }

  protected setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram, _ctx: EngineContext) {
    gl.uniform1f(gl.getUniformLocation(program, 'u_warpStrength'), this.warpStrength);
    gl.uniform1f(gl.getUniformLocation(program, 'u_crestWidth'), this.crestWidth);
    gl.uniform1f(gl.getUniformLocation(program, 'u_drift'), this.drift);
    gl.uniform1f(gl.getUniformLocation(program, 'u_crestCount'), this.crestCount);
    const t = this.tide;
    gl.uniform4f(gl.getUniformLocation(program, 'u_tide'), t.x, t.y, t.vx, t.vy);
    gl.uniform2f(gl.getUniformLocation(program, 'u_turn'), t.turnX, t.turnY);
  }

  destroy(ctx: EngineContext) {
    super.destroy(ctx);
    this.sliders.destroy();
  }
}
