import { EngineContext, GestureEvent } from '../engine/types';

export interface Plugin {
  readonly name: string;
  init(ctx: EngineContext): void;
  render(ctx: EngineContext): void;
  destroy(ctx: EngineContext): void;
  onGesture?(ctx: EngineContext, event: GestureEvent): void;
  resize?(ctx: EngineContext): void;
}
