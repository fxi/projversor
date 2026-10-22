import {
  mergeStyles,
  sourceCoversTime,
  styleForKind,
  type CatalogGeoVideoSource,
  type LayerStyleInput,
} from "@fxi/zartigl/catalog";
import {
  colorGradeToGrade,
  gradeToColorGrade,
  loadGeoVideoManifest,
  type ColorGrade,
} from "@fxi/zartigl/engine";
import {
  VIEW_MS,
  clampZoom,
  type ProjversorViewTarget,
  type Rotate,
} from "./Camera";
import type { Camera } from "./Camera";
import type { Clock } from "./Clock";
import { Emitter } from "./emitter";
import { FieldLayer, checkStyle, type FieldLayerEvents } from "./FieldLayer";
import type { GeoJSONLayer } from "./geojson";
import {
  PROJVERSOR_LAYERS,
  TINT_LAYERS,
  findLayer,
  loadChunks,
  type ProjversorLayer,
} from "./layers";
import type { Preset } from "./presets";
import type { LegacyShareState, ShareState } from "./share";
import { Stage, type ProjversorCanvases, type StageEvents } from "./Stage";
import { regionView, type Inset } from "./view";

export {
  TRANSITION_MS,
  VIEW_MS,
  clampZoom,
  type ProjversorViewTarget,
} from "./Camera";
export { SPEEDS } from "./Clock";
export { STYLE_SUPPORT, type ProjversorMonth } from "./FieldLayer";
export type { ProjversorCanvases } from "./Stage";

const warned = new Set<string>();

/**
 * The deprecated flat `palette` and `grade` of a state, as a style, with a
 * one-time warning each.
 */
function legacyStyle(state: LegacyShareState): LayerStyleInput | undefined {
  const { palette, grade } = state;
  const moved = { palette: "style.palette", grade: "style.particles.grade" };
  for (const key of ["palette", "grade"] as const) {
    if (state[key] !== undefined && !warned.has(key)) {
      warned.add(key);
      console.warn(`projversor state.${key} is deprecated: use ${moved[key]}`);
    }
  }
  return palette === undefined && grade === undefined
    ? undefined
    : mergeStyles({
        palette,
        particles: { grade: grade && colorGradeToGrade(grade) },
      });
}

/** Events and their payloads. */
export interface LegacyProjversorEvents extends StageEvents, FieldLayerEvents {}

export function isTintEntry(id: string | undefined): id is string {
  return TINT_LAYERS.some((l) => l.entryId === id);
}

/**
 * GeoVideo archives on a sphere that morphs between projections: particles
 * for vector layers, a raster for scalar ones. One layer shows at a time,
 * driven by share states ({@link apply}). The GL context, view, playhead
 * and frame loop are the {@link Stage}'s; controls stay with the caller.
 */
export class LegacyProjversor {
  private readonly events = new Emitter<LegacyProjversorEvents>();
  private readonly stage: Stage;
  private readonly fields: FieldLayer;
  private destroyed = false;

  constructor(canvases: ProjversorCanvases, initial: Partial<ShareState> = {}) {
    const stage = new Stage(canvases, this.events, initial);
    this.stage = stage;
    this.fields = new FieldLayer(
      stage.gl,
      stage.clock,
      stage.particles,
      stage.raster,
      {
        // LegacyProjversorEvents extends FieldLayerEvents: the same payload types.
        emit: (type, detail) =>
          this.events.emit(type, detail as LegacyProjversorEvents[typeof type]),
        shown: (layer) => stage.setFillLand(layer.fillLand),
      },
      gradeToColorGrade(initial.style?.particles?.grade),
    );
    stage.start({
      advance: (dt) => this.fields.advanceTime(dt),
      draw: (frame, now, moving) => this.fields.draw(frame, now, moving),
    });
  }

  private get camera(): Camera {
    return this.stage.camera;
  }

  private get clock(): Clock {
    return this.stage.clock;
  }

  // ---- events ------------------------------------------------------------

  /** Listen to an event; returns the unsubscribe function. */
  on<K extends keyof LegacyProjversorEvents>(
    type: K,
    listener: (detail: LegacyProjversorEvents[K]) => void,
  ): () => void {
    return this.events.on(type, listener);
  }

  // ---- state -------------------------------------------------------------

  get layer(): ProjversorLayer {
    return this.fields.layer;
  }

  /** Scalar entry id coloring the particles, or null. */
  get tintId(): string | null {
    return this.fields.tintId;
  }

  get palette(): string {
    return this.fields.palette;
  }

  get grade(): ColorGrade {
    return this.fields.grade;
  }

  get preset(): Preset {
    return this.camera.preset;
  }

  get playing(): boolean {
    return this.clock.playing;
  }

  /** Playback speed multiplier of the open layer. */
  get speed(): number {
    return this.fields.speed;
  }

  /** Month chunks of the open layer and the displayed one. */
  get chunks(): readonly CatalogGeoVideoSource[] {
    return this.fields.chunks;
  }

  get chunkIndex(): number {
    return this.fields.chunkIndex;
  }

  /** Playhead, epoch ms. */
  get time(): number {
    return this.clock.ms;
  }

  /** Frame times of the displayed month. */
  get times(): readonly number[] {
    return this.fields.times;
  }

  /** Playhead position in the displayed month, 0–1. */
  get progress(): number {
    const times = this.times;
    if (times.length < 2) {
      return 0;
    }
    return (this.clock.ms - times[0]) / (times[times.length - 1] - times[0]);
  }

  get rotate(): Rotate {
    return this.camera.rotate;
  }

  get zoom(): number {
    return this.camera.zoom;
  }

  get bearing(): number {
    return this.camera.bearing;
  }

  /** Drags keep north up (gamma 0), as d3-geo-zoom's northUp. */
  get northLocked(): boolean {
    return this.camera.northLocked;
  }

  set northLocked(locked: boolean) {
    this.camera.northLocked = locked;
  }

  /** Everything needed to reproduce the displayed view. */
  getState(): ShareState {
    const layer = this.fields.layer;
    return {
      layer: layer.id,
      time: this.clock.ms,
      preset: this.camera.preset.id,
      rotate: [...this.camera.rotate],
      zoom: this.camera.zoom,
      playing: this.clock.playing,
      speed: this.speed,
      tint: this.fields.tintId ?? "",
      style: styleForKind(this.fields.viewStyle, layer.kind),
    };
  }

  /**
   * Show a state: unknown ids fall back to the layer's own choices. The
   * layer reopens only when it or its tint changes. A view in the state
   * keeps its own framing, else a regional layer is framed. A `style`
   * replaces the previous override over the layer's own style (`{}` clears
   * it) once the layer shows; without one, the current override stays.
   * The deprecated flat `palette` and `grade` patch it, `style` winning.
   */
  async apply(
    state: Partial<ShareState> & LegacyShareState,
    options: { animate?: boolean; durationMs?: number } = {},
  ): Promise<void> {
    const { animate = true, durationMs } = options;
    const fields = this.fields;
    const layer =
      findLayer(state.layer) ??
      (fields.opened ? fields.layer : PROJVERSOR_LAYERS[0]);
    checkStyle(state.style, layer);
    const legacy = legacyStyle(state);
    const style =
      legacy === undefined
        ? state.style
        : styleForKind(
            state.style === undefined
              ? mergeStyles(fields.viewStyle, legacy)
              : mergeStyles(legacy, state.style),
            layer.kind,
          );
    const hasView =
      state.preset !== undefined ||
      state.rotate !== undefined ||
      state.zoom !== undefined;
    if (hasView) {
      const target = { ...state, durationMs };
      if (animate) {
        this.goTo(target);
      } else {
        this.jumpTo(target);
      }
    }
    if (state.playing !== undefined) {
      this.setPlaying(state.playing);
    }
    // "" is "no tint"; unknown ids fall back to the layer's own.
    const tintOption =
      state.tint === ""
        ? null
        : isTintEntry(state.tint)
          ? state.tint
          : undefined;
    const tint =
      layer.kind === "vector"
        ? tintOption === undefined
          ? (layer.tint ?? null)
          : tintOption
        : null;
    if (
      !fields.opened ||
      layer.id !== fields.layer.id ||
      tint !== fields.tintId
    ) {
      await this.open(layer, {
        at: state.time,
        tint,
        speed: state.speed,
        frame: !hasView,
        style,
      });
      return;
    }
    if (style !== undefined) {
      fields.restyle(style);
      const palette = fields.stylePalette(layer);
      if (palette !== fields.palette) {
        fields.applyPalette(palette);
      }
    }
    this.clock.setKindSpeed(layer.kind, state.speed);
    if (state.time !== undefined) {
      await this.seek(state.time);
    }
  }

  // ---- layers (see FieldLayer) -------------------------------------------

  /**
   * Switch layer, opening the month that holds `at`, else the displayed
   * month when the archive has it, else the latest. The palette is the
   * view style's, else the layer's own; the tint defaults to the layer's.
   * `frame` centers the view on a regional layer. The style applies once
   * the layer shows.
   */
  async open(
    layerOrId: ProjversorLayer | string,
    options: {
      at?: number;
      tint?: string | null;
      /** Playback speed, applied with the layer when it is one of its kind. */
      speed?: number;
      frame?: boolean;
      /** Style override replacing the current one. */
      style?: LayerStyleInput;
    } = {},
  ): Promise<void> {
    const { frame = true, ...rest } = options;
    const shown = await this.fields.open(layerOrId, rest);
    const bounds = this.fields.bounds;
    const region =
      shown && frame && bounds ? regionView(bounds, this.camera.view) : null;
    if (region) {
      this.camera.easeTo(region.rotate, clampZoom(region.zoom));
    }
  }

  /** Open month `index` of the open layer at its start. */
  openMonth(index: number): Promise<void> {
    return this.fields.openMonth(index);
  }

  /** Move the playhead, opening the month that holds `ms` when needed. */
  seek(ms: number): Promise<void> {
    return this.fields.seek(ms);
  }

  /** Move the playhead within the displayed month. */
  scrub(ms: number): void {
    this.fields.scrub(ms);
  }

  /**
   * Warm the HTTP cache with a layer's index and the manifest of the month
   * holding `at`, so a later {@link open} starts sooner.
   */
  async preload(layerId: string, at?: number): Promise<void> {
    const layer = findLayer(layerId);
    if (!layer) {
      return;
    }
    const chunks = await loadChunks(layer.entryId);
    const chunk =
      (at === undefined
        ? undefined
        : chunks.find((c) => sourceCoversTime(c, { time: at }))) ??
      chunks[chunks.length - 1];
    if (chunk) {
      await loadGeoVideoManifest(chunk.manifestUrl);
    }
  }

  // ---- styling and playback ----------------------------------------------

  /** Set the view style's palette, shown when the layer offers it. */
  setPalette(id: string): void {
    this.fields.setPalette(id);
  }

  /** Set the view style's particle grade. */
  setGrade(grade: ColorGrade): void {
    this.fields.setGrade(grade);
  }

  /** Playback speed multiplier of the open layer's kind. */
  setSpeed(speed: number): void {
    this.fields.setSpeed(speed);
  }

  setPlaying(playing: boolean): void {
    this.clock.setPlaying(playing);
  }

  /** Hold playback, e.g. while a timeline thumb is held. */
  setHeld(held: boolean): void {
    this.clock.held = held;
  }

  // ---- view (see Camera) -------------------------------------------------

  goTo(target: ProjversorViewTarget): void {
    this.camera.goTo(target);
  }

  jumpTo(target: ProjversorViewTarget): void {
    this.camera.jumpTo(target);
  }

  easeTo(rotate: Rotate, zoom: number, duration = VIEW_MS): void {
    this.camera.easeTo(rotate, zoom, duration);
  }

  zoomBy(factor: number): void {
    this.camera.zoomBy(factor);
  }

  rotateBy(deg: number): void {
    this.camera.rotateBy(deg);
  }

  setBearing(deg: number): void {
    this.camera.setBearing(deg);
  }

  toggleNorth(): void {
    this.camera.toggleNorth();
  }

  target(): { rotate: Rotate; zoom: number } {
    return this.camera.target();
  }

  setInset(inset: Inset, durationMs = VIEW_MS): void {
    this.camera.setInset(inset, durationMs);
  }

  get inset(): Inset {
    return this.camera.inset;
  }

  northAngle(): number | null {
    return this.camera.northAngle();
  }

  outline(): [number, number][] {
    return this.camera.outline();
  }

  /**
   * Show a GeoJSON layer above everything, or remove it (null). A bridge
   * for the story views until they use {@link Projversor}.
   */
  setGeoJSON(id: string, layer: GeoJSONLayer | null): void {
    this.stage.setGeoJSON(id, layer);
  }

  /**
   * Versor drag, pinch and wheel zoom on the front canvas; the stage gets
   * the `dragging` class during a drag. Returns the detach function.
   */
  attachInteraction(): () => void {
    return this.stage.attachInteraction();
  }

  /** Stop the frame loop and free GL resources and listeners. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.fields.destroy();
    this.stage.destroy();
    this.events.clear();
  }
}
