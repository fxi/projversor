import { easeCubicInOut, geoPath, type GeoProjection } from "d3";
import {
  rotationBearing,
  screenNorth,
  withBearing,
  type ScreenProjection,
} from "./bearing";
import { PRESETS, findPreset, type Preset } from "./presets";
import { PROJECTIONS, cartesian, fitScale } from "./projections";
import {
  interpolateRotation,
  versor,
  versorDelta,
  versorMultiply,
  versorRotation,
} from "./versor";
import {
  NO_INSET,
  lerpInset,
  viewArea,
  viewFrame,
  type Inset,
  type View,
  type ViewFrame,
} from "./view";

export type Rotate = [number, number, number];

/** Projection morph duration. */
export const TRANSITION_MS = 2200;
/** Easing of compass, zoom and rotate controls. */
export const VIEW_MS = 450;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 200;
/** Bearings below this (degrees) open locked north up. */
const NORTH_EPSILON = 0.5;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** View target: a preset morphs, rotate and zoom alone ease. */
export interface ProjversorViewTarget {
  preset?: string;
  rotate?: Rotate;
  zoom?: number;
  /** Free zone the sphere is centered and fitted in; eases with the view. */
  inset?: Inset;
  durationMs?: number;
}

/** What the camera needs from its owner. */
export interface CameraHost {
  /** The d3 projection of a view frame, to invert pointers and trace. */
  project(frame: ViewFrame): GeoProjection;
  /** The preset changed. */
  preset(preset: Preset): void;
  /** North up was locked or freed. */
  north(locked: boolean): void;
  /** The fit scales changed without a change of the frame key. */
  refit(): void;
}

/**
 * The view of the sphere: blended projection, rotation, zoom and free zone,
 * their eased transitions, north locking and pointer interaction.
 */
export class Camera {
  readonly view: View;
  private presetValue: Preset = PRESETS[0];
  private north = true;
  private insetTransition: {
    start: number;
    duration: number;
    from: Inset;
    to: Inset;
  } | null = null;
  private transition: {
    start: number;
    duration: number;
    rotate: (t: number) => Rotate;
    zoom: [number, number];
  } | null = null;
  private drag: {
    v0: Rotate;
    q0: ReturnType<typeof versor>;
    r0: Rotate;
  } | null = null;

  constructor(
    private readonly host: CameraHost,
    initial: { preset?: string; rotate?: Rotate; zoom?: number } = {},
  ) {
    this.presetValue = findPreset(initial.preset) ?? PRESETS[0];
    const def = PROJECTIONS[this.presetValue.projection];
    this.view = {
      blend: { a: def, b: def, ka: 1, kb: 1, t: 0 },
      rotate: this.lockNorth(initial.rotate ?? this.presetValue.rotate),
      zoom: clampZoom(initial.zoom ?? this.presetValue.zoom),
      width: 1,
      height: 1,
    };
  }

  get preset(): Preset {
    return this.presetValue;
  }

  get rotate(): Rotate {
    return this.view.rotate;
  }

  get zoom(): number {
    return this.view.zoom;
  }

  get bearing(): number {
    return rotationBearing(this.view.rotate);
  }

  /** Drags keep north up (gamma 0), as d3-geo-zoom's northUp. */
  get northLocked(): boolean {
    return this.north;
  }

  set northLocked(locked: boolean) {
    if (this.north !== locked) {
      this.north = locked;
      this.host.north(locked);
    }
  }

  /**
   * Morph to a preset (with its own rotation and zoom unless given), or
   * ease rotation and zoom alone.
   */
  goTo(target: ProjversorViewTarget): void {
    const preset = findPreset(target.preset);
    if (target.inset) {
      this.setInset(
        target.inset,
        target.durationMs ?? (preset ? TRANSITION_MS : VIEW_MS),
      );
    }
    if (preset) {
      // Already there, at rest: a morph would only replay the same view.
      if (
        this.atRest(
          preset,
          target.rotate ?? preset.rotate,
          target.zoom ?? preset.zoom,
        )
      ) {
        return;
      }
      this.morph(
        preset,
        target.rotate ?? preset.rotate,
        target.zoom ?? preset.zoom,
        target.durationMs ?? TRANSITION_MS,
      );
      return;
    }
    const { rotate, zoom } = this.target();
    this.easeTo(
      target.rotate ?? rotate,
      clampZoom(target.zoom ?? zoom),
      target.durationMs,
    );
  }

  /** Show a preset, rotation and zoom at once. */
  jumpTo(target: ProjversorViewTarget): void {
    const preset = findPreset(target.preset) ?? this.presetValue;
    const def = PROJECTIONS[preset.projection];
    if (target.inset) {
      this.setInset(target.inset, 0);
    }
    const { width, height } = viewArea(this.view);
    const k = fitScale(def, width, height);
    this.transition = null;
    this.view.blend = { a: def, b: def, ka: k, kb: k, t: 0 };
    this.view.rotate = this.lockNorth(
      target.rotate ?? (target.preset ? preset.rotate : [...this.view.rotate]),
    );
    this.view.zoom = clampZoom(
      target.zoom ?? (target.preset ? preset.zoom : this.view.zoom),
    );
    this.setPreset(preset);
  }

  /** No transition running and the view equals this target. */
  private atRest(preset: Preset, rotate: Rotate, zoom: number): boolean {
    if (this.transition || preset.id !== this.presetValue.id) {
      return false;
    }
    const target = this.north ? withBearing(rotate, 0) : rotate;
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    return (
      this.view.rotate.every((v, i) => same(v, target[i])) &&
      same(this.view.zoom, clampZoom(zoom))
    );
  }

  private morph(
    preset: Preset,
    rotate: Rotate,
    zoom: number,
    duration: number,
  ): void {
    const { blend } = this.view;
    const from = blend.t < 0.5 ? blend.a : blend.b;
    const to = PROJECTIONS[preset.projection];
    const { width, height } = viewArea(this.view);
    this.view.blend = {
      a: from,
      b: to,
      ka: fitScale(from, width, height),
      kb: fitScale(to, width, height),
      t: 0,
    };
    this.transition = {
      start: performance.now(),
      duration,
      rotate: interpolateRotation(this.view.rotate, rotate),
      zoom: [this.view.zoom, clampZoom(zoom)],
    };
    this.setPreset(preset);
  }

  private setPreset(preset: Preset): void {
    this.presetValue = preset;
    this.host.preset(preset);
  }

  /**
   * Ease rotation and zoom from the current view; repeated calls chain from
   * the previous target. Waits out a projection morph.
   */
  easeTo(rotate: Rotate, zoom: number, duration = VIEW_MS): void {
    const { blend } = this.view;
    if (this.transition && blend.a !== blend.b) {
      return;
    }
    const from = this.view.rotate;
    this.transition = {
      start: performance.now(),
      duration,
      rotate: (t) => [
        from[0] + (rotate[0] - from[0]) * t,
        from[1] + (rotate[1] - from[1]) * t,
        from[2] + (rotate[2] - from[2]) * t,
      ],
      zoom: [this.view.zoom, zoom],
    };
  }

  zoomBy(factor: number): void {
    const { rotate, zoom } = this.target();
    this.easeTo(rotate, clampZoom(zoom * factor));
  }

  /** Spin the globe around its axis; positive moves the map content right. */
  rotateBy(deg: number): void {
    const { rotate, zoom } = this.target();
    this.easeTo([rotate[0] + deg, rotate[1], rotate[2]], zoom);
  }

  /** Rotate the map around the view center; frees the bearing. */
  setBearing(deg: number): void {
    if (this.transition) {
      return;
    }
    this.northLocked = false;
    this.view.rotate = withBearing(this.view.rotate, deg);
  }

  /** Free the bearing, or ease back to north up and lock it. */
  toggleNorth(): void {
    if (this.north) {
      this.northLocked = false;
      return;
    }
    this.northLocked = true;
    // A projection morph already ends north up.
    const { rotate, zoom } = this.target();
    this.easeTo([rotate[0], rotate[1], 0], zoom);
  }

  /** Where the running view easing ends, else the current view. */
  target(): { rotate: Rotate; zoom: number } {
    const transition = this.transition;
    return transition
      ? { rotate: transition.rotate(1), zoom: transition.zoom[1] }
      : { rotate: this.view.rotate, zoom: this.view.zoom };
  }

  /** Lock north up for a near-zero bearing, and snap it to zero. */
  private lockNorth(rotate: Rotate): Rotate {
    this.northLocked = Math.abs(rotationBearing(rotate)) < NORTH_EPSILON;
    return this.north ? withBearing(rotate, 0) : [...rotate];
  }

  /**
   * Ease the free zone to `inset` (at once for a zero duration); the sphere
   * slides and refits with it.
   */
  setInset(inset: Inset, durationMs = VIEW_MS): void {
    const from = this.view.inset ?? NO_INSET;
    const current = this.insetTransition?.to ?? from;
    if (
      (["top", "right", "bottom", "left"] as const).every(
        (side) => current[side] === inset[side],
      )
    ) {
      return;
    }
    if (durationMs <= 0) {
      this.insetTransition = null;
      this.view.inset = { ...inset };
      this.refit();
      return;
    }
    this.insetTransition = {
      start: performance.now(),
      duration: durationMs,
      from: { ...from },
      to: { ...inset },
    };
  }

  /** Free zone, css px. */
  get inset(): Inset {
    return this.insetTransition?.to ?? this.view.inset ?? NO_INSET;
  }

  /**
   * Screen direction of north at the center of the free zone, degrees
   * clockwise from up; null near a pole, where it has none.
   */
  northAngle(): number | null {
    const frame = viewFrame(this.view);
    const projection = this.host.project(frame);
    const { cx, cy } = viewArea(frame);
    return screenNorth(projection as ScreenProjection, [cx, cy]);
  }

  /**
   * Outline of the projected sphere, css px: the globe limb, or the edge of
   * a world map. The largest ring when the projection splits it.
   */
  outline(): [number, number][] {
    const projection = this.host.project(viewFrame(this.view));
    const rings: [number, number][][] = [];
    let ring: [number, number][] = [];
    geoPath(projection, {
      moveTo: (x: number, y: number) => {
        ring = [[x, y]];
        rings.push(ring);
      },
      lineTo: (x: number, y: number) => ring.push([x, y]),
      closePath: () => undefined,
      arc: () => undefined,
    } as unknown as CanvasRenderingContext2D)({ type: "Sphere" });
    return rings.reduce<[number, number][]>(
      (best, r) => (r.length > best.length ? r : best),
      [],
    );
  }

  /** The stage resized, css px. */
  resize(width: number, height: number): void {
    this.view.width = width;
    this.view.height = height;
    this.refit();
  }

  /** Fit scales of both blended projections to the free zone. */
  private refit(): void {
    const { blend } = this.view;
    const { width, height } = viewArea(this.view);
    blend.ka = fitScale(blend.a, width, height);
    blend.kb = fitScale(blend.b, width, height);
    this.host.refit();
  }

  private animateInset(now: number): void {
    const step = this.insetTransition;
    if (!step) {
      return;
    }
    const raw = Math.min(1, (now - step.start) / step.duration);
    this.view.inset = lerpInset(step.from, step.to, easeCubicInOut(raw));
    this.refit();
    if (raw >= 1) {
      this.insetTransition = null;
    }
  }

  /** Advance the running transitions to `now`. */
  animate(now: number): void {
    this.animateInset(now);
    const transition = this.transition;
    if (!transition) {
      return;
    }
    const raw = Math.min(1, (now - transition.start) / transition.duration);
    const e = easeCubicInOut(raw);
    this.view.blend.t = e;
    this.view.rotate = transition.rotate(e);
    this.view.zoom =
      transition.zoom[0] + (transition.zoom[1] - transition.zoom[0]) * e;
    if (raw >= 1) {
      const { b, kb } = this.view.blend;
      this.view.blend = { a: b, b, ka: kb, kb, t: 0 };
      this.transition = null;
    }
  }

  /**
   * Versor drag, pinch and wheel zoom on `target`; `stage` gets the
   * `dragging` class during a drag. Returns the detach function.
   */
  attachInteraction(stage: HTMLElement, target: HTMLElement): () => void {
    const controller = new AbortController();
    const { signal } = controller;
    // Active pointers in client px; two of them pinch-zoom.
    const pointers = new Map<number, [number, number]>();
    let pinch: { spread: number; zoom: number } | null = null;
    const spread = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    target.addEventListener(
      "pointerdown",
      (event) => {
        if (this.transition) {
          return;
        }
        target.setPointerCapture(event.pointerId);
        pointers.set(event.pointerId, [event.clientX, event.clientY]);
        if (pointers.size > 1) {
          this.drag = null;
          pinch = { spread: Math.max(1, spread()), zoom: this.view.zoom };
          return;
        }
        const at = this.invert(event, this.view.rotate);
        if (!at) {
          return;
        }
        stage.classList.add("dragging");
        this.drag = {
          v0: cartesian(...at),
          q0: versor(this.view.rotate),
          r0: [...this.view.rotate],
        };
      },
      { signal },
    );
    target.addEventListener(
      "pointermove",
      (event) => {
        if (pointers.has(event.pointerId)) {
          pointers.set(event.pointerId, [event.clientX, event.clientY]);
        }
        if (pinch) {
          if (pointers.size > 1) {
            this.view.zoom = clampZoom((pinch.zoom * spread()) / pinch.spread);
          }
          return;
        }
        const drag = this.drag;
        if (!drag) {
          return;
        }
        const at = this.invert(event, drag.r0);
        if (!at) {
          return;
        }
        const q1 = versorMultiply(
          drag.q0,
          versorDelta(drag.v0, cartesian(...at)),
        );
        const rotate = versorRotation(q1);
        this.view.rotate = this.north ? withBearing(rotate, 0) : rotate;
      },
      { signal },
    );
    const end = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) {
        pinch = null;
      }
      this.drag = null;
      stage.classList.remove("dragging");
    };
    target.addEventListener("pointerup", end, { signal });
    target.addEventListener("pointercancel", end, { signal });
    target.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        if (this.transition) {
          return;
        }
        const zoom = this.view.zoom * Math.exp(-event.deltaY * 0.0015);
        this.view.zoom = clampZoom(zoom);
      },
      { passive: false, signal },
    );
    return () => {
      controller.abort();
      this.drag = null;
      stage.classList.remove("dragging");
    };
  }

  private invert(event: PointerEvent, rotate: Rotate): [number, number] | null {
    const projection = this.host.project(viewFrame({ ...this.view, rotate }));
    const at = projection.invert?.([event.offsetX, event.offsetY]);
    return at && Number.isFinite(at[0]) && Number.isFinite(at[1])
      ? [at[0], at[1]]
      : null;
  }
}
