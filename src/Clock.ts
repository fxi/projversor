import { GeoVideoClock } from "@fxi/zartigl/engine";
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

/** Playback presets for the sphere's shared engine clock. */
export class Clock extends GeoVideoClock {
  readonly speeds = { ...DEFAULT_SPEEDS };

  /** Set a kind's speed when it is one of that kind's {@link SPEEDS}. */
  setKindSpeed(kind: ProjversorLayer["kind"], speed?: number): void {
    if (speed !== undefined && SPEEDS[kind].includes(speed)) {
      this.speeds[kind] = speed;
    }
  }
}
