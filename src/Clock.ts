import type { ProjversorLayer } from "./layers";

/**
 * Playback speeds and defaults per layer kind: particles need slow steps to
 * keep stable trails, while a raster only shows change when played faster.
 */
export const SPEEDS: Record<ProjversorLayer["kind"], number[]> = {
  vector: [0.5, 1, 2, 5],
  scalar: [1, 2, 5, 10, 20, 40, 80],
};
const DEFAULT_SPEEDS: Record<ProjversorLayer["kind"], number> = {
  vector: 1,
  scalar: 5,
};

/** The playhead shared by the layers: time, play state and speeds. */
export class Clock {
  /** Playhead, epoch ms. */
  ms = 0;
  /** Playback held, e.g. while a timeline thumb is held. */
  held = false;
  /** Playback speed multiplier per layer kind. */
  readonly speeds = { ...DEFAULT_SPEEDS };
  private playingValue: boolean;

  constructor(
    playing: boolean,
    private readonly onPlaying: (playing: boolean) => void,
  ) {
    this.playingValue = playing;
  }

  get playing(): boolean {
    return this.playingValue;
  }

  setPlaying(playing: boolean): void {
    if (this.playingValue !== playing) {
      this.playingValue = playing;
      this.onPlaying(playing);
    }
  }

  /** Playing and not held. */
  get advancing(): boolean {
    return this.playingValue && !this.held;
  }

  /** Set a kind's speed when it is one of that kind's {@link SPEEDS}. */
  setKindSpeed(kind: ProjversorLayer["kind"], speed?: number): void {
    if (speed !== undefined && SPEEDS[kind].includes(speed)) {
      this.speeds[kind] = speed;
    }
  }
}
