import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import fragmentSrc from './fragment.glsl';

export class AuroraBorealisPlugin extends FragmentShaderPlugin {
  readonly name = 'Aurora Borealis';
  protected fragmentSource() {
    return fragmentSrc;
  }
}
