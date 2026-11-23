import {
  geoGraticule10,
  geoPath,
  geoProjectionMutator,
  type GeoPermissibleObjects,
  type GeoProjection,
  type GeoRawProjection,
} from "d3";
import { drawGeoJSON, type GeoJSONLayer } from "./geojson";
import { blendRaw, invertBlend, type Blend } from "./projections";
import { viewArea, type ViewFrame } from "./view";

export interface OverlayLayers {
  land: GeoPermissibleObjects;
  /** Finer land drawn once the view rests. */
  landDetail?: GeoPermissibleObjects;
}

/** Overlay colors; defaults from the matching css custom properties. */
const COLOR_TOKENS = [
  "ocean",
  "land",
  "coast",
  "outline",
  "graticule",
  "equator",
] as const;

/** Css colors of the sphere backdrop and the lines. */
export type OverlayColors = Record<(typeof COLOR_TOKENS)[number], string>;

/** Check overlay colors from untyped input; throws with `path`. */
export function parseOverlayColors(
  value: unknown,
  path: string,
): Partial<OverlayColors> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${path} must be an object`);
  }
  for (const [key, color] of Object.entries(value)) {
    if (!(COLOR_TOKENS as readonly string[]).includes(key)) {
      throw new Error(
        `${path}.${key} is not one of ${COLOR_TOKENS.join(", ")}`,
      );
    }
    if (typeof color !== "string") {
      throw new Error(`${path}.${key} must be a css color string`);
    }
  }
  return value as Partial<OverlayColors>;
}

/** A view drawn into a clip rect (css px; null: the whole canvas), faded. */
export interface OverlayPanel {
  frame: ViewFrame;
  clip: { x: number; y: number; width: number; height: number } | null;
  alpha: number;
}

type Ring = number[][];

/** Polygon rings of any GeoJSON object, as line strings. */
function ringsOf(object: unknown, rings: Ring[]): Ring[] {
  const o = object as {
    type?: string;
    coordinates?: unknown;
    geometry?: unknown;
    geometries?: unknown[];
    features?: unknown[];
  } | null;
  switch (o?.type) {
    case "FeatureCollection":
      o.features?.forEach((f) => ringsOf(f, rings));
      break;
    case "Feature":
      ringsOf(o.geometry, rings);
      break;
    case "GeometryCollection":
      o.geometries?.forEach((g) => ringsOf(g, rings));
      break;
    case "Polygon":
      rings.push(...(o.coordinates as Ring[]));
      break;
    case "MultiPolygon":
      for (const polygon of o.coordinates as Ring[][]) {
        rings.push(...polygon);
      }
      break;
  }
  return rings;
}

const coastCache = new WeakMap<object, GeoPermissibleObjects>();

/**
 * Coastlines of a land layer: its rings as lines. Stroking the polygons
 * would also stroke the edges d3 adds where a projection cut splits land,
 * drawing the map border as coast.
 */
export function coastlinesOf(
  land: GeoPermissibleObjects,
): GeoPermissibleObjects {
  let coast = coastCache.get(land);
  if (!coast) {
    coast = { type: "MultiLineString", coordinates: ringsOf(land, []) };
    coastCache.set(land, coast);
  }
  return coast;
}

const SPHERE: GeoPermissibleObjects = { type: "Sphere" };
const GRATICULE = geoGraticule10();
const EQUATOR: GeoPermissibleObjects = {
  type: "LineString",
  coordinates: [
    [-180, 0],
    [-90, 0],
    [0, 0],
    [90, 0],
    [180, 0],
  ],
};

/**
 * The d3 side of the blended projection: the sphere backdrop under the GL
 * canvas, land and lines above it. Also the source of `invert` for dragging.
 */
export class Overlay {
  readonly projection: GeoProjection;
  private blend: Blend | null = null;
  private readonly mutate: () => GeoProjection;
  private readonly back: CanvasRenderingContext2D;
  private readonly front: CanvasRenderingContext2D;
  /** GeoJSON layers drawn above everything, in insertion order. */
  readonly geojson = new Map<string, GeoJSONLayer>();
  private readonly colors: OverlayColors;
  /** Hide generalized coastlines on imagery at island scale. */
  coastlines = true;

  constructor(
    backCanvas: HTMLCanvasElement,
    frontCanvas: HTMLCanvasElement,
    private readonly layers: OverlayLayers,
    colors: Partial<OverlayColors> = {},
  ) {
    this.back = backCanvas.getContext("2d")!;
    this.front = frontCanvas.getContext("2d")!;
    const style = getComputedStyle(frontCanvas);
    this.colors = Object.fromEntries(
      COLOR_TOKENS.map((token) => [
        token,
        style.getPropertyValue(`--${token}`).trim(),
      ]),
    ) as OverlayColors;
    this.setColors(colors);
    this.mutate = geoProjectionMutator(() => {
      const blend = this.blend;
      if (!blend) {
        return ((x: number, y: number) => [x, y]) as GeoRawProjection;
      }
      const raw = blendRaw(blend) as GeoRawProjection;
      raw.invert = (x: number, y: number) =>
        invertBlend(blend, x, y) ?? [NaN, NaN];
      return raw;
    });
    this.projection = this.mutate();
  }

  /** Override colors, drawn from the next redraw; others stay. */
  setColors(colors: Partial<OverlayColors>): void {
    for (const token of COLOR_TOKENS) {
      const color = colors[token];
      if (color !== undefined) {
        this.colors[token] = color;
      }
    }
  }

  /** Finer land, once loaded: drawn from the next resting frame. */
  setLandDetail(land: GeoPermissibleObjects): void {
    this.layers.landDetail = land;
  }

  /** Sync the d3 projection with a frame; cheap enough for every frame. */
  setView(frame: ViewFrame): GeoProjection {
    const { cx, cy } = viewArea(frame);
    this.blend = { ...frame.blend };
    this.mutate();
    return this.projection
      .rotate(frame.rotate)
      .scale(frame.zoom)
      .translate([cx, cy])
      .clipAngle(
        frame.clipAngle >= 180 ? (null as unknown as number) : frame.clipAngle,
      )
      .precision(0.4);
  }

  /**
   * Draw the backdrop and the lines of each panel, clipped to it and faded;
   * a single full panel for the plain view.
   */
  draw(panels: readonly OverlayPanel[], dpr: number, detailed: boolean): void {
    for (const ctx of [this.back, this.front]) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);
    }
    for (const { frame, clip, alpha } of panels) {
      if (alpha <= 0 || (clip && (clip.width <= 0 || clip.height <= 0))) {
        continue;
      }
      for (const ctx of [this.back, this.front]) {
        ctx.save();
        ctx.globalAlpha = alpha;
        if (clip) {
          ctx.beginPath();
          ctx.rect(clip.x, clip.y, clip.width, clip.height);
          ctx.clip();
        }
      }
      this.drawPanel(frame, detailed);
      this.back.restore();
      this.front.restore();
    }
  }

  private drawPanel(frame: ViewFrame, detailed: boolean): void {
    this.setView(frame);
    const land =
      detailed && this.layers.landDetail
        ? this.layers.landDetail
        : this.layers.land;

    // Below the GL canvas: ocean and land, so fields and images cover them.
    const back = geoPath(this.projection, this.back);
    this.back.beginPath();
    back(SPHERE);
    this.back.fillStyle = this.colors.ocean;
    this.back.fill();
    this.back.beginPath();
    back(land);
    this.back.fillStyle = this.colors.land;
    this.back.fill();

    // Above it: lines and labels.
    const ctx = this.front;
    const path = geoPath(this.projection, ctx);

    ctx.beginPath();
    path(GRATICULE);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = this.colors.graticule;
    ctx.stroke();

    if (this.coastlines) {
      ctx.beginPath();
      path(coastlinesOf(land));
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = this.colors.coast;
      ctx.stroke();
    }

    ctx.beginPath();
    path(EQUATOR);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = this.colors.equator;
    ctx.stroke();

    ctx.beginPath();
    path(SPHERE);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = this.colors.outline;
    ctx.stroke();

    for (const layer of this.geojson.values()) {
      drawGeoJSON(ctx, this.projection, frame, layer);
    }
  }
}
