import { geoDistance, interpolateZoom } from "d3";

type Pose = { rotate: readonly [number, number, number]; zoom: number };

/** Coupled rotation progress and zoom of a regional flight. */
export interface FlightPath {
  durationMs: number;
  sample(t: number): { progress: number; zoom: number };
}

/** Recede only for a displacement of at least one view at a high zoom. */
export function planFlight(
  from: Pose,
  to: Pose,
  requestedMs = Infinity,
): FlightPath | null {
  const angle = geoDistance(
    [-from.rotate[0], -from.rotate[1]],
    [-to.rotate[0], -to.rotate[1]],
  );
  if (
    Math.max(from.zoom, to.zoom) < 20 ||
    (angle * Math.max(from.zoom, to.zoom)) / 2 < 1
  ) {
    return null;
  }
  // d3-interpolate exposes rho at runtime; its bundled DefinitelyTyped signature predates it.
  const regionalZoom = (
    interpolateZoom as typeof interpolateZoom & {
      rho(value: number): typeof interpolateZoom;
    }
  ).rho(0.8);
  const distance = angle / 2;
  const interpolate = regionalZoom(
    [0, 0, 1 / from.zoom],
    [distance, 0, 1 / to.zoom],
  );
  const minimum = Math.min(2, from.zoom, to.zoom);
  return {
    durationMs: Math.min(
      requestedMs,
      Math.max(1000, Math.min(1800, Math.abs(interpolate.duration) * 0.4)),
    ),
    sample(t) {
      if (t <= 0) {
        return { progress: 0, zoom: from.zoom };
      }
      if (t >= 1) {
        return { progress: 1, zoom: to.zoom };
      }
      const [x, , width] = interpolate(t);
      return {
        progress: Math.max(0, Math.min(1, x / distance)),
        zoom: Math.max(minimum, 1 / width),
      };
    },
  };
}
