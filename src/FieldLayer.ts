import {
  mergeStyles,
  parseLayerStyle,
  requireCatalogEntry,
  resolveEntryStyle,
  resolveLayerStyle,
  sourceCoversTime,
  type CatalogGeoVideoSource,
  type LayerStyle,
  type LayerStyleInput,
} from "@fxi/zartigl/catalog";
import {
  backdropVec4,
  COLOR_GRADE_OFF,
  TrailFade,
  colorGradeToGrade,
  gradeToColorGrade,
  createColorRampTexture,
  fadeToFrames,
  fadeToOpacity,
  loadGeoVideoManifest,
  pairChunk,
  type ColorGrade,
} from "@fxi/zartigl/engine";
import type { Clock } from "./Clock";
import { GeoVideoField } from "./GeoVideoField";
import {
  PROJVERSOR_LAYERS,
  findLayer,
  layerPalettes,
  loadChunks,
  loadTintChunks,
  type ProjversorLayer,
} from "./layers";
import { particleCount, particleSpeedFactor } from "./scales";
import {
  visibleCap,
  type ParticleStyle,
  type SphereParticles,
} from "./SphereParticles";
import type { SphereScalar } from "./SphereScalar";
import type { ViewFrame } from "./view";

/** Field time steps played per second at 1×. */
const STEPS_PER_SECOND = 0.4;
/** Fraction of a month after which the next one is decoded. */
const PREFETCH_AT = 0.6;
/** zartigl particle respawn: per frame, plus per m/s of local speed. */
const DROP_RATE = 0.003;
const DROP_RATE_BUMP = 0.01;
/**
 * zartigl's REDISTRIB_*: a transient drop-rate boost after a view change, so
 * particles spread over the new view instead of lingering in the old one.
 */
const REDISTRIB_DECAY = 0.92;
const REDISTRIB_MAX_DROP = 0.1;
/** Frames still animated while paused, to rebuild trails after a change. */
const SETTLE_FRAMES_MAX = 120;

/** Style keys projversor renders. */
export const STYLE_SUPPORT = {
  palette: true,
  particles: ["density", "speed", "fade", "grade", "backdrop"],
  raster: ["opacity", "vibrance"],
} as const;

/** Validate a style against what projversor renders for `layer`. */
export function checkStyle(
  style: LayerStyleInput | undefined,
  layer: ProjversorLayer,
): void {
  if (style !== undefined) {
    parseLayerStyle(style, "style", {
      kind: layer.kind,
      supports: STYLE_SUPPORT,
    });
  }
}

/** The fields of one month: the layer field and its optional tint. */
export interface ProjversorMonth {
  field: GeoVideoField;
  tint: GeoVideoField | null;
}

function destroyMonth(month: ProjversorMonth): void {
  month.field.destroy();
  month.tint?.destroy();
}

interface Upcoming {
  index: number;
  month: ProjversorMonth | null;
}

/** Events of a field layer and their payloads. */
export interface FieldLayerEvents {
  status: string;
  /** A layer was chosen; its month chunks are known, not yet decoded. */
  layer: ProjversorLayer;
  /** A month was decoded and is displayed. */
  month: ProjversorMonth;
  palette: string;
}

/** What a field layer needs from its owner. */
export interface FieldLayerHost {
  emit<K extends keyof FieldLayerEvents>(
    type: K,
    detail: FieldLayerEvents[K],
  ): void;
  /** A layer shows from this frame on. */
  shown(layer: ProjversorLayer): void;
}

/**
 * A GeoVideo catalog layer on the sphere: its month archives and optional
 * tint, their loading and playback, its style, and its drawing as particles
 * (vector) or a raster (scalar).
 */
export class FieldLayer {
  private readonly trailFade = new TrailFade(fadeToOpacity(0.7));
  private destroyed = false;
  /** Drop-rate boost after a view change, and the view it was measured on. */
  private redistribution = 0;
  private lastScale = 0;
  private lastCenter: [number, number, number] = [1, 0, 0];
  /** Frames left to animate while paused. */
  private settle = 0;
  private paletteId = "";
  private ramp: WebGLTexture | null = null;
  private gradeValue: ColorGrade = COLOR_GRADE_OFF;
  private layerValue: ProjversorLayer = PROJVERSOR_LAYERS[0];
  private openedValue = false;
  /** `u_solid` of the particle backdrop; alpha 0 when off. */
  private backdrop: [number, number, number, number] = [0, 0, 0, 0];
  private rasterOpacity = 1;
  private rasterVibrance = 0;
  private field: GeoVideoField | null = null;
  private tint: GeoVideoField | null = null;
  private tintIdValue: string | null = null;
  private tintChunks: CatalogGeoVideoSource[] = [];
  private chunksValue: CatalogGeoVideoSource[] = [];
  private chunkIndexValue = 0;
  private particleSettings: LayerStyle["particles"] =
    resolveLayerStyle().particles;
  /** Style override of the current story view, over the layer's own. */
  private viewStyleValue: LayerStyleInput = {};
  private upcoming: Upcoming | null = null;
  /** Bumped on every layer or month switch; stale loads drop out. */
  private loadId = 0;
  private pendingRespawn = false;
  /** A follower's month load in flight. */
  private following = false;
  /** Playhead of the last drawn frame, for a follower's paused redraw. */
  private lastMs = Number.NaN;
  /**
   * The layer drives the clock: its months set the playhead, playback
   * advances through them. Other layers follow the playhead.
   */
  driving = true;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly clock: Clock,
    private readonly particles: SphereParticles,
    private readonly raster: SphereScalar,
    private readonly host: FieldLayerHost,
    grade: ColorGrade,
  ) {
    this.gradeValue = grade;
  }

  // ---- state -------------------------------------------------------------

  /** True once a layer was opened. */
  get opened(): boolean {
    return this.openedValue;
  }

  get layer(): ProjversorLayer {
    return this.layerValue;
  }

  /** Scalar entry id coloring the particles, or null. */
  get tintId(): string | null {
    return this.tintIdValue;
  }

  get palette(): string {
    return this.paletteId;
  }

  get grade(): ColorGrade {
    return this.gradeValue;
  }

  /** Style override of the current view. */
  get viewStyle(): LayerStyleInput {
    return this.viewStyleValue;
  }

  /** Playback speed multiplier of the open layer. */
  get speed(): number {
    return this.clock.speeds[this.layerValue.kind];
  }

  /** Month chunks of the open layer and the displayed one. */
  get chunks(): readonly CatalogGeoVideoSource[] {
    return this.chunksValue;
  }

  get chunkIndex(): number {
    return this.chunkIndexValue;
  }

  /** Frame times of the displayed month. */
  get times(): readonly number[] {
    return this.field?.times ?? [];
  }

  /** Bounds of the displayed field, once a month shows. */
  get bounds(): GeoVideoField["bounds"] | null {
    return this.field?.bounds ?? null;
  }

  // ---- layers ------------------------------------------------------------

  /**
   * Switch layer, opening the month that holds `at`, else the displayed
   * month when the archive has it, else the latest. The palette is the
   * view style's, else the layer's own; the tint defaults to the layer's.
   * The style applies once the layer shows. Resolves true when this layer
   * shows, false when a later switch superseded it.
   */
  async open(
    layerOrId: ProjversorLayer | string,
    options: {
      at?: number;
      tint?: string | null;
      /** Playback speed, applied with the layer when it is one of its kind. */
      speed?: number;
      /** Style override replacing the current one. */
      style?: LayerStyleInput;
    } = {},
  ): Promise<boolean> {
    const layer =
      typeof layerOrId === "string" ? findLayer(layerOrId) : layerOrId;
    if (!layer) {
      throw new Error(`Unknown layer: ${String(layerOrId)}`);
    }
    checkStyle(options.style, layer);
    const { at } = options;
    const tintId =
      layer.kind === "vector"
        ? options.tint === undefined
          ? (layer.tint ?? null)
          : options.tint
        : null;
    const id = ++this.loadId;
    this.dropUpcoming();
    this.setStatus(`Loading ${layer.label}…`);
    const stale = () => id !== this.loadId || this.destroyed;
    let chunks: CatalogGeoVideoSource[];
    let tintChunks: CatalogGeoVideoSource[];
    try {
      // An unreadable tint index leaves no tint chunks, not a failed layer.
      [chunks, tintChunks] = await Promise.all([
        loadChunks(layer.entryId),
        loadTintChunks(tintId),
      ]);
    } catch (error) {
      // A superseded load fails silently: another layer is on its way.
      if (stale()) {
        return false;
      }
      throw error;
    }
    if (stale()) {
      return false;
    }
    if (!chunks.length) {
      throw new Error(`${layer.label} has no archive months`);
    }
    const shown = this.chunksValue[this.chunkIndexValue]?.temporal?.start;
    const holding =
      at === undefined
        ? -1
        : chunks.findIndex((c) => sourceCoversTime(c, { time: at }));
    const same = chunks.findIndex((c) => c.temporal?.start === shown);
    const chunkIndex =
      holding >= 0 ? holding : same >= 0 ? same : chunks.length - 1;
    // The previous layer keeps its palette and settings until the new month
    // is decoded, then everything switches in the same frame.
    this.setStatus("Decoding…");
    let month: ProjversorMonth;
    try {
      month = await this.loadMonth(chunks[chunkIndex], at, tintChunks);
    } catch (error) {
      if (stale()) {
        return false;
      }
      throw error;
    }
    if (stale()) {
      destroyMonth(month);
      return false;
    }
    this.openedValue = true;
    this.layerValue = layer;
    this.tintIdValue = tintId;
    this.tintChunks = tintChunks;
    this.chunksValue = chunks;
    this.host.shown(layer);
    this.restyle(options.style);
    this.clock.setKindSpeed(layer.kind, options.speed);
    this.host.emit("layer", layer);
    this.applyPalette(this.stylePalette(layer));
    this.adopt(month, chunkIndex, at);
    this.pendingRespawn = true;
    return true;
  }

  /** Open month `index` of the open layer at its start. */
  openMonth(index: number): Promise<void> {
    const chunk = this.chunksValue[index];
    return chunk ? this.openChunk(chunk) : Promise.resolve();
  }

  /** Move the playhead, opening the month that holds `ms` when needed. */
  async seek(ms: number): Promise<void> {
    const times = this.times;
    if (times.length && ms >= times[0] && ms <= times[times.length - 1]) {
      this.scrub(ms);
      return;
    }
    const chunk = this.chunksValue.find((c) =>
      sourceCoversTime(c, { time: ms }),
    );
    if (chunk) {
      await this.openChunk(chunk, ++this.loadId, ms);
    }
  }

  /** Move the playhead within the displayed month. */
  scrub(ms: number): void {
    const field = this.field;
    if (!field || field.times.length < 2) {
      return;
    }
    const { times } = field;
    this.clock.ms = Math.min(Math.max(ms, times[0]), times[times.length - 1]);
    field.focus(this.clock.ms);
    this.tint?.focus(this.clock.ms);
    this.settle = this.settleFrames();
  }

  /**
   * A layer that does not drive the clock: open the month holding the
   * playhead once it leaves the displayed one. The displayed month shows its
   * edge frame meanwhile.
   */
  follow(): void {
    const ms = this.clock.ms;
    const times = this.times;
    if (
      this.driving ||
      !this.openedValue ||
      this.following ||
      (times.length && ms >= times[0] && ms <= times[times.length - 1])
    ) {
      return;
    }
    const chunk = this.chunksValue.find((c) =>
      sourceCoversTime(c, { time: ms }),
    );
    if (!chunk || chunk === this.chunksValue[this.chunkIndexValue]) {
      return;
    }
    this.following = true;
    this.openChunk(chunk, ++this.loadId, ms)
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        this.following = false;
      });
  }

  /** Open a month at `at`, or at its start. */
  private async openChunk(
    chunk: CatalogGeoVideoSource,
    id = ++this.loadId,
    at?: number,
  ): Promise<void> {
    this.dropUpcoming();
    this.setStatus("Decoding…");
    let month: ProjversorMonth;
    try {
      month = await this.loadMonth(chunk, at);
    } catch (error) {
      if (id !== this.loadId || this.destroyed) {
        return;
      }
      throw error;
    }
    if (id !== this.loadId || this.destroyed) {
      destroyMonth(month);
      return;
    }
    this.adopt(month, this.chunksValue.indexOf(chunk), at);
    this.pendingRespawn = true;
  }

  /**
   * Field of a month and, when a tint is chosen, the tint for the same
   * month. A missing or unreadable tint falls back to speed colors.
   */
  private async loadMonth(
    chunk: CatalogGeoVideoSource,
    at?: number,
    tintChunks = this.tintChunks,
  ): Promise<ProjversorMonth> {
    const tintChunk = pairChunk(chunk, tintChunks);
    const [field, tint] = await Promise.allSettled([
      this.loadField(chunk, at),
      tintChunk ? this.loadField(tintChunk, at) : null,
    ]);
    if (field.status === "rejected") {
      if (tint.status === "fulfilled") {
        tint.value?.destroy();
      }
      throw field.reason;
    }
    if (tint.status === "rejected") {
      console.error(tint.reason);
    }
    return {
      field: field.value,
      tint: tint.status === "fulfilled" ? tint.value : null,
    };
  }

  /** Manifest and first decoded frame (at `at`, else the start) of a month. */
  private async loadField(
    chunk: CatalogGeoVideoSource,
    at?: number,
  ): Promise<GeoVideoField> {
    const manifest = await loadGeoVideoManifest(chunk.manifestUrl);
    const field = new GeoVideoField(this.gl, manifest);
    try {
      await field.prime(at ?? field.times[0]);
    } catch (error) {
      field.destroy();
      throw error;
    }
    return field;
  }

  private adopt(month: ProjversorMonth, chunkIndex: number, at?: number): void {
    this.field?.destroy();
    this.tint?.destroy();
    const { field } = month;
    this.field = field;
    this.tint = month.tint;
    this.chunkIndexValue = chunkIndex;
    if (this.driving) {
      const { times } = field;
      this.clock.ms = Math.min(
        Math.max(at ?? times[0], times[0]),
        times[times.length - 1],
      );
    }
    // Also on automatic month changes: a month may gain or lose its tint.
    this.host.emit("month", month);
    this.setStatus("");
  }

  /**
   * Decode the next month in the background so playback runs through the
   * whole archive like a film, wrapping to the first month after the last.
   */
  private prefetchNext(): void {
    if (this.upcoming || this.chunksValue.length < 2) {
      return;
    }
    const id = this.loadId;
    const index = (this.chunkIndexValue + 1) % this.chunksValue.length;
    const upcoming: Upcoming = { index, month: null };
    this.upcoming = upcoming;
    this.loadMonth(this.chunksValue[index])
      .then((month) => {
        if (this.upcoming === upcoming && id === this.loadId) {
          upcoming.month = month;
        } else {
          destroyMonth(month);
        }
      })
      .catch((error: unknown) => {
        console.error(error);
        if (this.upcoming === upcoming) {
          // Skip the unreadable month on the next attempt.
          this.chunkIndexValue = index;
          this.upcoming = null;
        }
      });
  }

  private dropUpcoming(): void {
    if (this.upcoming?.month) {
      destroyMonth(this.upcoming.month);
    }
    this.upcoming = null;
  }

  private setStatus(text: string): void {
    this.host.emit("status", text);
  }

  // ---- styling -----------------------------------------------------------

  /**
   * Style the shown layer: engine defaults, then catalog, then layer, then
   * the view's override, which `viewStyle` replaces. The grade is the
   * style's: a picked grade lives in the override.
   */
  restyle(viewStyle?: LayerStyleInput): void {
    if (viewStyle !== undefined) {
      this.viewStyleValue = viewStyle;
    }
    const layer = this.layerValue;
    const entry = requireCatalogEntry(layer.entryId);
    const style = resolveEntryStyle(entry, layer.style, this.viewStyleValue);
    this.particleSettings = style.particles;
    this.rasterOpacity = style.raster.opacity;
    this.rasterVibrance = style.raster.vibrance;
    this.backdrop = backdropVec4(style.particles.backdrop);
    this.trailFade.setBase(fadeToOpacity(style.particles.fade));
    // Paused particles redraw their trails with the new style.
    this.settle = this.settleFrames();
    this.gradeValue = gradeToColorGrade(style.particles.grade);
  }

  /** The view style's palette when the layer offers it, else its own. */
  stylePalette(layer: ProjversorLayer): string {
    const id = this.viewStyleValue.palette;
    return id !== undefined && layerPalettes(layer).some((p) => p.id === id)
      ? id
      : layer.style.palette;
  }

  /** Set the view style's palette, shown when the layer offers it. */
  setPalette(id: string): void {
    this.restyle(mergeStyles(this.viewStyleValue, { palette: id }));
    this.applyPalette(this.stylePalette(this.layerValue));
  }

  /** Set the view style's particle grade. */
  setGrade(grade: ColorGrade): void {
    this.restyle(
      mergeStyles(this.viewStyleValue, {
        particles: { grade: colorGradeToGrade(grade) },
      }),
    );
  }

  /** Recolor the particles or the raster. */
  applyPalette(id: string): void {
    if (this.ramp) {
      this.gl.deleteTexture(this.ramp);
    }
    this.paletteId = id;
    this.ramp = createColorRampTexture(this.gl, id);
    this.settle = this.settleFrames();
    this.host.emit("palette", id);
  }

  /** Playback speed multiplier of the open layer's kind. */
  setSpeed(speed: number): void {
    this.clock.speeds[this.layerValue.kind] = speed;
  }

  // ---- frame -------------------------------------------------------------

  /** Trail length in frames, capped: how long a paused view keeps animating. */
  private settleFrames(): number {
    return Math.min(
      SETTLE_FRAMES_MAX,
      Math.round(fadeToFrames(this.particleSettings.fade)),
    );
  }

  /**
   * Draw the open field as particles or a raster into the bound GL canvas.
   * `moving`: the camera moved within the last moments.
   */
  draw(frame: ViewFrame, now: number, moving: boolean): void {
    const field = this.field;
    if (!field || !this.ramp) {
      return;
    }
    if (field.vector) {
      this.drawParticles(frame, field, this.ramp, now, moving);
    } else {
      this.raster.draw(frame, field, this.clock.ms, {
        ramp: this.ramp,
        domain: field.domain,
        opacity: this.rasterOpacity,
        vibrance: this.rasterVibrance,
      });
    }
  }

  /**
   * zartigl's particle pipeline: advect, fade the trails, draw the new
   * segments, composite. While paused, particles only animate for a while
   * after a change, to rebuild trails, then the image holds.
   */
  private drawParticles(
    frame: ViewFrame,
    field: GeoVideoField,
    ramp: WebGLTexture,
    now: number,
    moving: boolean,
  ): void {
    const gl = this.gl;
    const ms = this.clock.ms;
    if (moving || (!this.driving && ms !== this.lastMs)) {
      // A follower redraws its trails when another layer moved the playhead.
      this.settle = this.settleFrames();
    }
    this.lastMs = ms;
    this.trailFade.setMoving(moving, now);
    this.redistribute(frame);
    if (this.pendingRespawn) {
      // step() binds the field, which requests the frames at the playhead.
      this.pendingRespawn = false;
      this.particles.clear();
      this.particles.respawn();
      this.settle = this.settleFrames();
    }
    const style: ParticleStyle = {
      ramp,
      maxSpeed: field.maxSpeed,
      // Playback speed drives the particles as well as the video.
      speed: this.particleSettings.speed * particleSpeedFactor(this.speed),
      count: particleCount(
        this.particleSettings,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
      ),
      drop: Math.min(DROP_RATE + this.redistribution, REDISTRIB_MAX_DROP),
      dropBump: DROP_RATE_BUMP,
      tint: this.tint,
    };
    const advancing = this.clock.advancing;
    const animate = advancing || this.settle > 0;
    if (animate && this.particles.step(frame, field, ms, style)) {
      const fade = this.trailFade.value(now);
      this.particles.trace(frame, field, ms, style, fade);
      // Paused: count down only once the playhead frames are decoded, so a
      // scrub to uncached frames still rebuilds trails on the right field.
      const ready = field.ready(ms) && (this.tint?.ready(ms) ?? true);
      if (!advancing && ready) {
        this.settle--;
      }
    }
    if (this.backdrop[3] > 0) {
      this.raster.drawBackdrop(frame, field, ms, this.backdrop);
    }
    this.particles.present(this.gradeValue);
  }

  /** zartigl's drop-rate boost, from the per-frame zoom and center change. */
  private redistribute(frame: ViewFrame): void {
    const center: [number, number, number] = [
      frame.rotInv[0],
      frame.rotInv[1],
      frame.rotInv[2],
    ];
    if (this.lastScale > 0) {
      const [x, y, z] = this.lastCenter;
      const dot = x * center[0] + y * center[1] + z * center[2];
      const delta = Math.min(
        1,
        Math.abs(Math.log(frame.pxPerRadian / this.lastScale)) +
          Math.acos(Math.min(1, Math.max(-1, dot))) / visibleCap(frame),
      );
      this.redistribution = Math.max(
        this.redistribution * REDISTRIB_DECAY,
        delta,
      );
    }
    this.lastScale = frame.pxPerRadian;
    this.lastCenter = center;
  }

  /** Advance the playhead by `dt` seconds through the months. */
  advanceTime(dt: number): void {
    const times = this.field?.times;
    if (!times || times.length < 2 || !this.clock.advancing) {
      return;
    }
    const first = times[0];
    const lastTime = times[times.length - 1];
    const stepMs = (lastTime - first) / (times.length - 1);
    this.clock.ms += dt * STEPS_PER_SECOND * this.speed * stepMs;
    if ((this.clock.ms - first) / (lastTime - first) > PREFETCH_AT) {
      this.prefetchNext();
    }
    if (this.clock.ms > lastTime) {
      const upcoming = this.upcoming;
      if (this.chunksValue.length < 2) {
        this.clock.ms = first;
      } else if (upcoming?.month) {
        this.upcoming = null;
        this.adopt(upcoming.month, upcoming.index);
        this.advanceTime(0);
      } else {
        this.clock.ms = lastTime;
        this.setStatus("Buffering…");
      }
    }
  }

  /** Drop pending loads and free the months and the ramp. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    ++this.loadId;
    this.dropUpcoming();
    this.field?.destroy();
    this.tint?.destroy();
    this.field = null;
    this.tint = null;
    if (this.ramp) {
      this.gl.deleteTexture(this.ramp);
      this.ramp = null;
    }
  }
}
