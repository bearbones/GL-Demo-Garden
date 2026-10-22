import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import { EngineContext, GestureEvent } from '../../engine/types';
import { ParamSlider } from '../../engine/ParamSlider';
import fragmentSrc from './display.glsl';

/** A two-dimensional light field: visible forms and shadow tests share capsules. */
export class SearchlightsPlugin extends FragmentShaderPlugin {
  readonly name = 'Searchlights';

  private sliders!: ParamSlider;
  private aimingSelect!: HTMLSelectElement;
  private clock = 0;
  private phase = 0;
  private paused = false;
  private manualAim = false;
  private lamps = 2;
  private coneWidth = 24;
  private sweepSpeed = 0.45;
  private haze = 0.85;
  private layout = 0;
  private palette = 0;

  protected fragmentSource() { return fragmentSrc; }

  init(ctx: EngineContext) {
    super.init(ctx);
    const s = this.sliders = new ParamSlider();
    s.addSection('Light through haze');
    s.addNote('Drag to aim the lamps together. The forms cut shadows through each beam.');
    s.addSelect({
      label: 'Lamps', value: String(this.lamps),
      options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }, { value: '3', label: 'Three' }],
      onChange: value => { this.lamps = Number(value); },
    });
    s.addSelect({
      label: 'Forms', value: String(this.layout),
      options: [
        { value: '0', label: 'Suspended discs' },
        { value: '1', label: 'Slatted screen' },
        { value: '2', label: 'Single disc' },
        { value: '3', label: 'Open haze' },
      ],
      onChange: value => { this.layout = Number(value); },
    });
    s.addSelect({
      label: 'Light', value: String(this.palette),
      options: [
        { value: '0', label: 'Silver / amber' },
        { value: '1', label: 'Polar' },
        { value: '2', label: 'Rose / violet' },
      ],
      onChange: value => { this.palette = Number(value); },
    });
    s.addSlider({
      label: 'Cone width °', min: 10, max: 46, value: this.coneWidth, step: 1,
      onChange: value => { this.coneWidth = value; },
    });
    s.addSlider({
      label: 'Haze', min: 0.15, max: 1.5, value: this.haze, step: 0.05,
      onChange: value => { this.haze = value; },
    });
    s.addSlider({
      label: 'Sweep pace', min: 0, max: 1.2, value: this.sweepSpeed, step: 0.05,
      onChange: value => { this.sweepSpeed = value; },
    });
    this.aimingSelect = s.addSelect({
      label: 'Aim', value: 'sweep',
      options: [{ value: 'sweep', label: 'Automatic sweep' }, { value: 'hand', label: 'Your last touch' }],
      onChange: value => { this.manualAim = value === 'hand'; },
    });
    s.addSelect({
      label: 'Motion', value: 'live',
      options: [{ value: 'live', label: 'Moving' }, { value: 'paused', label: 'Frozen' }],
      onChange: value => { this.paused = value === 'paused'; },
    });
    s.addButtons([{ label: 'Resume sweep', onClick: () => {
      this.manualAim = false;
      this.aimingSelect.value = 'sweep';
    } }]);
    s.addNote('Freeze holds the haze and sweep. You can still aim, change the light or rearrange the forms.');
  }

  render(ctx: EngineContext) {
    if (!this.paused) {
      this.clock += ctx.dt;
      // Integrating pace avoids a jump in direction when changing the slider.
      this.phase += ctx.dt * this.sweepSpeed;
    }
    super.render({ ...ctx, time: this.clock });
  }

  protected setUniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
    gl.uniform1i(gl.getUniformLocation(program, 'u_lamps'), this.lamps);
    gl.uniform1i(gl.getUniformLocation(program, 'u_layout'), this.layout);
    gl.uniform1i(gl.getUniformLocation(program, 'u_palette'), this.palette);
    gl.uniform1f(gl.getUniformLocation(program, 'u_coneWidth'), this.coneWidth * Math.PI / 360);
    gl.uniform1f(gl.getUniformLocation(program, 'u_haze'), this.haze);
    gl.uniform1f(gl.getUniformLocation(program, 'u_phase'), this.phase);
    gl.uniform1f(gl.getUniformLocation(program, 'u_manualAim'), this.manualAim ? 1 : 0);
  }

  onGesture(ctx: EngineContext, event: GestureEvent) {
    super.onGesture(ctx, event);
    this.manualAim = true;
    this.aimingSelect.value = 'hand';
  }

  destroy(ctx: EngineContext) {
    super.destroy(ctx);
    this.sliders.destroy();
  }
}
