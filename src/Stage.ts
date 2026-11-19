import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import land110 from "world-atlas/land-110m.json";
import { Camera, type Rotate } from "./Camera";
import { Clock } from "./Clock";
import type { Emitter } from "./emitter";
import type { GeoJSONLayer } from "./geojson";
import { Overlay, type OverlayColors, type OverlayPanel } from "./Overlay";
import type { Preset } from "./presets";
import { SphereParticles } from "./SphereParticles";
import { SphereScalar } from "./SphereScalar";
import type { Rect } from "./compare";
import { viewFrame, type View, type ViewFrame } from "./view";

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
  /** Colors over the css custom properties of the canvas. */
  colors?: Partial<OverlayColors>;
}

/** A panel of a comparison, as the stage draws it. */
export interface StagePanel {
  index: number;
  frame: ViewFrame;
  /** Css px the panel draws into. */
  clip: Rect;
  alpha: number;
}

/** What the frame loop runs for the layers, in order. */
export interface StageHooks {
  /** Advance the playhead by `dt` seconds. */
  advance(dt: number): void;
  /**
   * Panels of a comparison over the camera's view, or null for the plain
   * view; called once per frame, after the camera moved.
   */
  panels?(view: View, now: number): StagePanel[] | null;
  /**
   * Draw into the cleared GL canvas; `moving`: the view just moved;
   * `panels`: the comparison's, when one shows.
   */
  draw(
    frame: ViewFrame,
    now: number,
    moving: boolean,
    panels: StagePanel[] | null,
  ): void;
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
  /** Waiting for the next frame as one image: see {@link capture}. */
  private captures: Array<{
    /** Wait for a frame with the camera at rest. */
    settled: boolean;
    resolve: (canvas: HTMLCanvasElement) => void;
    reject: (error: Error) => void;
  }> = [];

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
    // No frame comes while the context is lost: settle the captures now.
    canvases.gl.addEventListener("webglcontextlost", () =>
      this.rejectCaptures(new Error("projversor: WebGL context lost")),
    );
    this.particles = new SphereParticles(gl);
    this.raster = new SphereScalar(gl);
    this.overlay = new Overlay(
      canvases.back,
      canvases.front,
      { land: landFeature(land110) },
      initial.colors,
    );
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

  /** Override overlay colors and redraw on the next frame. */
  setColors(colors: Partial<OverlayColors>): void {
    this.overlay.setColors(colors);
    this.overlayKey = "";
  }

  /** Change coastline visibility and invalidate the cached overlay. */
  setCoastlines(visible: boolean): void {
    this.overlay.coastlines = visible;
    this.overlayKey = "";
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
    const panels = this.hooks.panels?.(this.camera.view, now) ?? null;
    this.drawOverlay(panels ?? [{ frame, clip: null, alpha: 1 }], now);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.hooks.draw(frame, now, now - this.lastMove < MOVE_SETTLE_MS, panels);
    if (this.captures.length) {
      // Same task as the draw: the GL buffer still holds this frame, so no
      // preserveDrawingBuffer (and its cost on every frame) is needed. A
      // failed capture rejects; the loop goes on.
      this.settleCaptures();
    }
    this.scissor(null);
    this.events.emit("frame", undefined);
    this.frameId = requestAnimationFrame((t) => this.tick(t));
  }

  /**
   * Limit GL drawing to `clip` (css px, origin top left), or lift the limit.
   * Scissoring holds across the viewport resets of the renderers.
   */
  scissor(clip: Rect | null): void {
    const gl = this.gl;
    if (!clip) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const sx = gl.drawingBufferWidth / Math.max(1, this.camera.view.width);
    const sy = gl.drawingBufferHeight / Math.max(1, this.camera.view.height);
    const x = Math.round(clip.x * sx);
    const y = Math.round((this.camera.view.height - clip.y - clip.height) * sy);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      x,
      y,
      Math.max(0, Math.round((clip.x + clip.width) * sx) - x),
      Math.max(0, Math.round((this.camera.view.height - clip.y) * sy) - y),
    );
  }

  /** Coastlines and graticule: coarse while the view moves, then detailed. */
  private drawOverlay(panels: readonly OverlayPanel[], now: number): void {
    const key = JSON.stringify(
      panels.map(({ frame, clip, alpha }) => [
        frame.rotate,
        frame.zoom,
        frame.blend.t,
        frame.blend.a.id,
        frame.blend.b.id,
        frame.width,
        frame.height,
        frame.inset,
        clip,
        alpha,
      ]),
    );
    if (key !== this.overlayKey) {
      this.overlayKey = key;
      this.lastMove = now;
      this.detailed = false;
      this.overlay.draw(panels, this.dpr, false);
    } else if (!this.detailed && now - this.lastMove > 180) {
      this.detailed = true;
      this.overlay.draw(panels, this.dpr, true);
    }
  }

  /**
   * The next frame as one image, at the canvases' resolution: the stage's
   * background, then the back overlay, the GL layers and the front overlay,
   * stacked as on screen. Rejects when no frame can come: a lost GL
   * context, an empty stage, or none drawn within `timeoutMs` (a hidden
   * page draws none).
   */
  capture(
    options: { settled?: boolean; timeoutMs?: number } = {},
  ): Promise<HTMLCanvasElement> {
    const { settled = false, timeoutMs = 10_000 } = options;
    const unusable = this.unusable();
    if (unusable) {
      return Promise.reject(unusable);
    }
    return new Promise((resolve, reject) => {
      const entry = {
        settled,
        resolve: (image: HTMLCanvasElement) => {
          clearTimeout(timer);
          resolve(image);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(() => {
        this.captures = this.captures.filter((other) => other !== entry);
        reject(new Error("projversor: no frame drawn"));
      }, timeoutMs);
      this.captures.push(entry);
    });
  }

  /** Why no frame can be captured now, if none can. */
  private unusable(): Error | undefined {
    if (this.destroyed) {
      return new Error("projversor: destroyed");
    }
    if (this.gl.isContextLost()) {
      return new Error("projversor: WebGL context lost");
    }
    if (!this.canvases.gl.width || !this.canvases.gl.height) {
      return new Error("projversor: the stage has no size");
    }
    return undefined;
  }

  private rejectCaptures(error: Error): void {
    for (const { reject } of this.captures.splice(0)) {
      reject(error);
    }
  }

  /**
   * Answer the pending captures with the frame just drawn; those waiting
   * for a camera at rest keep waiting while it moves.
   */
  private settleCaptures(): void {
    const unusable = this.unusable();
    if (unusable) {
      this.rejectCaptures(unusable);
      return;
    }
    const atRest = this.camera.settled;
    const ready = this.captures.filter((entry) => atRest || !entry.settled);
    if (!ready.length) {
      return;
    }
    this.captures = this.captures.filter((entry) => !ready.includes(entry));
    try {
      const image = this.compose();
      ready.forEach(({ resolve }) => resolve(image));
    } catch (error) {
      const reason = error instanceof Error ? error : new Error(String(error));
      ready.forEach(({ reject }) => reject(reason));
    }
  }

  private compose(): HTMLCanvasElement {
    const { stage, back, gl, front } = this.canvases;
    const image = document.createElement("canvas");
    image.width = gl.width;
    image.height = gl.height;
    const context = image.getContext("2d");
    if (!context) {
      throw new Error("projversor: no 2D canvas for the snapshot");
    }
    const background = backgroundOf(stage);
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, image.width, image.height);
    }
    for (const canvas of [back, gl, front]) {
      context.drawImage(canvas, 0, 0, image.width, image.height);
    }
    return image;
  }

  /** Stop the frame loop and free the GL renderers. Layers go first. */
  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.rejectCaptures(new Error("projversor: destroyed"));
    cancelAnimationFrame(this.frameId);
    this.resizer.disconnect();
    this.particles.destroy();
    this.raster.destroy();
  }
}

/**
 * The color painted behind the canvases: the first opaque background up
 * from `element`, as the page shows it. Undefined if none is set.
 */
function backgroundOf(element: Element): string | undefined {
  for (let node: Element | null = element; node; node = node.parentElement) {
    const color = getComputedStyle(node).backgroundColor;
    if (color && color !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(color)) {
      return color;
    }
  }
  return undefined;
}
