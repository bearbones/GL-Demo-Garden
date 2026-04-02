import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import fragmentSrc from './fragment.glsl';

export class WobbyCellsPlugin extends FragmentShaderPlugin {
  readonly name = 'Wobbly Cells';
  protected fragmentSource() {
    return fragmentSrc;
  }
}
