import {
  geoCentroid,
  geoDistance,
  geoPath,
  type GeoPermissibleObjects,
  type GeoProjection,
} from "d3";
import type { ViewFrame } from "./view";

/** How a GeoJSON layer is drawn. Colors are css colors. */
export interface GeoJSONStyle {
  /** Line color. */
  stroke?: string;
  /** Line width, css px. */
  width?: number;
  /** Fill color; none by default. */
  fill?: string;
  /** Feature property shown as a label; no labels by default. */
  label?: string;
  /** Label color; the line color by default. */
  labelColor?: string;
  /** Label css font. */
  font?: string;
  /** Point radius, css px; d3's 4.5 by default. */
  radius?: number;
}

/** A GeoJSON object and its style. */
export interface GeoJSONLayer {
  /** FeatureCollection, Feature or geometry; lon/lat degrees. */
  data: GeoPermissibleObjects;
  style?: GeoJSONStyle;
}

const DEFAULT_STYLE: Required<Omit<GeoJSONStyle, "fill" | "label">> = {
  stroke: "rgba(255, 255, 255, 0.85)",
  width: 1,
  radius: 4.5,
  labelColor: "",
  font: '600 11px "Inter Tight Variable", system-ui, sans-serif',
};

/** Dark halo under labels, so they read over fields and lines. */
const HALO = "rgba(0, 0, 0, 0.7)";

const STYLE_KEYS = new Set([
  "stroke",
  "width",
  "fill",
  "label",
  "labelColor",
  "font",
  "radius",
]);

const GEOJSON_TYPES = new Set([
  "FeatureCollection",
  "Feature",
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

/** Check a GeoJSON layer from untyped input; throws with `path`. */
export function parseGeoJSONLayer(value: unknown, path: string): GeoJSONLayer {
  const layer = value as Partial<GeoJSONLayer> | null;
  const type = (layer?.data as { type?: unknown } | undefined)?.type;
  if (typeof type !== "string" || !GEOJSON_TYPES.has(type)) {
    throw new Error(`${path}.data must be a GeoJSON object`);
  }
  const style = layer?.style;
  if (style !== undefined) {
    if (typeof style !== "object" || style === null) {
      throw new Error(`${path}.style must be an object`);
    }
    for (const key of Object.keys(style)) {
      if (!STYLE_KEYS.has(key)) {
        throw new Error(`${path}.style.${key} is not a GeoJSON style key`);
      }
    }
    for (const key of ["width", "radius"] as const) {
      if (style[key] !== undefined && !(style[key] > 0)) {
        throw new Error(`${path}.style.${key} must be a positive number`);
      }
    }
  }
  return layer as GeoJSONLayer;
}

interface LabeledFeature {
  type: "Feature";
  properties?: Record<string, unknown> | null;
  geometry: GeoPermissibleObjects;
}

function features(data: GeoPermissibleObjects): LabeledFeature[] {
  const object = data as { type: string; features?: LabeledFeature[] };
  if (object.type === "FeatureCollection") {
    return object.features ?? [];
  }
  return object.type === "Feature" ? [data as unknown as LabeledFeature] : [];
}

/**
 * Draw a GeoJSON layer with the overlay projection, synced to `frame`:
 * fill, lines, then labels at `properties.labelAt` ([lon, lat]) or the
 * feature centroid, hidden on the far side of a globe.
 */
export function drawGeoJSON(
  ctx: CanvasRenderingContext2D,
  projection: GeoProjection,
  frame: ViewFrame,
  layer: GeoJSONLayer,
): void {
  const style = { ...DEFAULT_STYLE, ...layer.style };
  const path = geoPath(projection, ctx).pointRadius(style.radius);
  ctx.beginPath();
  path(layer.data);
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  ctx.lineWidth = style.width;
  ctx.strokeStyle = style.stroke;
  ctx.stroke();

  const key = style.label;
  if (!key) {
    return;
  }
  const center: [number, number] = [-frame.rotate[0], -frame.rotate[1]];
  const reach =
    frame.clipAngle >= 180 ? Infinity : (frame.clipAngle * Math.PI) / 180;
  ctx.font = style.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = HALO;
  ctx.fillStyle = style.labelColor || style.stroke;
  for (const feature of features(layer.data)) {
    const text = feature.properties?.[key];
    if (text === undefined || text === null || text === "") {
      continue;
    }
    const at =
      (feature.properties?.labelAt as [number, number] | undefined) ??
      geoCentroid(feature as GeoPermissibleObjects);
    if (geoDistance(center, at) > reach) {
      continue;
    }
    const xy = projection(at);
    if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) {
      continue;
    }
    ctx.strokeText(String(text), xy[0], xy[1]);
    ctx.fillText(String(text), xy[0], xy[1]);
  }
}
