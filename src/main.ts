import { Engine } from './engine/Engine';
import { Plugin } from './plugin/Plugin';
import { WobbyCellsPlugin } from './plugins/wobbly-cells';
import { TuringPatternsPlugin } from './plugins/turing-patterns';
import { BubblePhysicsPlugin } from './plugins/bubble-physics';
import { RippleDropPlugin } from './plugins/ripple-drop';
import { SeaMeltPlugin } from './plugins/sea-melt';
import { StoneBreakPlugin } from './plugins/stone-break';
import { SearchlightsPlugin } from './plugins/searchlights';
import { PaperMarblingPlugin } from './plugins/paper-marbling';
import './style.css';

const PLUGINS: Record<string, () => Plugin> = {
  'wobbly-cells': () => new WobbyCellsPlugin(),
  'turing-patterns': () => new TuringPatternsPlugin(),
  'bubble-physics': () => new BubblePhysicsPlugin(),
  'ripple-drop': () => new RippleDropPlugin(),
  'sea-melt': () => new SeaMeltPlugin(),
  'stone-break': () => new StoneBreakPlugin(),
  'searchlights': () => new SearchlightsPlugin(),
  'paper-marbling': () => new PaperMarblingPlugin(),
};

const DEFAULT_ID = 'wobbly-cells';
const HASH_REDIRECTS: Record<string, string> = {
  'laser-bird': DEFAULT_ID,
  'glass-water': DEFAULT_ID,
  'lighthouse-vigil': 'searchlights',
};
const HINTS: Record<string, string> = {
  'wobbly-cells': 'A moving mosaic of soft color and shifting seams.',
  'turing-patterns': 'Grow mazes, coral and spotted patterns from a few painted seeds.',
  'bubble-physics': 'Stir a column of rising air bubbles and watch them deform in the current.',
  'ripple-drop': 'Tap the pond or trail your finger through it. Each mark opens into a ripple.',
  'sea-melt': 'A flowing study of sea, foam and color. Adjust the surface below.',
  'stone-break': 'Strike the slab to open its seams, then reassemble it or choose a new stone.',
  'searchlights': 'Sweep light through drifting haze. Drag to aim and explore the shadows.',
  'paper-marbling': 'Drop color, draw through the bath, then lift a print.',
};

const stage = document.getElementById('stage')!;
const engine = new Engine(stage);

const select = document.getElementById('demo-select') as HTMLSelectElement;
const hint = document.getElementById('demo-hint')!;

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

let currentId: string | null = null;

function loadFromHash() {
  let raw = location.hash.slice(1);
  if (Object.prototype.hasOwnProperty.call(HASH_REDIRECTS, raw)) {
    raw = HASH_REDIRECTS[raw];
    history.replaceState(null, '', `#${raw}`);
  }
  // hasOwnProperty guards against inherited keys (#__proto__, #constructor);
  // an unknown hash keeps the running demo instead of resetting it
  const id = Object.prototype.hasOwnProperty.call(PLUGINS, raw)
    ? raw
    : currentId ?? DEFAULT_ID;
  select.value = id;
  if (id === currentId) return;
  currentId = id;
  hint.textContent = HINTS[id];
  engine.loadPlugin(PLUGINS[id]());
}

window.addEventListener('hashchange', loadFromHash);
loadFromHash();

const ui = document.getElementById('garden-ui')!;
const drawer = document.getElementById('garden-drawer')!;
const drawerToggle = document.getElementById('drawer-toggle')!;
const hideButton = document.getElementById('hide-ui')!;
const restoreButton = document.getElementById('restore-ui')!;
let drawerOpen = !matchMedia('(max-width: 600px)').matches;

function setDrawer(open: boolean) {
  drawerOpen = open;
  drawer.hidden = !open;
  drawerToggle.setAttribute('aria-expanded', String(open));
  drawerToggle.querySelector('.toggle-glyph')!.textContent = open ? '−' : '+';
}

function setHidden(hidden: boolean) {
  ui.hidden = hidden;
  restoreButton.hidden = !hidden;
  document.body.classList.toggle('ui-hidden', hidden);
  (hidden ? restoreButton : drawerToggle).focus({ preventScroll: true });
}

setDrawer(drawerOpen);
drawerToggle.addEventListener('click', () => setDrawer(!drawerOpen));
hideButton.addEventListener('click', () => setHidden(true));
restoreButton.addEventListener('click', () => setHidden(false));
document.getElementById('reset-demo')!.addEventListener('click', () => {
  if (currentId) engine.loadPlugin(PLUGINS[currentId]());
});

const fullscreen = document.getElementById('fullscreen') as HTMLButtonElement;
fullscreen.hidden = !document.fullscreenEnabled;
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    fullscreen.textContent = 'Full screen unavailable';
  }
});
document.addEventListener('fullscreenchange', () => {
  fullscreen.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
  fullscreen.setAttribute('aria-pressed', String(!!document.fullscreenElement));
});

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat
    || target.closest('input:not([type="range"]), select, textarea, [contenteditable="true"]')) return;
  if (event.key.toLowerCase() === 'h') {
    event.preventDefault();
    setHidden(!ui.hidden);
  } else if (event.key === 'Escape' && !ui.hidden) {
    setHidden(true);
  }
});
