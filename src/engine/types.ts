export interface PointerPos {
  /** 0 = left edge, 1 = right edge */
  x: number;
  /** 0 = top edge, 1 = bottom edge */
  y: number;
}

export type GestureType = 'tap' | 'drag-start' | 'drag-move' | 'drag-end';

export interface GestureEvent {
  type: GestureType;
  pos: PointerPos;
  delta?: PointerPos;
}

export interface EngineContext {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  /** Canvas width in physical pixels */
  width: number;
  /** Canvas height in physical pixels */
  height: number;
  /** Seconds since plugin was initialized */
  time: number;
  /** Seconds since last frame */
  dt: number;
}
