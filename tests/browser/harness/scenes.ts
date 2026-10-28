import type { GeoJSONLayerConfig } from "../../../src";
import storyViews from "../../../apps/story/views.json" with { type: "json" };

/** The Niño regions of the story El Niño scene, as published. */
const NINO = storyViews.views.find((v) => v.id === "pacific-anomaly")!.config
  .geojson as unknown as GeoJSONLayerConfig;

/**
 * Reference scenes: catalog layers paused at a fixed time, with a seeded
 * `Math.random`. Shared by the harness page and the Playwright spec.
 */

/**
 * Playhead, epoch ms: midnight UTC, a frame time of both the 6-hourly
 * currents and the daily temperature, so no frame is interpolated.
 */
export const TIME = Date.parse("2025-03-15T00:00:00Z");

/** Seed of the page's `Math.random`, which seeds the particle streams. */
export const SEED = 20250315;

/** Stage size, css px, at a device pixel ratio of 1. */
export const STAGE = { width: 640, height: 480 } as const;

/**
 * Frames run once the scene is open: past the longest trail settle (120
 * frames) and the switch to detailed coastlines (180 ms).
 */
export const SETTLE_FRAMES = 300;

export interface Scene {
  id: string;
  /** What the scene covers. */
  covers: string;
  /** Layer type and source of the scene layer. */
  type: "particles" | "scalar";
  layer: string;
  preset: string;
  rotate?: [number, number, number];
  zoom?: number;
  /** GeoJSON drawn above the field. */
  geojson?: GeoJSONLayerConfig;
  /** A test image (harness/main.ts) drawn over the field. */
  image?: { bounds: [number, number, number, number]; opacity: number };
  /** Morph toward a preset, captured after this many frames. */
  morph?: { preset: string; frames: number };
}

export const SCENES: Scene[] = [
  {
    id: "globe-currents",
    covers: "vector particles, orthographic globe, limb and graticule",
    type: "particles",
    layer: "ocean-current-velocity",
    preset: "globe",
  },
  {
    id: "north-sea-ice",
    covers: "polar azimuthal view, particles converging on the pole",
    type: "particles",
    layer: "sea-ice-drift",
    preset: "north",
  },
  {
    id: "world-temperature",
    covers: "scalar raster on a world projection (Equal Earth)",
    type: "scalar",
    layer: "sea-water-temperature",
    preset: "world",
  },
  {
    id: "lambert-currents-temperature",
    covers: "particles tinted by a scalar field, azimuthal equal-area",
    type: "particles",
    layer: "ocean-velocity-temperature",
    preset: "lambert",
  },
  {
    id: "morph-globe-world",
    covers: "halfway morph globe → Equal Earth, moving trails",
    type: "particles",
    layer: "ocean-current-velocity",
    preset: "globe",
    // TRANSITION_MS (2200) / 2 at 60 Hz.
    morph: { preset: "world", frames: 66 },
  },
  {
    id: "pacific-nino",
    covers:
      "GeoJSON regions with labels above a raster, across the antimeridian",
    type: "scalar",
    layer: "sea-water-temperature",
    preset: "plate",
    rotate: [160, 0, 0],
    zoom: 1.6,
    geojson: NINO,
  },
  {
    id: "image-antimeridian",
    covers: "georeferenced image over a raster, across the antimeridian",
    type: "scalar",
    layer: "sea-water-temperature",
    preset: "plate",
    rotate: [180, 0, 0],
    zoom: 1.6,
    image: { bounds: [120, -30, 240, 30], opacity: 0.8 },
  },
];
