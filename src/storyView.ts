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

/** A layer of a projversor view's stack. */
export interface ProjversorViewLayer {
  /** projversor layer id (catalog alias, or a tinted pairing id). */
  layer: string;
  /** Scalar entry id coloring the particles; "" colors them by speed. */
  tint?: string;
  /**
   * Style over the layer's own: `palette`, `particles` (density, speed, fade,
   * grade, backdrop) on vector layers, `raster` (opacity, vibrance).
   * Each view starts from the layer's style, so an override never leaks into
   * the next view.
   */
  style?: LayerStyleInput;
}

/** `config` of a `projversor` view, as {@link parseProjversorView} returns it. */
export interface ProjversorViewConfig {
  /**
   * The layers, bottom first, e.g. fires over their smoke. The bottom one
   * drives the clock; the others follow its playhead. At most one vector
   * layer. A single layer can be written flat, as `layer`, `tint`, `style`.
   */
  layers: ProjversorViewLayer[];
  /** The bottom layer's id: `layers[0].layer`. */
  layer: string;
  /** The bottom layer's tint: `layers[0].tint`. */
  tint?: string;
  /** The bottom layer's style: `layers[0].style`. */
  style?: LayerStyleInput;
  preset: string;
  rotate?: [number, number, number];
  zoom?: number;
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
  /** GeoJSON drawn above the layers during this view, e.g. named regions. */
  geojson?: GeoJSONLayer;
}

/** Keys of a stack entry: also the flat keys of a single layer. */
const LAYER_KEYS = ["layer", "tint", "style"] as const;

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
  "layers",
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
  const stack = view.config.layers;
  if (stack !== undefined) {
    invariant(
      Array.isArray(stack) && stack.length > 0,
      `${path}.layers must be a non-empty array`,
    );
    // The first format's style keys too: they would style no layer.
    for (const key of [...LAYER_KEYS, "palette", "vibrant"]) {
      invariant(
        view.config[key] === undefined,
        `${path}.${key} is set in layers, not next to them`,
      );
    }
  }
  // The bottom layer's kind, for the first format's flat keys.
  const bottom = findLayer(
    String(
      stack ? (stack[0] as { layer?: unknown })?.layer : view.config.layer,
    ),
  );
  invariant(
    bottom,
    `${path}.${stack ? "layers.0.layer" : "layer"} is not a projversor layer`,
  );
  const config = migrateLegacy(view.config, path, bottom.kind);
  for (const key of Object.keys(config)) {
    invariant(KEYS.has(key), `${path}.${key} is not a projversor view key`);
  }
  const layers = stack
    ? (stack as unknown[]).map((entry, i) =>
        parseViewLayer(entry, `${path}.layers.${i}`),
      )
    : [
        parseViewLayer(
          Object.fromEntries(LAYER_KEYS.map((key) => [key, config[key]])),
          path,
        ),
      ];
  invariant(
    layers.filter((entry) => findLayer(entry.layer)!.kind === "vector")
      .length <= 1,
    `${path}.layers holds more than one vector layer`,
  );
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
        SPEEDS[bottom.kind].includes(playback.speed as number),
      `${path}.playback.speed must be one of ${SPEEDS[bottom.kind].join(", ")}`,
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
  if (config.wrap !== undefined) {
    invariant(
      typeof config.wrap === "boolean",
      `${path}.wrap must be a boolean`,
    );
  }
  if (config.geojson !== undefined) {
    parseGeoJSONLayer(config.geojson, `${path}.geojson`);
  }
  // The parsed styles: legacy palettes read as their replacement (heat-alert).
  // The bottom layer is mirrored flat, for the single-layer state.
  return {
    ...config,
    ...layers[0],
    layers,
  } as unknown as ProjversorViewConfig;
}

/**
 * Validate a layer of the stack, or the flat keys of a single layer when
 * `path` is the view's: its catalog id, a style it renders, its tint.
 */
function parseViewLayer(value: unknown, path: string): ProjversorViewLayer {
  invariant(isObject(value), `${path} must be an object`);
  for (const key of Object.keys(value)) {
    invariant(
      (LAYER_KEYS as readonly string[]).includes(key),
      `${path}.${key} is not a layer key`,
    );
  }
  const layer = findLayer(String(value.layer));
  invariant(layer, `${path}.layer is not a projversor layer`);
  const entry: ProjversorViewLayer = { layer: String(value.layer) };
  if (value.style !== undefined) {
    const style = parseLayerStyle(value.style, `${path}.style`, {
      kind: layer.kind,
      supports: STYLE_SUPPORT,
    });
    invariant(
      style.palette === undefined ||
        layerPalettes(layer).some((p) => p.id === style.palette),
      `${path}.style.palette is not offered for this layer`,
    );
    entry.style = style;
  }
  if (value.tint !== undefined) {
    invariant(
      layer.kind === "vector" &&
        (value.tint === "" || isTintEntry(String(value.tint))),
      `${path}.tint must be "" or a scalar entry id, on a vector layer`,
    );
    entry.tint = String(value.tint);
  }
  return entry;
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

/**
 * Ids of the layers a story view shows: a slot per stack position, and its
 * GeoJSON. Slots are added bottom up and removed top down, so insertion
 * order, the draw order, stays the stack order.
 */
const viewSlot = (index: number) => `story-layer-${index}`;
const VIEW_GEOJSON = "story-geojson";

/**
 * Story view on one persistent projversor: each scene morphs the view from
 * the previous one, and a layer of the stack reopens only when it changes.
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

  /** Aborted by the next activation: the current one stops between steps. */
  private superseded = new AbortController();
  private queue: Promise<void> = Promise.resolve();

  /**
   * Show a view. Activations run one at a time: one called while another
   * runs waits for it, and is skipped once a later one supersedes it.
   */
  async activate(view: ProjversorViewDefinition): Promise<void> {
    const config = parseProjversorView(view);
    this.superseded.abort();
    const superseded = new AbortController();
    this.superseded = superseded;
    const run = this.queue.then(() => this.show(config, superseded.signal));
    this.queue = run.catch(() => {});
    return run;
  }

  private async show(
    config: ProjversorViewConfig,
    signal: AbortSignal,
  ): Promise<void> {
    const stale = () => signal.aborted;
    if (stale()) {
      return;
    }
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
    const { layers } = config;
    const shown = this.layers;
    for (let i = shown.length - 1; i >= layers.length; i--) {
      await pv.remove(viewSlot(i));
    }
    // Bottom up; a slot giving up the particles to another goes first, as
    // projversor shows one particles layer at a time.
    const order = layers.map((_, i) => i);
    const particles = layers.findIndex(
      (entry) => findLayer(entry.layer)!.kind === "vector",
    );
    const giving = shown.findIndex(
      (handle, i) =>
        handle.type === "particles" && i < layers.length && i !== particles,
    );
    if (particles >= 0 && giving >= 0) {
      order.splice(order.indexOf(giving), 1);
      order.unshift(giving);
    }
    for (const i of order) {
      if (stale()) {
        return;
      }
      await this.showLayer(i, layers[i], state);
    }
    // Once the stack is the view's: the layers above show the playhead's
    // month, so the view resolves with all its data on screen.
    await Promise.all(
      this.layers.slice(1).map((layer) => layer.followed(signal)),
    );
  }

  /** Show `entry` in slot `index`: restyled when it stays, else replaced. */
  private async showLayer(
    index: number,
    entry: ProjversorViewLayer,
    state: ReturnType<typeof projversorState>,
  ): Promise<void> {
    const pv = this.projversor;
    const id = viewSlot(index);
    const layer = findLayer(entry.layer)!;
    // "" is "no tint"; omitted, the layer's own.
    const tint =
      layer.kind === "vector"
        ? entry.tint === ""
          ? null
          : (entry.tint ?? layer.tint ?? null)
        : null;
    const style = entry.style ?? {};
    // The bottom layer drives the clock; the others follow its playhead.
    const clock =
      index === 0
        ? { time: state.time, speed: state.speed, timeRange: state.timeRange }
        : {};
    const handle = pv.get(id) as FieldLayerHandle | undefined;
    if (handle && handle.source.id === layer.id && handle.tint === tint) {
      await handle.update(style);
      if (index === 0) {
        await pv.update(clock);
      }
      return;
    }
    await pv.replace(id, layer.kind === "vector" ? "particles" : "scalar", {
      source: layer.id,
      tint,
      style,
      ...clock,
    });
  }

  /** The stack of the shown view, bottom first. */
  get layers(): FieldLayerHandle[] {
    const layers: FieldLayerHandle[] = [];
    for (
      let handle = this.projversor.get(viewSlot(0));
      handle;
      handle = this.projversor.get(viewSlot(layers.length))
    ) {
      layers.push(handle as FieldLayerHandle);
    }
    return layers;
  }

  /** The bottom layer of the shown view, driving the clock, once one opened. */
  get field(): FieldLayerHandle | undefined {
    return this.projversor.get(viewSlot(0)) as FieldLayerHandle | undefined;
  }

  /** Warm the cache for a view shown next, its whole stack. */
  async preload(view: ProjversorViewDefinition): Promise<void> {
    const { layers, playback, timeRange } = parseProjversorView(view);
    const time = playback?.time ?? timeRange?.start;
    const at = time === undefined ? undefined : Date.parse(String(time));
    await Promise.all(layers.map((entry) => preloadLayer(entry.layer, at)));
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
