import { easeCubicInOut, geoDistance, interpolateZoom } from "d3";

type Pose = { rotate: readonly [number, number, number]; zoom: number };

/** Coupled rotation progress and zoom of a flight. */
export interface FlightPath {
  durationMs: number;
  /** Linear time in [0, 1] at which the camera starts down to its target. */
  descent: number;
  /** Pose at linear time `t` in [0, 1]; the path carries its own easing. */
  sample(t: number): { progress: number; zoom: number };
}

/** Both ends at or above this zoom, one of them above `CLOSE_ZOOM`: regional. */
const GLOBAL_ZOOM = 3;
const CLOSE_ZOOM = 20;
/** Altitude of a global flight across a quarter of the globe or more. */
const GLOBE_ZOOM = 0.9;
/**
 * Shortest global flight: a base, the turn (per half globe) and each zoom
 * stage (per e-fold, the first four count), so no move is rushed.
 */
const BASE_MS = 1600;
const HALF_TURN_MS = 1600;
const ZOOM_FOLD_MS = 250;

/** Fly any move that carries the view at least one screen away. */
export function planFlight(
  from: Pose,
  to: Pose,
  requestedMs = Infinity,
): FlightPath | null {
  const angle = geoDistance(
    [-from.rotate[0], -from.rotate[1]],
    [-to.rotate[0], -to.rotate[1]],
  );
  const high = Math.max(from.zoom, to.zoom);
  if ((angle * high) / 2 < 1) {
    return null;
  }
  return high >= CLOSE_ZOOM && Math.min(from.zoom, to.zoom) >= GLOBAL_ZOOM
    ? regionalFlight(from.zoom, to.zoom, angle, requestedMs)
    : globalFlight(from.zoom, to.zoom, angle, requestedMs);
}

/**
 * Between a whole-globe view and a close one: rise to see the globe, turn
 * it, then descend. Each stage overlaps the next so the camera never stops.
 */
function globalFlight(
  z0: number,
  z1: number,
  angle: number,
  requestedMs: number,
): FlightPath {
  // Short turns need less altitude: a quarter globe or more rises to the
  // whole globe, never above either end.
  const zOut = Math.min(z0, z1, GLOBE_ZOOM * Math.max(1, Math.PI / 2 / angle));
  // Time for a stage grows with the zoom ratio it covers.
  const stage = (z: number) => {
    const ratio = Math.log(z / zOut);
    return ratio < 0.05 ? 0 : Math.min(0.42, 0.2 + 0.035 * ratio);
  };
  const out = stage(z0);
  const down = stage(z1);
  const turnStart = Math.max(0, out - 0.1);
  const turnEnd = Math.min(1, 1 - down + 0.1);
  const logLerp = (a: number, b: number, k: number) =>
    a * Math.pow(b / a, easeCubicInOut(Math.max(0, Math.min(1, k))));
  const folds = (z: number) => Math.min(4, Math.log(z / zOut));
  const shortest =
    BASE_MS +
    (HALF_TURN_MS * angle) / Math.PI +
    ZOOM_FOLD_MS * (folds(z0) + folds(z1));
  return {
    // The requested length when it leaves the stages enough time.
    durationMs: Math.round(
      Number.isFinite(requestedMs) ? Math.max(requestedMs, shortest) : shortest,
    ),
    descent: down ? 1 - down : 1,
    sample(t) {
      if (t <= 0) {
        return { progress: 0, zoom: z0 };
      }
      if (t >= 1) {
        return { progress: 1, zoom: z1 };
      }
      let zoom = z0;
      if (t >= 1 - down) {
        zoom = logLerp(zOut, z1, (t - (1 - down)) / down);
      } else if (out) {
        zoom = logLerp(z0, zOut, t / out);
      }
      const turn = (t - turnStart) / (turnEnd - turnStart);
      return {
        progress: easeCubicInOut(Math.max(0, Math.min(1, turn))),
        zoom,
      };
    },
  };
}

/** Between two close views: van Wijk and Nuij's path, receding modestly. */
function regionalFlight(
  z0: number,
  z1: number,
  angle: number,
  requestedMs: number,
): FlightPath {
  // d3-interpolate exposes rho at runtime; its bundled DefinitelyTyped signature predates it.
  const regionalZoom = (
    interpolateZoom as typeof interpolateZoom & {
      rho(value: number): typeof interpolateZoom;
    }
  ).rho(0.8);
  const distance = angle / 2;
  const interpolate = regionalZoom([0, 0, 1 / z0], [distance, 0, 1 / z1]);
  const minimum = Math.min(2, z0, z1);
  const sample = (t: number) => {
    if (t <= 0) {
      return { progress: 0, zoom: z0 };
    }
    if (t >= 1) {
      return { progress: 1, zoom: z1 };
    }
    const [x, , width] = interpolate(easeCubicInOut(t));
    return {
      progress: Math.max(0, Math.min(1, x / distance)),
      zoom: Math.max(minimum, 1 / width),
    };
  };
  // The descent starts at the highest point of the path.
  let descent = 0;
  for (let i = 1, lowest = z0; i <= 100; i++) {
    const { zoom } = sample(i / 100);
    if (zoom < lowest) {
      lowest = zoom;
      descent = i / 100;
    }
  }
  return {
    durationMs: Math.min(
      requestedMs,
      Math.max(1000, Math.min(1800, Math.abs(interpolate.duration) * 0.4)),
    ),
    descent,
    sample,
  };
}
