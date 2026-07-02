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

const engine = new Engine();

function loadFromHash() {
  const id = location.hash.slice(1) || 'wobbly-cells';
  const factory = PLUGINS[id];
  if (factory) engine.loadPlugin(factory());
}

window.addEventListener('hashchange', loadFromHash);
loadFromHash();

// Simple nav overlay
const nav = document.createElement('nav');
nav.style.cssText =
  'position:fixed;top:0;left:0;padding:12px 16px;z-index:10;display:flex;gap:16px;font-family:system-ui,sans-serif;font-size:14px;';

for (const id of Object.keys(PLUGINS)) {
  const a = document.createElement('a');
  a.href = `#${id}`;
  a.textContent = id.replace(/-/g, ' ');
  a.style.cssText =
    'color:#fff;text-decoration:none;text-shadow:0 1px 3px rgba(0,0,0,0.8);text-transform:capitalize;opacity:0.7;transition:opacity 0.2s;';
  a.addEventListener('mouseenter', () => (a.style.opacity = '1'));
  a.addEventListener('mouseleave', () => (a.style.opacity = '0.7'));
  nav.appendChild(a);
}

document.body.appendChild(nav);
