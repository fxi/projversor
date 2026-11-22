import type { ProjectionId } from "./projections";

/** A named projection with its default rotation and zoom. */
export interface Preset {
  id: string;
  label: string;
  projection: ProjectionId;
  rotate: [number, number, number];
  zoom: number;
}

export const PRESETS: Preset[] = [
  {
    id: "south",
    label: "South Pole",
    projection: "azimuthalEquidistant",
    rotate: [0, 90, 0],
    zoom: 2.2,
  },
  {
    id: "north",
    label: "North Pole",
    projection: "azimuthalEqualArea",
    rotate: [0, -90, 0],
    zoom: 2.3,
  },
  {
    id: "globe",
    label: "Globe",
    projection: "orthographic",
    rotate: [-20, 25, 0],
    zoom: 1,
  },
  {
    id: "world",
    label: "Equal Earth",
    projection: "equalEarth",
    rotate: [-150, 0, 0],
    zoom: 1,
  },
  {
    id: "mollweide",
    label: "Mollweide",
    projection: "mollweide",
    rotate: [-20, 0, 0],
    zoom: 1,
  },
  {
    id: "plate",
    label: "Plate carrée",
    projection: "equirectangular",
    rotate: [0, 0, 0],
    zoom: 1,
  },
  {
    id: "lambert",
    label: "Equal-area",
    projection: "azimuthalEqualArea",
    rotate: [-160, 10, 0],
    zoom: 1.1,
  },
  {
    // Spilhaus' world ocean in a square ("the world according to fishes"):
    // Adams World in a Square II, oblique aspect from PROJ's +proj=spilhaus.
    id: "spilhaus",
    label: "Spilhaus square",
    projection: "adamsWorldSquare2",
    rotate: [-66.94970198, 49.56371678, 40.17823482],
    zoom: 1,
  },
  {
    // The same map turned 45° clockwise: Atlantic up, Pacific down.
    id: "ocean",
    label: "Spilhaus ocean",
    projection: "adamsDiamond",
    rotate: [-66.94970198, 49.56371678, 40.17823482],
    // The diamond corners are land and the poles: crop to the oceans.
    zoom: 1.4,
  },
];

export function findPreset(id: string | undefined): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}
