import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
import { Camera, type Rotate } from "./Camera";
import { Clock } from "./Clock";
import type { Emitter } from "./emitter";
import type { GeoJSONLayer } from "./geojson";
import { Overlay } from "./Overlay";
import type { Preset } from "./presets";
import { SphereParticles } from "./SphereParticles";
import { SphereScalar } from "./SphereScalar";
import { viewFrame, type ViewFrame } from "./view";

/** The camera counts as moving until its view rests this long. */
const MOVE_SETTLE_MS = 100;

/** The stage and its three stacked canvases: land below, GL, lines above. */
export interface ProjversorCanvases {
  stage: HTMLElement;
  back: HTMLCanvasElement;
  gl: HTMLCanvasElement;
  front: HTMLCanvasElement;
}

/** Events of the stage and their payloads. */
export interface StageEvents {
  playing: boolean;
  preset: Preset;
  north: boolean;
  /** After each drawn frame. */
  frame: undefined;
}

/** Initial view and play state. */
export interface StageInitial {
  preset?: string;
  rotate?: Rotate;
  zoom?: number;
  playing?: boolean;
}

/** What the frame loop runs for the layers, in order. */
export interface StageHooks {
  /** Advance the playhead by `dt` seconds. */
  advance(dt: number): void;
  /** Draw into the cleared GL canvas; `moving`: the view just moved. */
  draw(frame: ViewFrame, now: number, moving: boolean): void;
}

const landFeature = (topology: unknown) => {
  const t = topology as Topology<{ land: GeometryCollection }>;
  return feature(t, t.objects.land);
};

/**
 * What every projversor shares: the GL context and its particle and raster
 * renderers, the 2D overlay (land, graticule), the camera, the clock, the
 * resize observer and the frame loop. Layers draw through {@link StageHooks}.
 */
export class Stage {
  readonly gl: WebGL2RenderingContext;
  readonly particles: SphereParticles;
  readonly raster: SphereScalar;
  readonly overlay: Overlay;
  readonly camera: Camera;
  readonly clock: Clock;
  /** Settles once the detailed coastlines are in use (or failed to load). */
  readonly landDetail: Promise<void>;
  private readonly resizer: ResizeObserver;
  private hooks: StageHooks | null = null;
  private frameId = 0;
  private destroyed = false;
  private dpr = 1;
  private overlayKey = "";
  private lastMove = 0;
  private detailed = false;
  private last = 0;

  constructor(
    readonly canvases: ProjversorCanvases,
    private readonly events: Pick<Emitter<StageEvents>, "emit">,
    initial: StageInitial = {},
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
    this.landDetail = import("world-atlas/land-50m.json")
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
        preset: (preset) => this.events.emit("preset", preset),
        north: (locked) => this.events.emit("north", locked),
        refit: () => {
          this.overlayKey = "";
        },
      },
      initial,
    );
    this.clock = new Clock(initial.playing ?? true, (playing) =>
      this.events.emit("playing", playing),
    );
    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(canvases.stage);
    this.resize();
  }

  /** Start the frame loop with the layers' hooks. */
  start(hooks: StageHooks): void {
    this.hooks = hooks;
    this.frameId = requestAnimationFrame((now) => this.tick(now));
  }

  /** Show a GeoJSON layer above everything, or remove it (null). */
  setGeoJSON(id: string, layer: GeoJSONLayer | null): void {
    if (layer) {
      this.overlay.geojson.set(id, layer);
    } else {
      this.overlay.geojson.delete(id);
    }
    this.overlayKey = "";
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

  private tick(now: number): void {
    if (this.destroyed || !this.hooks) {
      return;
    }
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.camera.animate(now);
    this.hooks.advance(dt);
    const frame = viewFrame(this.camera.view);
    this.drawOverlay(frame, now);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.hooks.draw(frame, now, now - this.lastMove < MOVE_SETTLE_MS);
    this.events.emit("frame", undefined);
    this.frameId = requestAnimationFrame((t) => this.tick(t));
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

  /** Stop the frame loop and free the GL renderers. Layers go first. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    cancelAnimationFrame(this.frameId);
    this.resizer.disconnect();
    this.particles.destroy();
    this.raster.destroy();
  }
}
