import { Engine } from './engine/Engine';
import { Plugin } from './plugin/Plugin';
import { WobbyCellsPlugin } from './plugins/wobbly-cells';
import { TuringPatternsPlugin } from './plugins/turing-patterns';
import { BubblePhysicsPlugin } from './plugins/bubble-physics';
import { RippleDropPlugin } from './plugins/ripple-drop';
import { LaserBirdPlugin } from './plugins/laser-bird';
import { SeaMeltPlugin } from './plugins/sea-melt';
import { GlassWaterPlugin } from './plugins/glass-water';

const PLUGINS: Record<string, () => Plugin> = {
  'wobbly-cells': () => new WobbyCellsPlugin(),
  'turing-patterns': () => new TuringPatternsPlugin(),
  'bubble-physics': () => new BubblePhysicsPlugin(),
  'ripple-drop': () => new RippleDropPlugin(),
  'laser-bird': () => new LaserBirdPlugin(),
  'sea-melt': () => new SeaMeltPlugin(),
  'glass-water': () => new GlassWaterPlugin(),
};

const DEFAULT_ID = 'wobbly-cells';

const stage = document.getElementById('stage')!;
const engine = new Engine(stage);

// Top-bar dropdown demo switcher (the <select> lives outside the render canvas)
const select = document.getElementById('demo-select') as HTMLSelectElement;

for (const id of Object.keys(PLUGINS)) {
  const option = document.createElement('option');
  option.value = id;
  option.textContent = id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  select.appendChild(option);
}

select.addEventListener('change', () => {
  location.hash = select.value;
});

function loadFromHash() {
  const id = PLUGINS[location.hash.slice(1)] ? location.hash.slice(1) : DEFAULT_ID;
  select.value = id;
  engine.loadPlugin(PLUGINS[id]());
}

window.addEventListener('hashchange', loadFromHash);
loadFromHash();
