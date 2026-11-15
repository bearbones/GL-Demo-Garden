import { EngineContext, GestureEvent } from '../engine/types';
import { ArrowState } from '../engine/ArrowInput';

export interface Plugin {
  readonly name: string;
  init(ctx: EngineContext): void;
  render(ctx: EngineContext): void;
  destroy(ctx: EngineContext): void;
  onGesture?(ctx: EngineContext, event: GestureEvent): void;
  /** Called once per frame, including release frames, before rendering. */
  onKeyboard?(ctx: EngineContext, arrows: ArrowState): void;
  resize?(ctx: EngineContext): void;
}
