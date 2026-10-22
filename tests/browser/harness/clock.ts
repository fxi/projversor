/** Frame interval of the manual clock, ms: a 60 Hz display. */
export const FRAME_MS = 1000 / 60;

/** Resolves on a later task: pending promises, timers and messages run. */
export const nextTask = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A manual animation clock for reference renders: replaces the window's
 * `requestAnimationFrame` and `performance.now`, so frames only run when
 * {@link frame} is called, each `FRAME_MS` after the previous one. Timers,
 * network, workers and video decoding keep real time.
 */
export class FrameClock {
  /** Fake `performance.now()`, ms. */
  now = 0;
  /** Frames run so far. */
  frames = 0;
  /** The real `performance.now`, for measurements. */
  readonly realNow: () => number;
  private readonly callbacks = new Map<number, FrameRequestCallback>();
  private nextId = 1;

  constructor(win: Window) {
    this.realNow = win.performance.now.bind(win.performance);
    win.requestAnimationFrame = (callback) => {
      const id = this.nextId++;
      this.callbacks.set(id, callback);
      return id;
    };
    win.cancelAnimationFrame = (id) => {
      this.callbacks.delete(id);
    };
    Object.defineProperty(win.performance, "now", {
      configurable: true,
      value: () => this.now,
    });
  }

  /**
   * Run one animation frame: the callbacks requested before it, except those
   * cancelled meanwhile, even by an earlier callback of the same frame.
   * Callbacks requested during the frame run in the next one.
   */
  frame(): void {
    this.now += FRAME_MS;
    this.frames++;
    for (const [id, callback] of [...this.callbacks]) {
      if (this.callbacks.delete(id)) {
        callback(this.now);
      }
    }
  }
}
