import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
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
  Camera,
  VIEW_MS,
  clampZoom,
  type ProjversorViewTarget,
  type Rotate,
} from "./Camera";
import { Clock } from "./Clock";
import {
  FieldLayer,
  checkStyle,
  type FieldLayerEvents,
  type ProjversorMonth,
} from "./FieldLayer";
import {
  PROJVERSOR_LAYERS,
  TINT_LAYERS,
  findLayer,
  loadChunks,
  type ProjversorLayer,
} from "./layers";
import { Overlay } from "./Overlay";
import type { Preset } from "./presets";
import type { LegacyShareState, ShareState } from "./share";
import { SphereParticles } from "./SphereParticles";
import { SphereScalar } from "./SphereScalar";
import { regionView, viewFrame, type Inset, type ViewFrame } from "./view";

export {
  TRANSITION_MS,
  VIEW_MS,
  clampZoom,
  type ProjversorViewTarget,
} from "./Camera";
export { SPEEDS } from "./Clock";
export { STYLE_SUPPORT, type ProjversorMonth } from "./FieldLayer";

/** The camera counts as moving until its view rests this long. */
const MOVE_SETTLE_MS = 100;

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

/** The stage and its three stacked canvases: land below, GL, lines above. */
export interface ProjversorCanvases {
  stage: HTMLElement;
  back: HTMLCanvasElement;
  gl: HTMLCanvasElement;
  front: HTMLCanvasElement;
}

/** Events and their payloads. */
export interface ProjversorEvents extends FieldLayerEvents {
  playing: boolean;
  preset: Preset;
  north: boolean;
  /** After each drawn frame. */
  frame: undefined;
}

export function isTintEntry(id: string | undefined): id is string {
  return TINT_LAYERS.some((l) => l.entryId === id);
}

const landFeature = (topology: unknown) => {
  const t = topology as Topology<{ land: GeometryCollection }>;
  return feature(t, t.objects.land);
};

/**
 * GeoVideo archives on a sphere that morphs between projections: particles
 * for vector layers, a raster for scalar ones. Owns the GL context and the
 * frame loop; the view is the {@link Camera}'s, the playhead the
 * {@link Clock}'s, the shown layer the {@link FieldLayer}'s. Controls stay
 * with the caller.
 */
export class Projversor {
  private readonly gl: WebGL2RenderingContext;
  private readonly particles: SphereParticles;
  private readonly raster: SphereScalar;
  private readonly overlay: Overlay;
  private readonly camera: Camera;
  private readonly clock: Clock;
  private readonly fields: FieldLayer;
  private readonly listeners = new Map<string, Set<(detail: never) => void>>();
  private readonly resizer: ResizeObserver;
  private frameId = 0;
  private destroyed = false;
  private dpr = 1;
  private overlayKey = "";
  private lastMove = 0;
  private detailed = false;
  private last = 0;

  constructor(
    private readonly canvases: ProjversorCanvases,
    initial: Partial<ShareState> = {},
  ) {
    // Premultiplied canvas, composited with view.ts compositeBlend.
    const gl = canvases.gl.getContext("webgl2", {
      antialias: true,
      depth: true,
    });
    if (!gl) {
      throw new Error("WebGL2 is required");
    }
    this.gl = gl;
    this.particles = new SphereParticles(gl);
    this.raster = new SphereScalar(gl);
    this.overlay = new Overlay(canvases.back, canvases.front, {
      land: landFeature(land110),
    });
    // The finer coastline is ten times heavier: load it after first paint.
    import("world-atlas/land-50m.json")
      .then(({ default: land50 }) => {
        if (!this.destroyed) {
          this.overlay.setLandDetail(landFeature(land50));
          this.detailed = false;
        }
      })
      .catch(() => {});
    this.camera = new Camera(
      {
        project: (frame) => this.overlay.setView(frame),
        preset: (preset) => this.emit("preset", preset),
        north: (locked) => this.emit("north", locked),
        refit: () => {
          this.overlayKey = "";
        },
      },
      initial,
    );
    this.clock = new Clock(initial.playing ?? true, (playing) =>
      this.emit("playing", playing),
    );
    this.fields = new FieldLayer(
      gl,
      this.clock,
      this.particles,
      this.raster,
      {
        // ProjversorEvents extends FieldLayerEvents: the same payload types.
        emit: (type, detail) =>
          this.emit(type, detail as ProjversorEvents[typeof type]),
        shown: (layer) => {
          this.overlay.fillLand = layer.fillLand;
          this.overlayKey = "";
        },
      },
      gradeToColorGrade(initial.style?.particles?.grade),
    );
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(canvases.stage);
    this.resize();
    this.frameId = requestAnimationFrame((now) => this.tick(now));
  }

  // ---- events ------------------------------------------------------------

  /** Listen to an event; returns the unsubscribe function. */
  on<K extends keyof ProjversorEvents>(
    type: K,
    listener: (detail: ProjversorEvents[K]) => void,
  ): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (detail: never) => void);
    return () => set.delete(listener as (detail: never) => void);
  }

  private emit<K extends keyof ProjversorEvents>(
    type: K,
    detail: ProjversorEvents[K],
  ): void {
    for (const listener of this.listeners.get(type) ?? []) {
      (listener as (detail: ProjversorEvents[K]) => void)(detail);
    }
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

  private resize(): void {
    const { stage, back, gl, front } = this.canvases;
    const { clientWidth: width, clientHeight: height } = stage;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const canvas of [back, gl, front]) {
      canvas.width = Math.round(width * this.dpr);
      canvas.height = Math.round(height * this.dpr);
    }
    this.camera.resize(width, height);
    this.particles.resize(gl.width, gl.height);
  }

  /**
   * Versor drag, pinch and wheel zoom on the front canvas; the stage gets
   * the `dragging` class during a drag. Returns the detach function.
   */
  attachInteraction(): () => void {
    return this.camera.attachInteraction(
      this.canvases.stage,
      this.canvases.front,
    );
  }

  // ---- frame -------------------------------------------------------------

  private tick(now: number): void {
    if (this.destroyed) {
      return;
    }
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.camera.animate(now);
    this.fields.advanceTime(dt);
    const frame = viewFrame(this.camera.view);
    this.drawOverlay(frame, now);
    this.drawField(frame, now);
    this.emit("frame", undefined);
    this.frameId = requestAnimationFrame((t) => this.tick(t));
  }

  /** Clear the GL canvas, then draw the open field. */
  private drawField(frame: ViewFrame, now: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.fields.draw(frame, now, now - this.lastMove < MOVE_SETTLE_MS);
  }

  /** Coastlines and graticule: coarse while the view moves, then detailed. */
  private drawOverlay(frame: ViewFrame, now: number): void {
    const key = JSON.stringify([
      frame.rotate,
      frame.zoom,
      frame.blend.t,
      frame.blend.a.id,
      frame.blend.b.id,
      frame.width,
      frame.height,
      frame.inset,
    ]);
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      this.lastMove = now;
      this.detailed = false;
      this.overlay.draw(frame, this.dpr, false);
    } else if (!this.detailed && now - this.lastMove > 180) {
      this.detailed = true;
      this.overlay.draw(frame, this.dpr, true);
    }
  }

  /** Stop the frame loop and free GL resources and listeners. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    this.resizer.disconnect();
    this.fields.destroy();
    this.particles.destroy();
    this.raster.destroy();
    this.listeners.clear();
  }
}
