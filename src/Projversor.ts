import type {
  CatalogGeoVideoSource,
  LayerStyleInput,
} from "@fxi/zartigl/catalog";
import { gradeToColorGrade } from "@fxi/zartigl/engine";
import type { Camera, Rotate } from "./Camera";
import { Emitter } from "./emitter";
import {
  FieldLayer,
  checkStyle,
  type FieldLayerEvents,
  type ProjversorMonth,
} from "./FieldLayer";
import {
  parseGeoJSONLayer,
  type GeoJSONLayer,
  type GeoJSONStyle,
} from "./geojson";
import { findLayer, type ProjversorLayer } from "./layers";
import {
  SphereImage,
  loadImage,
  parseImageBounds,
  type ImageSource,
} from "./SphereImage";
import { Stage, type StageEvents, type StageInitial } from "./Stage";
import type { Inset } from "./view";

/** Field layer types and the catalog kind of their source. */
const SOURCE_KIND = { particles: "vector", scalar: "scalar" } as const;

export type FieldLayerType = keyof typeof SOURCE_KIND;
export type ProjversorLayerType = FieldLayerType | "image" | "geojson";

/** A georeferenced image: equirectangular, north up. */
export interface ImageLayerConfig {
  /** Image url (loaded cross-origin) or a loaded image, bitmap or canvas. */
  image: string | ImageSource;
  /**
   * West, south, east, north in degrees; east may pass 180 to cross the
   * antimeridian. A 360° span repeats across the seam.
   */
  bounds: [number, number, number, number];
  style?: ImageStyle;
}

export interface ImageStyle {
  /** 0–1, over the image alpha. Default 1. */
  opacity?: number;
}

/**
 * A small GeoJSON drawn as lines (and optional fill and labels) above the
 * fields; `data` in lon/lat degrees.
 */
export type GeoJSONLayerConfig = GeoJSONLayer;

/** A GeoVideo layer from the catalog. */
export interface FieldLayerConfig {
  /** Projversor layer id, or catalog entry id, with a GeoVideo archive. */
  source: string;
  /**
   * Particles only: scalar entry id coloring them, null for speed colors.
   * Default: the source layer's own tint, if any.
   */
  tint?: string | null;
  /** Style over the source's own: palette, particles, raster. */
  style?: LayerStyleInput;
}

export interface ProjversorOptions extends StageInitial {
  /** Playhead, epoch ms. Default: the latest month of the first layer. */
  time?: number;
  /** Drag, pinch and wheel on the view. Default true. */
  interactive?: boolean;
}

/** View and playback; omitted keys keep their value. */
export interface ProjversorState {
  /** Projection preset id: morphs to it, with its rotation and zoom. */
  preset?: string;
  rotate?: Rotate;
  zoom?: number;
  /** Free zone the sphere is centered and fitted in, css px. */
  inset?: Inset;
  /** Ease the view (default), or jump to it. */
  animate?: boolean;
  durationMs?: number;
  /** Playhead, epoch ms. */
  time?: number;
  playing?: boolean;
  /** Playback speed multiplier, one of SPEEDS for the clock layer's kind. */
  speed?: number;
}

/** Events and their payloads. */
export interface ProjversorEvents extends StageEvents {
  /** Loading progress of a layer; "" once it shows. */
  status: { id: string; text: string };
  /** A month of a layer was decoded and is displayed. */
  month: { id: string; month: ProjversorMonth };
  palette: { id: string; palette: string };
}

/** The view controls of a projversor. */
export type ProjversorView = Pick<
  Camera,
  | "preset"
  | "rotate"
  | "zoom"
  | "bearing"
  | "northLocked"
  | "inset"
  | "goTo"
  | "jumpTo"
  | "easeTo"
  | "zoomBy"
  | "rotateBy"
  | "setBearing"
  | "toggleNorth"
  | "target"
  | "setInset"
  | "northAngle"
  | "outline"
>;

/** A particles or scalar layer added to a projversor. */
export class FieldLayerHandle {
  constructor(
    readonly id: string,
    readonly type: FieldLayerType,
    private readonly field: FieldLayer,
  ) {}

  /** The source layer: label, kind, catalog entry. */
  get source(): ProjversorLayer {
    return this.field.layer;
  }

  get palette(): string {
    return this.field.palette;
  }

  /** Scalar entry id coloring the particles, or null. */
  get tint(): string | null {
    return this.field.tintId;
  }

  /** Month chunks of the archive and the displayed one. */
  get chunks(): readonly CatalogGeoVideoSource[] {
    return this.field.chunks;
  }

  get chunkIndex(): number {
    return this.field.chunkIndex;
  }

  /** Frame times of the displayed month. */
  get times(): readonly number[] {
    return this.field.times;
  }

  /** True for the layer whose months drive the playhead. */
  get driving(): boolean {
    return this.field.driving;
  }

  /** Replace the style override over the source's own (`{}` clears it). */
  async update(style: LayerStyleInput): Promise<void> {
    const field = this.field;
    checkStyle(style, field.layer);
    field.restyle(style);
    const palette = field.stylePalette(field.layer);
    if (palette !== field.palette) {
      field.applyPalette(palette);
    }
  }
}

/** A GeoJSON layer added to a projversor. */
export class GeoJSONLayerHandle {
  readonly type = "geojson";

  constructor(
    readonly id: string,
    private layer: GeoJSONLayer,
    private readonly show: (layer: GeoJSONLayer) => void,
  ) {}

  get data(): GeoJSONLayer["data"] {
    return this.layer.data;
  }

  get style(): GeoJSONStyle {
    return { ...this.layer.style };
  }

  /** Replace the style; drawn from the next frame. */
  async update(style: GeoJSONStyle): Promise<void> {
    const layer = parseGeoJSONLayer(
      { data: this.layer.data, style },
      `projversor layer "${this.id}"`,
    );
    this.layer = layer;
    this.show(layer);
  }
}

/** What an image layer draws, shared by its entry and its handle. */
interface ImageState {
  sphere: SphereImage;
  opacity: number;
}

function imageOpacity(style: ImageStyle | undefined, path: string): number {
  const opacity = style?.opacity ?? 1;
  if (!(opacity >= 0 && opacity <= 1)) {
    throw new Error(`${path}.style.opacity must be within 0–1`);
  }
  return opacity;
}

/** A georeferenced image added to a projversor. */
export class ImageLayerHandle {
  readonly type = "image";

  constructor(
    readonly id: string,
    private readonly state: ImageState,
  ) {}

  /** West, south, east, north in degrees. */
  get bounds(): readonly number[] {
    return this.state.sphere.bounds;
  }

  get style(): Required<ImageStyle> {
    return { opacity: this.state.opacity };
  }

  /** Replace the style; drawn from the next frame. */
  async update(style: ImageStyle): Promise<void> {
    this.state.opacity = imageOpacity(style, `projversor layer "${this.id}"`);
  }
}

export type ProjversorLayerHandle =
  | FieldLayerHandle
  | ImageLayerHandle
  | GeoJSONLayerHandle;

type Entry =
  | {
      type: FieldLayerType;
      field: FieldLayer;
      image: null;
      handle: FieldLayerHandle;
    }
  | { type: "image"; field: null; image: ImageState; handle: ImageLayerHandle }
  | { type: "geojson"; field: null; image: null; handle: GeoJSONLayerHandle };

/**
 * Catalog layers on a sphere that morphs between world projections, for
 * standalone pages and stories:
 *
 * ```ts
 * const pv = new Projversor(root, { preset: "globe" });
 * await pv.init();
 * await pv.add("currents", "particles", { source: "ocean-current-velocity" });
 * await pv.update({ preset: "world", playing: true });
 * ```
 *
 * The first layer added drives the playhead through its months; the others
 * follow it. One particles layer at a time.
 */
export class Projversor {
  private readonly events = new Emitter<ProjversorEvents>();
  private readonly layers = new Map<string, Entry>();
  private stage: Stage | null = null;
  private detach: (() => void) | null = null;
  private canvases: HTMLCanvasElement[] = [];
  private destroyed = false;
  /** The playhead was set: layers open at it, else at their latest month. */
  private timeSet: boolean;

  constructor(
    private readonly root: HTMLElement,
    private readonly options: ProjversorOptions = {},
  ) {
    this.timeSet = options.time !== undefined;
  }

  /**
   * Create the canvases in the root and the GL context, and start drawing.
   * Resolves once the detailed coastlines are in use.
   */
  async init(): Promise<void> {
    if (this.destroyed) {
      throw new Error("projversor: destroyed");
    }
    if (this.stage) {
      return;
    }
    const root = this.root;
    const doc = root.ownerDocument;
    if (doc.defaultView?.getComputedStyle(root).position === "static") {
      root.style.position = "relative";
    }
    const canvas = () => {
      const c = doc.createElement("canvas");
      c.style.cssText =
        "position: absolute; inset: 0; width: 100%; height: 100%";
      root.append(c);
      return c;
    };
    const [back, gl, front] = [canvas(), canvas(), canvas()];
    this.canvases = [back, gl, front];
    const stage = new Stage(
      { stage: root, back, gl, front },
      this.events,
      this.options,
    );
    this.stage = stage;
    if (this.options.time !== undefined) {
      stage.clock.ms = this.options.time;
    }
    stage.start({
      advance: (dt) => this.driver()?.advanceTime(dt),
      draw: (frame, now, moving) => {
        for (const { field, image } of this.layers.values()) {
          if (field) {
            field.follow();
            field.draw(frame, now, moving);
          } else if (image) {
            image.sphere.draw(frame, image.opacity);
          }
        }
      },
    });
    if (this.options.interactive ?? true) {
      this.detach = stage.attachInteraction();
    }
    await stage.landDetail;
  }

  // ---- events ------------------------------------------------------------

  /** Listen to an event; returns the unsubscribe function. */
  on<K extends keyof ProjversorEvents>(
    type: K,
    listener: (detail: ProjversorEvents[K]) => void,
  ): () => void {
    return this.events.on(type, listener);
  }

  // ---- layers ------------------------------------------------------------

  /**
   * Add a layer on top of the others. A catalog layer resolves once its
   * first frame is decoded, and rejects for an unknown source, a source of
   * another kind than `type`, or a second particles layer. An image
   * resolves once loaded; fields and images draw in the order added. A
   * GeoJSON layer is drawn above them all, whatever the order.
   */
  async add(
    id: string,
    type: "geojson",
    config: GeoJSONLayerConfig,
  ): Promise<GeoJSONLayerHandle>;
  async add(
    id: string,
    type: "image",
    config: ImageLayerConfig,
  ): Promise<ImageLayerHandle>;
  async add(
    id: string,
    type: FieldLayerType,
    config: FieldLayerConfig,
  ): Promise<FieldLayerHandle>;
  async add(
    id: string,
    type: ProjversorLayerType,
    config: FieldLayerConfig | ImageLayerConfig | GeoJSONLayerConfig,
  ): Promise<ProjversorLayerHandle> {
    const stage = this.requireStage();
    if (this.layers.has(id)) {
      throw new Error(`projversor: layer "${id}" already exists`);
    }
    if (type === "geojson") {
      const layer = parseGeoJSONLayer(config, `projversor layer "${id}"`);
      const handle = new GeoJSONLayerHandle(id, layer, (shown) =>
        stage.setGeoJSON(id, shown),
      );
      this.layers.set(id, { type, field: null, image: null, handle });
      stage.setGeoJSON(id, layer);
      return handle;
    }
    if (type === "image") {
      const path = `projversor layer "${id}"`;
      const { image, bounds, style } = config as ImageLayerConfig;
      const box = parseImageBounds(bounds, `${path}.bounds`);
      const opacity = imageOpacity(style, path);
      const source = await loadImage(image, this.root.ownerDocument);
      if (this.destroyed || this.layers.has(id)) {
        throw new Error(`projversor: layer "${id}" was superseded`);
      }
      const state = { sphere: new SphereImage(stage.gl, source, box), opacity };
      const handle = new ImageLayerHandle(id, state);
      this.layers.set(id, { type, field: null, image: state, handle });
      return handle;
    }
    if (!(type in SOURCE_KIND)) {
      throw new Error(`projversor: unknown layer type "${type}"`);
    }
    const { source, tint, style } = config as FieldLayerConfig;
    const layer = findLayer(source);
    if (!layer) {
      throw new Error(`projversor: unknown source "${source}"`);
    }
    if (layer.kind !== SOURCE_KIND[type]) {
      throw new Error(
        `projversor: "${source}" is a ${layer.kind} source, not ${type}`,
      );
    }
    if (type === "particles" && this.has("particles")) {
      throw new Error("projversor: one particles layer at a time");
    }
    checkStyle(style, layer);
    const field = new FieldLayer(
      stage.gl,
      stage.clock,
      stage.particles,
      stage.raster,
      {
        emit: (event, detail) => this.relay(id, event, detail),
        shown: () => this.updateLandFill(),
      },
      gradeToColorGrade(style?.particles?.grade),
    );
    field.driving = !this.driver();
    const handle = new FieldLayerHandle(id, type, field);
    this.layers.set(id, { type, field, image: null, handle });
    try {
      await field.open(layer, {
        at: this.timeSet ? stage.clock.ms : undefined,
        tint,
        style,
      });
    } catch (error) {
      this.drop(id);
      throw error;
    }
    this.timeSet = true;
    return handle;
  }

  /** The layer added as `id`. */
  get(id: string): ProjversorLayerHandle | undefined {
    return this.layers.get(id)?.handle;
  }

  /** Ids of the layers, in insertion order. */
  get ids(): string[] {
    return [...this.layers.keys()];
  }

  /** Remove a layer; the next one drives the playhead if it did. */
  async remove(id: string): Promise<void> {
    this.drop(id);
  }

  private drop(id: string): void {
    const entry = this.layers.get(id);
    if (!entry) {
      return;
    }
    this.layers.delete(id);
    if (entry.image) {
      entry.image.sphere.destroy();
      return;
    }
    if (!entry.field) {
      this.stage?.setGeoJSON(id, null);
      return;
    }
    entry.field.destroy();
    if (entry.field.driving) {
      const next = this.fields()[0];
      if (next) {
        next.driving = true;
        void next.seek(this.requireStage().clock.ms);
      }
    }
    this.updateLandFill();
  }

  private has(type: ProjversorLayerType): boolean {
    return [...this.layers.values()].some((e) => e.type === type);
  }

  /** The catalog layers, bottom first. */
  private fields(): FieldLayer[] {
    const fields: FieldLayer[] = [];
    for (const { field } of this.layers.values()) {
      if (field) {
        fields.push(field);
      }
    }
    return fields;
  }

  /** The layer whose months drive the playhead. */
  private driver(): FieldLayer | undefined {
    return this.fields().find((field) => field.driving);
  }

  /** Land is drawn opaque unless a shown layer also covers land. */
  private updateLandFill(): void {
    const fill = this.fields().every(
      (field) => !field.opened || field.layer.fillLand,
    );
    this.stage?.setFillLand(fill);
  }

  private relay<K extends keyof FieldLayerEvents>(
    id: string,
    type: K,
    detail: FieldLayerEvents[K],
  ): void {
    if (type === "status") {
      this.events.emit("status", { id, text: detail as string });
    } else if (type === "month") {
      this.events.emit("month", { id, month: detail as ProjversorMonth });
    } else if (type === "palette") {
      this.events.emit("palette", { id, palette: detail as string });
    }
  }

  // ---- view and playback -------------------------------------------------

  /** View controls: presets, easing, bearing, free zone, outline. */
  get view(): ProjversorView {
    return this.requireStage().camera;
  }

  /** Playhead, epoch ms. */
  get time(): number {
    return this.requireStage().clock.ms;
  }

  get playing(): boolean {
    return this.requireStage().clock.playing;
  }

  /** Change the view and playback; a preset morphs the projection. */
  async update(state: ProjversorState): Promise<void> {
    const stage = this.requireStage();
    const { animate = true, durationMs } = state;
    const { preset, rotate, zoom, inset } = state;
    if (
      preset !== undefined ||
      rotate !== undefined ||
      zoom !== undefined ||
      inset !== undefined
    ) {
      const target = { preset, rotate, zoom, inset, durationMs };
      if (animate) {
        stage.camera.goTo(target);
      } else {
        stage.camera.jumpTo(target);
      }
    }
    if (state.playing !== undefined) {
      stage.clock.setPlaying(state.playing);
    }
    const driver = this.driver();
    if (state.speed !== undefined && driver) {
      stage.clock.setKindSpeed(driver.layer.kind, state.speed);
    }
    if (state.time !== undefined) {
      if (driver) {
        await driver.seek(state.time);
      } else {
        stage.clock.ms = state.time;
        this.timeSet = true;
      }
    }
  }

  /** Stop drawing, free the GL resources and remove the canvases. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    for (const { field, image } of this.layers.values()) {
      field?.destroy();
      image?.sphere.destroy();
    }
    this.layers.clear();
    this.detach?.();
    this.stage?.destroy();
    for (const canvas of this.canvases) {
      canvas.remove();
    }
    this.events.clear();
  }

  private requireStage(): Stage {
    if (!this.stage || this.destroyed) {
      throw new Error("projversor: call init() first");
    }
    return this.stage;
  }
}
