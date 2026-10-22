import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { ParamSlider } from '../../engine/ParamSlider';
import fragmentSrc from './fragment.glsl';

export class WobbyCellsPlugin extends FragmentShaderPlugin {
  readonly name = 'Wobbly Cells';
  private controls!: ParamSlider;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private scale = 6;
  private speed = 0.8;
  private wobble = 0.4;
  private seam = 0.04;
  private glow = 0.1;
  private radius = 2.4;
  private strength = 0.6;
  private palette = 0;
  private seed = 0;
  private motionTime = 0;
  private paused = false;
  private tool = 1;
  private lensActive = false;
  private lens = 0;
  private pointer: [number, number] = [0.5, 0.5];

  protected fragmentSource() {
    return fragmentSrc;
  }

  init(ctx: EngineContext) {
    super.init(ctx);
    this.controls = new ParamSlider();
    this.controls.addNote('Tap or drag to bend the cells. Freeze holds their motion while the lens stays interactive.');
    this.controls.addSection('Appearance');
    this.controls.addSelect({
      label: 'Palette', value: '0',
      options: [
        { value: '0', label: 'Pastel' },
        { value: '1', label: 'Lagoon' },
        { value: '2', label: 'Apricot' },
        { value: '3', label: 'Ink & chalk' },
      ],
      onChange: value => { this.palette = Number(value); },
    });
    this.controls.addSlider({ label: 'Density', min: 3, max: 16, value: this.scale, step: 0.25,
      onChange: value => { this.scale = value; } });
    this.controls.addSlider({ label: 'Seam width', min: 0.008, max: 0.12, value: this.seam, step: 0.002,
      onChange: value => { this.seam = value; } });
    this.controls.addSlider({ label: 'Inner light', min: 0, max: 0.25, value: this.glow, step: 0.01,
      onChange: value => { this.glow = value; } });

    this.controls.addSection('Motion');
    this.controls.addSelect({
      label: 'Animation', value: 'drift',
      options: [{ value: 'drift', label: 'Drift' }, { value: 'freeze', label: 'Freeze' }],
      onChange: value => { this.paused = value === 'freeze'; },
    });
    this.controls.addSlider({ label: 'Drift speed', min: 0.1, max: 2, value: this.speed, step: 0.05,
      onChange: value => { this.speed = value; } });
    this.controls.addSlider({ label: 'Wobble', min: 0, max: 0.45, value: this.wobble, step: 0.01,
      onChange: value => { this.wobble = value; } });

    this.controls.addSection('Pointer lens');
    this.controls.addSelect({
      label: 'Tool', value: '1',
      options: [
        { value: '1', label: 'Gather' },
        { value: '-1', label: 'Spread' },
        { value: '0', label: 'No lens' },
      ],
      onChange: value => { this.tool = Number(value); },
    });
    this.controls.addSlider({ label: 'Lens radius', min: 0.5, max: 4, value: this.radius, step: 0.1,
      onChange: value => { this.radius = value; } });
    this.controls.addSlider({ label: 'Lens strength', min: 0, max: 0.8, value: this.strength, step: 0.05,
      onChange: value => { this.strength = value; } });
    this.controls.addButtons([
      { label: 'Reshuffle', onClick: () => { this.seed += 13.71; } },
      { label: 'Clear lens', onClick: () => { this.lensActive = false; } },
    ]);
  }

  render(ctx: EngineContext) {
    // Integrating speed avoids a phase jump when the speed slider changes.
    if (!this.paused) this.motionTime += ctx.dt * this.speed;
    const ease = 1 - Math.exp(-ctx.dt * 14);
    this.pointer[0] += (this.mousePos[0] - this.pointer[0]) * ease;
    this.pointer[1] += (this.mousePos[1] - this.pointer[1]) * ease;
    const targetLens = this.lensActive ? this.tool * this.strength : 0;
    this.lens += (targetLens - this.lens) * ease;
    super.render(ctx);
  }

  protected setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    if (this.locations.size === 0) {
      for (const name of ['u_time', 'u_mouse', 'u_scale', 'u_wobble', 'u_seam', 'u_glow',
        'u_radius', 'u_lens', 'u_palette', 'u_seed']) {
        this.locations.set(name, gl.getUniformLocation(program, name));
      }
    }
    const uniform = (name: string) => this.locations.get(name)!;
    gl.uniform1f(uniform('u_time'), this.motionTime);
    gl.uniform2f(uniform('u_mouse'), this.pointer[0], this.pointer[1]);
    gl.uniform1f(uniform('u_scale'), this.scale);
    gl.uniform1f(uniform('u_wobble'), this.wobble);
    gl.uniform1f(uniform('u_seam'), this.seam);
    gl.uniform1f(uniform('u_glow'), this.glow);
    gl.uniform1f(uniform('u_radius'), this.radius);
    gl.uniform1f(uniform('u_lens'), this.lens);
    gl.uniform1i(uniform('u_palette'), this.palette);
    gl.uniform1f(uniform('u_seed'), this.seed);
  }

  onGesture(ctx: EngineContext, event: GestureEvent) {
    super.onGesture(ctx, event);
    this.lensActive = true;
  }

  destroy(ctx: EngineContext) {
    this.controls.destroy();
    this.locations.clear();
    super.destroy(ctx);
  }
}
