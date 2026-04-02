import { GestureEvent, PointerPos } from './types';

const TAP_THRESHOLD_PX = 5;
const TAP_THRESHOLD_MS = 300;

export class InputManager {
  private canvas: HTMLCanvasElement;
  private callback: (event: GestureEvent) => void;
  private dragging = false;
  private downPos: { x: number; y: number } | null = null;
  private downTime = 0;
  private lastPos: PointerPos = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement, callback: (event: GestureEvent) => void) {
    this.canvas = canvas;
    this.callback = callback;

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.style.touchAction = 'none';
  }

  private normalize(e: PointerEvent): PointerPos {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  private onPointerDown = (e: PointerEvent) => {
    this.canvas.setPointerCapture(e.pointerId);
    this.downPos = { x: e.clientX, y: e.clientY };
    this.downTime = performance.now();
    this.dragging = false;
    this.lastPos = this.normalize(e);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.downPos) return;

    const pos = this.normalize(e);
    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;

    if (!this.dragging && Math.sqrt(dx * dx + dy * dy) > TAP_THRESHOLD_PX) {
      this.dragging = true;
      this.callback({ type: 'drag-start', pos });
    }

    if (this.dragging) {
      this.callback({
        type: 'drag-move',
        pos,
        delta: {
          x: pos.x - this.lastPos.x,
          y: pos.y - this.lastPos.y,
        },
      });
    }

    this.lastPos = pos;
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.downPos) return;

    const pos = this.normalize(e);
    const elapsed = performance.now() - this.downTime;
    const dx = e.clientX - this.downPos.x;
    const dy = e.clientY - this.downPos.y;

    if (this.dragging) {
      this.callback({ type: 'drag-end', pos });
    } else if (Math.sqrt(dx * dx + dy * dy) <= TAP_THRESHOLD_PX && elapsed < TAP_THRESHOLD_MS) {
      this.callback({ type: 'tap', pos });
    }

    this.downPos = null;
    this.dragging = false;
  };

  destroy() {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
  }
}
