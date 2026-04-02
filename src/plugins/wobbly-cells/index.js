import { FragmentShaderPlugin } from '../../plugin/FragmentShaderPlugin';
import fragmentSrc from './fragment.glsl';
export class WobbyCellsPlugin extends FragmentShaderPlugin {
    constructor() {
        super(...arguments);
        this.name = 'Wobbly Cells';
    }
    fragmentSource() {
        return fragmentSrc;
    }
}
