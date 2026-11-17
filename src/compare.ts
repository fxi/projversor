import { easeCubicInOut } from "d3";
import type { Rotate } from "./Camera";
import { findPreset } from "./presets";
import { PROJECTIONS, fitScale, type ProjectionDef } from "./projections";
import { viewArea, type Inset, type View } from "./view";

/** One side of a comparison: the playhead shifted by whole years. */
export interface ComparePanel {
  /** Years added to the playhead, keeping month and day: -11 shows 2015 for 2026. */
  yearOffset: number;
  /** Shown in the panel's corner, e.g. the year. */
  label?: string;
}

/**
 * The same layers side by side at other years, in one view:
 *
 * - `swipe`: two panels on the view, split by a draggable divider;
 * - `grid`: `cols` × `rows` cells, the projection morphing to `preset`.
 *
 * `progress` runs from the plain view (0) to the comparison (1): the
 * divider slides in, or the focus panel shrinks into its cell while the
 * others grow into theirs. Scalar and image layers are compared; particles
 * are hidden while a comparison shows.
 */
export interface CompareConfig {
  layout: "swipe" | "grid";
  panels: ComparePanel[];
  /** 0 (plain view) to 1 (comparison). Default 1. */
  progress?: number;
  /** Swipe: divider position across the free zone, 0–1. Default 0.5. */
  divider?: number;
  /** Swipe: "x" splits left and right, "y" top and bottom. Default "x". */
  axis?: "x" | "y";
  /** Grid columns and rows. Default: as square as the panels allow. */
  cols?: number;
  rows?: number;
  /** Grid gap between cells, css px. Default 2. */
  gap?: number;
  /** Grid: the panel the plain view becomes. Default: the one at offset 0, else the first. */
  focus?: number;
  /** Grid: projection preset of the cells. Default: the current projection. */
  preset?: string;
  /** Grid: rotation and zoom of the cells. Default: the current view's. */
  rotate?: Rotate;
  zoom?: number;
}

/** A css px rectangle, origin top left. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where and how a panel draws: its view, its clip and its fade. */
export interface PanelView {
  index: number;
  /** View of the panel, its free zone being the panel's rect. */
  view: View;
  /** Css px the panel draws into. */
  clip: Rect;
  /** 0–1. */
  alpha: number;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const COMPARE_KEYS = new Set([
  "layout",
  "panels",
  "progress",
  "divider",
  "axis",
  "cols",
  "rows",
  "gap",
  "focus",
  "preset",
  "rotate",
  "zoom",
]);

/** Validate a comparison from untyped input; throws with `path`. */
export function parseCompare(value: unknown, path: string): CompareConfig {
  invariant(
    typeof value === "object" && value !== null && !Array.isArray(value),
    `${path} must be an object`,
  );
  const config = value as Record<string, unknown>;
  for (const key of Object.keys(config)) {
    invariant(COMPARE_KEYS.has(key), `${path}.${key} is not a compare key`);
  }
  invariant(
    config.layout === "swipe" || config.layout === "grid",
    `${path}.layout must be "swipe" or "grid"`,
  );
  const panels = config.panels;
  invariant(
    Array.isArray(panels) && panels.length >= 2,
    `${path}.panels must hold at least two panels`,
  );
  if (config.layout === "swipe") {
    invariant(panels.length === 2, `${path}.panels: a swipe has two panels`);
  }
  panels.forEach((panel: unknown, i) => {
    const p = `${path}.panels.${i}`;
    invariant(
      typeof panel === "object" && panel !== null,
      `${p} must be an object`,
    );
    const { yearOffset, label, ...rest } = panel as Record<string, unknown>;
    invariant(
      Number.isInteger(yearOffset),
      `${p}.yearOffset must be a whole number of years`,
    );
    invariant(
      label === undefined || typeof label === "string",
      `${p}.label must be a string`,
    );
    invariant(
      !Object.keys(rest).length,
      `${p}.${Object.keys(rest)[0]} is not a panel key`,
    );
  });
  for (const key of ["progress", "divider"] as const) {
    invariant(
      config[key] === undefined ||
        (isFiniteNumber(config[key]) && config[key] >= 0 && config[key] <= 1),
      `${path}.${key} must be within 0–1`,
    );
  }
  invariant(
    config.axis === undefined || config.axis === "x" || config.axis === "y",
    `${path}.axis must be "x" or "y"`,
  );
  for (const key of ["cols", "rows"] as const) {
    invariant(
      config[key] === undefined ||
        (Number.isInteger(config[key]) && (config[key] as number) >= 1),
      `${path}.${key} must be a positive whole number`,
    );
  }
  const { cols, rows } = gridShape(panels.length, config);
  invariant(
    cols * rows >= panels.length,
    `${path}: ${cols} × ${rows} cells hold fewer than ${panels.length} panels`,
  );
  invariant(
    config.gap === undefined || (isFiniteNumber(config.gap) && config.gap >= 0),
    `${path}.gap must be a non-negative number`,
  );
  invariant(
    config.focus === undefined ||
      (Number.isInteger(config.focus) &&
        (config.focus as number) >= 0 &&
        (config.focus as number) < panels.length),
    `${path}.focus must be a panel index`,
  );
  invariant(
    config.preset === undefined || findPreset(String(config.preset)),
    `${path}.preset is unknown`,
  );
  invariant(
    config.rotate === undefined ||
      (Array.isArray(config.rotate) &&
        config.rotate.length === 3 &&
        config.rotate.every(isFiniteNumber)),
    `${path}.rotate must be three numbers`,
  );
  invariant(
    config.zoom === undefined ||
      (isFiniteNumber(config.zoom) && config.zoom > 0),
    `${path}.zoom must be positive`,
  );
  return config as unknown as CompareConfig;
}

/** `ms` moved by whole years, keeping the UTC month, day and time. */
export function shiftYears(ms: number, years: number): number {
  if (!years) {
    return ms;
  }
  const date = new Date(ms);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.getTime();
}

/** Grid columns and rows: as given, else as square as `count` allows. */
export function gridShape(
  count: number,
  config: Pick<CompareConfig, "cols" | "rows">,
): { cols: number; rows: number } {
  const cols = config.cols ?? Math.ceil(Math.sqrt(count));
  const rows = config.rows ?? Math.ceil(count / cols);
  return { cols, rows };
}

/** The focus panel: as given, else the one at offset 0, else the first. */
export function focusPanel(config: CompareConfig): number {
  if (config.focus !== undefined) {
    return config.focus;
  }
  const current = config.panels.findIndex((p) => p.yearOffset === 0);
  return current >= 0 ? current : 0;
}

/** Cells of a grid over `area`, row by row. */
export function gridRects(
  area: Rect,
  cols: number,
  rows: number,
  gap: number,
): Rect[] {
  const width = Math.max(1, (area.width - gap * (cols - 1)) / cols);
  const height = Math.max(1, (area.height - gap * (rows - 1)) / rows);
  const rects: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push({
        x: area.x + c * (width + gap),
        y: area.y + r * (height + gap),
        width,
        height,
      });
    }
  }
  return rects;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRect(a: Rect, b: Rect, t: number): Rect {
  return {
    x: lerp(a.x, b.x, t),
    y: lerp(a.y, b.y, t),
    width: lerp(a.width, b.width, t),
    height: lerp(a.height, b.height, t),
  };
}

/** `rect` scaled by `t` around its center. */
function grow(rect: Rect, t: number): Rect {
  const width = rect.width * t;
  const height = rect.height * t;
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  };
}

/** Rotations eased the short way round each angle. */
function lerpRotate(a: Rotate, b: Rotate, t: number): Rotate {
  return a.map((from, i) => {
    let delta = ((((b[i] - from) % 360) + 540) % 360) - 180;
    if (Math.abs(delta) === 180) {
      delta = b[i] - from;
    }
    return from + delta * t;
  }) as Rotate;
}

/** The inset that makes `rect` the free zone of a `width` × `height` view. */
function insetOf(rect: Rect, width: number, height: number): Inset {
  return {
    top: rect.y,
    left: rect.x,
    right: width - rect.x - rect.width,
    bottom: height - rect.y - rect.height,
  };
}

/** The projection a view mostly shows. */
function shownProjection(view: View): ProjectionDef {
  return view.blend.t < 0.5 ? view.blend.a : view.blend.b;
}

/** The free zone of a view as a rect. */
export function areaRect(view: View): Rect {
  const { cx, cy, width, height } = viewArea(view);
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * The panels of a comparison over `view` at `progress` (eased here): their
 * views, clips and fades. The view is the camera's, so a dragged camera
 * turns every panel.
 */
export function comparePanels(
  view: View,
  config: CompareConfig,
  progress: number,
): PanelView[] {
  const p = easeCubicInOut(Math.min(1, Math.max(0, progress)));
  const area = areaRect(view);
  const { width, height } = view;
  if (config.layout === "swipe") {
    const divider = lerp(1, config.divider ?? 0.5, p);
    const full: Rect = { x: 0, y: 0, width, height };
    let first: Rect;
    let second: Rect;
    if ((config.axis ?? "x") === "x") {
      const split = area.x + divider * area.width;
      first = { ...full, width: split };
      second = { ...full, x: split, width: width - split };
    } else {
      const split = area.y + divider * area.height;
      first = { ...full, height: split };
      second = { ...full, y: split, height: height - split };
    }
    return [first, second].map((clip, index) => ({
      index,
      view,
      clip,
      alpha: 1,
    }));
  }
  const { cols, rows } = gridShape(config.panels.length, config);
  const cells = gridRects(area, cols, rows, config.gap ?? 2);
  const focus = focusPanel(config);
  const from = shownProjection(view);
  const preset = findPreset(config.preset);
  const to = preset ? PROJECTIONS[preset.projection] : from;
  const rotate = lerpRotate(view.rotate, config.rotate ?? view.rotate, p);
  const zoom = lerp(view.zoom, config.zoom ?? view.zoom, p);
  return config.panels.map((_, index) => {
    const rect =
      index === focus ? lerpRect(area, cells[index], p) : grow(cells[index], p);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    return {
      index,
      view: {
        blend: {
          a: from,
          b: to,
          ka: fitScale(from, w, h),
          kb: fitScale(to, w, h),
          t: from === to ? 0 : p,
        },
        rotate,
        zoom,
        width,
        height,
        inset: insetOf(rect, width, height),
      },
      clip: rect,
      alpha: index === focus ? 1 : p,
    };
  });
}
