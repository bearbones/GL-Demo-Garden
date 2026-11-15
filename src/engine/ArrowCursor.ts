import { ArrowState } from './ArrowInput';
import { EngineContext } from './types';

/** Damped motion in viewport-height units, independent of pixel density. */
export class ArrowCursor {
  x = 0.5;
  y = 0.5;
  vx = 0;
  vy = 0;
  private marker: HTMLSpanElement | null = null;

  attach(canvas: HTMLCanvasElement, kind: 'seed' | 'skater') {
    this.marker = document.createElement('span');
    this.marker.className = `arrow-cursor arrow-cursor-${kind}`;
    this.marker.setAttribute('aria-hidden', 'true');
    this.marker.hidden = true;
    canvas.parentElement!.appendChild(this.marker);
  }

  place(x: number, y: number) {
    this.x = x; this.y = y; this.vx = this.vy = 0;
    if (this.marker) this.marker.hidden = true;
  }

  move(ctx: EngineContext, keys: ArrowState, speed = 0.36, response = 9) {
    // Pointer tools can reach the very edge. Idle keyboard input must not
    // clamp their last position or leave a phantom wake when no key was used.
    if (!keys.active && this.vx === 0 && this.vy === 0) return 0;
    const dt = ctx.dt, decay = Math.exp(-response * dt);
    const tx = keys.x * speed, ty = keys.y * speed;
    const dx = tx * dt + (this.vx - tx) * (1 - decay) / response;
    const dy = ty * dt + (this.vy - ty) * (1 - decay) / response;
    this.vx = tx + (this.vx - tx) * decay;
    this.vy = ty + (this.vy - ty) * decay;
    const previousX = this.x, previousY = this.y;
    this.x = Math.max(0.025, Math.min(0.975, this.x + dx * ctx.height / ctx.width));
    this.y = Math.max(0.025, Math.min(0.975, this.y + dy));
    if ((this.x === 0.025 && this.vx < 0) || (this.x === 0.975 && this.vx > 0)) this.vx = 0;
    if ((this.y === 0.025 && this.vy < 0) || (this.y === 0.975 && this.vy > 0)) this.vy = 0;
    if (!keys.active && Math.hypot(this.vx, this.vy) < 0.001) this.vx = this.vy = 0;
    if (this.marker) {
      if (keys.active) this.marker.hidden = false;
      this.marker.style.left = `${this.x * 100}%`;
      this.marker.style.top = `${this.y * 100}%`;
      if (Math.hypot(this.vx, this.vy) > 0.01) {
        this.marker.style.setProperty('--heading', `${Math.atan2(this.vy, this.vx)}rad`);
      }
    }
    return Math.hypot((this.x - previousX) * ctx.width / ctx.height, this.y - previousY);
  }

  destroy() { this.marker?.remove(); this.marker = null; }
}
