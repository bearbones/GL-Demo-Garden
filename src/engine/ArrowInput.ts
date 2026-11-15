/** Screen coordinates: right and down are positive. Diagonals have unit length. */
export interface ArrowState { x: number; y: number; active: boolean }

const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']);
const EDITOR = 'input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="slider"], [role="spinbutton"], [role="listbox"], [role="textbox"]';

export class ArrowInput {
  private held = new Set<string>();
  private tapped = new Set<string>();

  constructor() {
    window.addEventListener('keydown', this.down);
    window.addEventListener('keyup', this.up);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', this.reset);
    document.addEventListener('focusin', this.focus);
    document.addEventListener('pointerdown', this.reset);
  }

  private editing(target: EventTarget | null) {
    return target instanceof Element && !!target.closest(EDITOR);
  }

  private down = (event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || this.editing(event.target)) {
      this.reset();
      return;
    }
    if (!ARROWS.has(event.key)) return;
    event.preventDefault();
    // Ignore OS repeat after focus changes or a demo switch, until a fresh press.
    if (event.repeat) return;
    this.held.add(event.key);
    this.tapped.add(event.key);
  };

  private up = (event: KeyboardEvent) => { this.held.delete(event.key); };
  private focus = (event: FocusEvent) => { if (this.editing(event.target)) this.reset(); };
  reset = () => { this.held.clear(); this.tapped.clear(); };

  sample(): ArrowState {
    // Preserve quick taps that begin and end between animation frames.
    const keys = new Set([...this.held, ...this.tapped]);
    this.tapped.clear();
    let x = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
    let y = Number(keys.has('ArrowDown')) - Number(keys.has('ArrowUp'));
    const length = Math.hypot(x, y);
    if (length) { x /= length; y /= length; }
    return { x, y, active: length > 0 };
  }

  destroy() {
    window.removeEventListener('keydown', this.down);
    window.removeEventListener('keyup', this.up);
    window.removeEventListener('blur', this.reset);
    document.removeEventListener('visibilitychange', this.reset);
    document.removeEventListener('focusin', this.focus);
    document.removeEventListener('pointerdown', this.reset);
  }
}
