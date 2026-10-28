import { parseLayerStyle, type LayerStyleInput } from "@fxi/zartigl/catalog";
import { parseTimeRange, type TimeRange } from "@fxi/zartigl/engine";
import { SPEEDS } from "./Clock";
import { STYLE_SUPPORT } from "./FieldLayer";
import { parseGeoJSONLayer, type GeoJSONLayer } from "./geojson";
import { findLayer, isTintEntry, layerPalettes, preloadLayer } from "./layers";
import { findPreset } from "./presets";
import type { FieldLayerHandle, Projversor } from "./Projversor";
import type { ShareState } from "./share";

/**
 * A story view, as `@fxi/zartigl/story` defines it. Declared here so this
 * entry stays independent: the adapter fits the story registry structurally.
 */
export interface ProjversorViewDefinition {
  id: string;
  config: Record<string, unknown>;
}

/** How time moves in a projversor view. */
export interface ProjversorViewPlayback {
  /**
   * Playback multiplier, one of {@link SPEEDS} for the layer kind. On a
   * vector layer it also scales the particles: see `particleSpeedFactor`.
   */
  speed?: number;
  /** ISO date of the playhead; the latest month when omitted. */
  time?: string;
}

/** `config` of a `projversor` view, as {@link parseProjversorView} returns it. */
export interface ProjversorViewConfig {
  /** projversor layer id (catalog alias, or a tinted pairing id). */
  layer: string;
  preset: string;
  rotate?: [number, number, number];
  zoom?: number;
  /** Scalar entry id coloring the particles; "" colors them by speed. */
  tint?: string;
  /**
   * Style over the layer's own: `palette`, `particles` (density, speed, fade,
   * grade, backdrop) on vector layers, `raster` (opacity, vibrance).
   * Each view starts from the layer's style, so an override never leaks into
   * the next view.
   */
  style?: LayerStyleInput;
  playback?: ProjversorViewPlayback;
  /**
   * Time window playback loops over, as zartigl's `timeRange`:
   * `{ start?, end? }` ISO dates or `{ trailing }` ISO 8601 duration. Each
   * view sets its own: without one, the whole archive plays.
   */
  timeRange?: TimeRange;
  /** Projection morph duration from the previous scene. */
  transitionMs?: number;
  /** Side layouts: the paragraph follows the globe limb. */
  wrap?: boolean;
  /** GeoJSON drawn above the field during this view, e.g. named regions. */
  geojson?: GeoJSONLayer;
}

const KEYS = new Set([
  "layer",
  "preset",
  "rotate",
  "zoom",
  "tint",
  "style",
  "playback",
  "timeRange",
  "transitionMs",
  "wrap",
  "geojson",
]);

/** Flat keys of the first view format, and where they moved. */
const LEGACY_KEYS: Record<string, string> = {
  palette: "style.palette",
  vibrant: 'style.particles.grade ("vibrant")',
  speed: "playback.speed",
  time: "playback.time",
};

const warned = new Set<string>();

function warnLegacy(key: string): void {
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(
      `projversor view config.${key} is deprecated: use ${LEGACY_KEYS[key]}`,
    );
  }
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `moved` keys that are defined, under `target`, whose keys win. A target
 * that is not an object stays as is, for validation to reject.
 */
function under(target: unknown, moved: Record<string, unknown>): unknown {
  if (target !== undefined && !isObject(target)) {
    return target;
  }
  const merged = {
    ...Object.fromEntries(
      Object.entries(moved).filter(([, value]) => value !== undefined),
    ),
    ...target,
  };
  return Object.keys(merged).length ? merged : undefined;
}

/** Move the first format's flat keys to `style` and `playback`. */
function migrateLegacy(
  config: Record<string, unknown>,
  path: string,
  kind: "scalar" | "vector",
): Record<string, unknown> {
  const legacy = Object.keys(config).filter((key) => key in LEGACY_KEYS);
  if (!legacy.length) {
    return config;
  }
  const { palette, vibrant, speed, time, ...rest } = config;
  legacy.forEach(warnLegacy);
  invariant(
    vibrant === undefined || typeof vibrant === "boolean",
    `${path}.vibrant must be a boolean`,
  );
  const style = under(rest.style, { palette });
  // The grade colors particles: the first format ignored it on scalar layers.
  const particles =
    vibrant && kind === "vector"
      ? under(isObject(style) ? style.particles : undefined, {
          grade: "vibrant",
        })
      : undefined;
  return {
    ...rest,
    style:
      particles !== undefined && (style === undefined || isObject(style))
        ? { ...style, particles }
        : style,
    playback: under(rest.playback, { speed, time }),
  };
}

/**
 * Validate a view's config against the projversor layers and presets. The
 * flat `palette`, `vibrant`, `speed` and `time` of the first format are
 * moved to `style` and `playback`, with a one-time deprecation warning.
 */
export function parseProjversorView(
  view: ProjversorViewDefinition,
): ProjversorViewConfig {
  const path = `views.${view.id}.config`;
  const layer = findLayer(String(view.config.layer));
  invariant(layer, `${path}.layer is not a projversor layer`);
  const config = migrateLegacy(view.config, path, layer.kind);
  for (const key of Object.keys(config)) {
    invariant(KEYS.has(key), `${path}.${key} is not a projversor view key`);
  }
  invariant(findPreset(String(config.preset)), `${path}.preset is unknown`);
  if (config.rotate !== undefined) {
    invariant(
      Array.isArray(config.rotate) &&
        config.rotate.length === 3 &&
        config.rotate.every(isFiniteNumber),
      `${path}.rotate must be three numbers`,
    );
  }
  for (const key of ["zoom", "transitionMs"] as const) {
    if (config[key] !== undefined) {
      invariant(
        isFiniteNumber(config[key]) && config[key] > 0,
        `${path}.${key} must be positive`,
      );
    }
  }
  let style: LayerStyleInput | undefined;
  if (config.style !== undefined) {
    style = parseLayerStyle(config.style, `${path}.style`, {
      kind: layer.kind,
      supports: STYLE_SUPPORT,
    });
    const palette = style.palette;
    invariant(
      palette === undefined ||
        layerPalettes(layer).some((p) => p.id === palette),
      `${path}.style.palette is not offered for this layer`,
    );
  }
  if (config.playback !== undefined) {
    const playback = config.playback;
    invariant(isObject(playback), `${path}.playback must be an object`);
    for (const key of Object.keys(playback)) {
      invariant(
        key === "speed" || key === "time",
        `${path}.playback.${key} is not a playback key`,
      );
    }
    invariant(
      playback.speed === undefined ||
        SPEEDS[layer.kind].includes(playback.speed as number),
      `${path}.playback.speed must be one of ${SPEEDS[layer.kind].join(", ")}`,
    );
    invariant(
      playback.time === undefined ||
        (typeof playback.time === "string" &&
          Number.isFinite(Date.parse(playback.time))),
      `${path}.playback.time is not a date`,
    );
  }
  if (config.timeRange !== undefined) {
    parseTimeRange(config.timeRange, `${path}.timeRange`);
  }
  if (config.tint !== undefined) {
    invariant(
      layer.kind === "vector" &&
        (config.tint === "" || isTintEntry(String(config.tint))),
      `${path}.tint must be "" or a scalar entry id, on a vector layer`,
    );
  }
  if (config.wrap !== undefined) {
    invariant(
      typeof config.wrap === "boolean",
      `${path}.wrap must be a boolean`,
    );
  }
  if (config.geojson !== undefined) {
    parseGeoJSONLayer(config.geojson, `${path}.geojson`);
  }
  // The parsed style: legacy palettes read as their replacement (heat-alert).
  return (style
    ? { ...config, style }
    : config) as unknown as ProjversorViewConfig;
}

/**
 * The projversor state a view config shows. `style` and `timeRange` are
 * always set, so a view without them returns to the layer's own style, grade
 * included, and to the whole archive.
 */
export function projversorState(config: ProjversorViewConfig): Omit<
  Partial<ShareState>,
  "timeRange"
> & {
  style: LayerStyleInput;
  timeRange: TimeRange | null;
} {
  const { style = {}, playback = {} } = config;
  return {
    layer: config.layer,
    preset: config.preset,
    rotate: config.rotate,
    zoom: config.zoom,
    tint: config.tint,
    speed: playback.speed,
    time: playback.time === undefined ? undefined : Date.parse(playback.time),
    style,
    timeRange: config.timeRange ?? null,
  };
}

/** Ids of the layers a story view shows: its field and its GeoJSON. */
const VIEW_FIELD = "story-field";
const VIEW_GEOJSON = "story-geojson";

/**
 * Story view on one persistent projversor: each scene morphs the view from
 * the previous one, and the layer reopens only when it changes.
 */
export class ProjversorStoryView {
  /**
   * @param animate Morph between views; off for still frames and reduced
   *   motion, where each view is shown at once.
   * @param onError Reports a failed time seek.
   */
  constructor(
    private readonly projversor: Projversor,
    private readonly animate = true,
    private readonly onError: (error: unknown) => void = console.error,
  ) {}

  async activate(view: ProjversorViewDefinition): Promise<void> {
    const config = parseProjversorView(view);
    const pv = this.projversor;
    // A view without GeoJSON clears the previous one.
    await pv.remove(VIEW_GEOJSON);
    if (config.geojson) {
      await pv.add(VIEW_GEOJSON, "geojson", config.geojson);
    }
    const state = projversorState(config);
    await pv.update({
      preset: state.preset,
      rotate: state.rotate,
      zoom: state.zoom,
      animate: this.animate,
      durationMs: config.transitionMs,
    });
    const layer = findLayer(config.layer)!;
    // "" is "no tint"; omitted, the layer's own.
    const tint =
      layer.kind === "vector"
        ? config.tint === ""
          ? null
          : (config.tint ?? layer.tint ?? null)
        : null;
    const field = pv.get(VIEW_FIELD) as FieldLayerHandle | undefined;
    if (field && field.source.id === layer.id && field.tint === tint) {
      await field.update(state.style);
      await pv.update({
        speed: state.speed,
        timeRange: state.timeRange,
        time: state.time,
      });
      return;
    }
    await pv.replace(
      VIEW_FIELD,
      layer.kind === "vector" ? "particles" : "scalar",
      {
        source: layer.id,
        tint,
        style: state.style,
        time: state.time,
        speed: state.speed,
        timeRange: state.timeRange,
      },
    );
  }

  /** The field layer of the shown view, once a view opened. */
  get field(): FieldLayerHandle | undefined {
    return this.projversor.get(VIEW_FIELD) as FieldLayerHandle | undefined;
  }

  /** Warm the cache for a view shown next. */
  preload(view: ProjversorViewDefinition): Promise<void> {
    const { layer, playback, timeRange } = parseProjversorView(view);
    const time = playback?.time ?? timeRange?.start;
    const at = time === undefined ? undefined : Date.parse(String(time));
    return preloadLayer(layer, at);
  }

  play(): void {
    void this.projversor.update({ playing: true });
  }

  pause(): void {
    void this.projversor.update({ playing: false });
  }

  setTime(time: number): void {
    this.projversor.update({ time }).catch(this.onError);
  }

  destroy(): void {
    this.projversor.destroy();
  }
}
