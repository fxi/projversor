import { TRANSITION_MS } from "./Camera";
import {
  areaRect,
  comparePanels,
  focusPanel,
  shiftYears,
  type CompareConfig,
  type Rect,
} from "./compare";
import type { FieldLayer } from "./FieldLayer";
import type { StagePanel } from "./Stage";
import { viewFrame, type View } from "./view";

/** A layer shown in a panel at another year than the playhead. */
interface Shadow {
  field: FieldLayer;
  layerId: string;
  revision: number;
  yearOffset: number;
}

/** The labels and the swipe divider over the view. */
interface CompareDom {
  layer: HTMLDivElement;
  labels: HTMLSpanElement[];
  line: HTMLDivElement;
  handle: HTMLButtonElement;
  detach: () => void;
}

/** Grid progress from which the labels fade in. */
const LABELS_FROM = 0.7;

/** Divider steps of the arrow keys. */
const KEY_STEP = 0.02;

/** Divider handle: a disc with two chevrons, colors from css properties. */
const HANDLE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * A comparison on the stage: its config and eased progress, the layers each
 * panel shows at its year, and the labels and swipe divider over the view,
 * created with the first comparison shown.
 */
export class Comparison {
  private configValue: CompareConfig | null = null;
  /** What follows once the current comparison folded back. */
  private next: { config: CompareConfig | null; durationMs: number } | null =
    null;
  private progressValue = 0;
  private animation: {
    from: number;
    to: number;
    start: number;
    duration: number;
  } | null = null;
  private readonly shadows = new Map<FieldLayer, Map<number, Shadow>>();
  private dom: CompareDom | null = null;
  private domKey = "";
  private area: Rect = { x: 0, y: 0, width: 1, height: 1 };

  constructor(
    private readonly root: HTMLElement,
    /** The element the labels and divider are placed after. */
    private readonly after: HTMLElement,
    /** A follower field layer for a shadow. */
    private readonly createField: () => FieldLayer,
    /** The divider was dragged or keyed. */
    private readonly onDivider: (divider: number) => void,
    private readonly ariaLabel = "Compare",
  ) {}

  get config(): CompareConfig | null {
    return this.configValue;
  }

  /** 0 (plain view) to 1 (comparison), as shown. */
  get progress(): number {
    return this.progressValue;
  }

  /**
   * Show a comparison, or fold it back (null), easing the progress over
   * `durationMs`. A new layout first folds the current one back.
   */
  set(config: CompareConfig | null, durationMs = TRANSITION_MS): void {
    const current = this.configValue;
    if (current && config && current.layout !== config.layout) {
      if (durationMs > 0 && this.progressValue > 0) {
        this.next = { config, durationMs: durationMs / 2 };
        this.ease(0, durationMs / 2);
        return;
      }
      this.progressValue = 0;
    }
    this.next = null;
    if (!config) {
      if (current && durationMs > 0 && this.progressValue > 0) {
        this.next = { config: null, durationMs: 0 };
        this.ease(0, durationMs);
      } else if (current) {
        this.clear();
      }
      return;
    }
    if (!current) {
      this.progressValue = 0;
    }
    this.configValue = config;
    const target = config.progress ?? 1;
    if (durationMs > 0) {
      this.ease(target, durationMs);
    } else {
      this.animation = null;
      this.progressValue = target;
    }
  }

  /** Show the comparison at `progress` at once, e.g. from a scroll position. */
  setProgress(progress: number): void {
    if (this.next?.config === null) {
      // Folding back: the comparison goes, whatever the scroll says.
      return;
    }
    if (this.next?.config) {
      this.configValue = this.next.config;
    }
    this.animation = null;
    this.next = null;
    this.progressValue = Math.min(1, Math.max(0, progress));
  }

  /** Move the swipe divider, 0–1 across the free zone. */
  setDivider(divider: number): void {
    if (this.configValue) {
      this.configValue = {
        ...this.configValue,
        divider: Math.min(1, Math.max(0, divider)),
      };
    }
  }

  private ease(to: number, duration: number): void {
    this.animation = {
      from: this.progressValue,
      to,
      start: performance.now(),
      duration,
    };
  }

  /** Years a panel is shifted by. */
  yearOffset(index: number): number {
    return this.configValue?.panels[index]?.yearOffset ?? 0;
  }

  /**
   * The panels over the camera's view at `now`, advancing the progress, or
   * null without a comparison (or folded back). Also places the labels.
   */
  panels(view: View, now: number): StagePanel[] | null {
    this.step(now);
    const config = this.configValue;
    if (!config || this.progressValue <= 0) {
      this.syncDom(null, view);
      return null;
    }
    // The focus panel first: the others grow in over it as it shrinks.
    const focus = config.layout === "grid" ? focusPanel(config) : -1;
    const panels = comparePanels(view, config, this.progressValue)
      .map((panel) => ({ ...panel, frame: viewFrame(panel.view) }))
      .sort((a, b) => Number(b.index === focus) - Number(a.index === focus));
    this.syncDom(panels, view);
    return panels;
  }

  private step(now: number): void {
    const animation = this.animation;
    if (!animation) {
      return;
    }
    const t = Math.min(
      1,
      Math.max(0, (now - animation.start) / animation.duration),
    );
    this.progressValue = animation.from + (animation.to - animation.from) * t;
    if (t < 1) {
      return;
    }
    this.animation = null;
    const next = this.next;
    this.next = null;
    if (!next) {
      return;
    }
    if (next.config) {
      this.configValue = next.config;
      this.set(next.config, next.durationMs);
    } else {
      this.clear();
    }
  }

  /**
   * The layer `base` shows in panel `index`: `base` itself at offset 0, else
   * its shadow at that year, opened or restyled to match it; null for
   * particles, which comparisons hide, and while a shadow cannot open yet.
   */
  layerFor(base: FieldLayer, index: number): FieldLayer | null {
    if (base.vector) {
      return null;
    }
    const yearOffset = this.yearOffset(index);
    if (!yearOffset) {
      return base;
    }
    let byPanel = this.shadows.get(base);
    if (!byPanel) {
      byPanel = new Map();
      this.shadows.set(base, byPanel);
    }
    let shadow = byPanel.get(index);
    if (shadow && shadow.layerId !== base.layer.id) {
      shadow.field.destroy();
      byPanel.delete(index);
      shadow = undefined;
    }
    if (!shadow) {
      if (!base.opened) {
        return null;
      }
      const field = this.createField();
      field.driving = false;
      const created: Shadow = {
        field,
        layerId: base.layer.id,
        revision: base.revision,
        yearOffset,
      };
      field.timeShift = (ms) => shiftYears(ms, created.yearOffset);
      byPanel.set(index, created);
      field
        .open(base.layer, {
          at: field.timeShift(base.shownTime),
          style: base.viewStyle,
          timeRange: null,
        })
        .catch((error: unknown) => console.error(error));
      return field;
    }
    if (shadow.revision !== base.revision) {
      shadow.revision = base.revision;
      shadow.field.restyle(base.viewStyle);
      const palette = shadow.field.stylePalette(base.layer);
      if (palette !== shadow.field.palette) {
        shadow.field.applyPalette(palette);
      }
    }
    shadow.yearOffset = yearOffset;
    return shadow.field;
  }

  /** Drop the shadows of layers no longer shown. */
  prune(bases: readonly FieldLayer[]): void {
    for (const [base, byPanel] of this.shadows) {
      if (!bases.includes(base)) {
        byPanel.forEach((shadow) => shadow.field.destroy());
        this.shadows.delete(base);
      }
    }
  }

  private clear(): void {
    this.configValue = null;
    this.progressValue = 0;
    this.animation = null;
    this.next = null;
    for (const byPanel of this.shadows.values()) {
      byPanel.forEach((shadow) => shadow.field.destroy());
    }
    this.shadows.clear();
  }

  // ---- labels and divider ----------------------------------------------

  private createDom(): CompareDom {
    const doc = this.root.ownerDocument;
    const layer = doc.createElement("div");
    layer.dataset.projversor = "compare";
    layer.style.cssText =
      "position: absolute; inset: 0; pointer-events: none; overflow: hidden";
    const line = doc.createElement("div");
    line.dataset.projversor = "compare-line";
    line.style.cssText =
      "position: absolute; background: var(--compare-line, rgba(255, 255, 255, 0.9));" +
      "box-shadow: 0 0 8px rgba(0, 0, 0, 0.5)";
    const handle = doc.createElement("button");
    handle.type = "button";
    handle.dataset.projversor = "compare-handle";
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", this.ariaLabel);
    handle.setAttribute("aria-valuemin", "0");
    handle.setAttribute("aria-valuemax", "100");
    handle.innerHTML = HANDLE_SVG;
    handle.style.cssText =
      "position: absolute; width: 36px; height: 36px; margin: -18px 0 0 -18px;" +
      "display: grid; place-items: center; padding: 0; border: 0;" +
      "border-radius: 50%; pointer-events: auto; touch-action: none;" +
      "cursor: grab; color: var(--compare-handle-ink, #0b0d12);" +
      "background: var(--compare-handle, #fff);" +
      "box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45)";
    layer.append(line, handle);
    this.after.after(layer);
    return { layer, labels: [], line, handle, detach: this.attachDrag(handle) };
  }

  private syncDom(
    panels: readonly (StagePanel & { view: View })[] | null,
    view: View,
  ): void {
    const config = this.configValue;
    this.area = areaRect(view);
    if (!panels || !config) {
      if (this.dom && this.dom.layer.style.display !== "none") {
        this.dom.layer.style.display = "none";
        this.domKey = "";
      }
      return;
    }
    const key = JSON.stringify([
      panels.map((p) => [p.clip, p.alpha]),
      config.panels.map((p) => p.label),
      config.layout,
      config.axis,
      view.width,
      view.height,
    ]);
    if (key === this.domKey) {
      return;
    }
    this.domKey = key;
    this.dom ??= this.createDom();
    const dom = this.dom;
    dom.layer.style.display = "";
    const doc = this.root.ownerDocument;
    while (dom.labels.length < panels.length) {
      const label = doc.createElement("span");
      label.dataset.projversor = "compare-label";
      label.style.cssText =
        "position: absolute; padding: 2px 8px; border-radius: 2px;" +
        "font: 700 13px/1.4 system-ui, sans-serif; letter-spacing: 0.04em;" +
        "color: var(--compare-ink, #fff); white-space: nowrap;" +
        "background: var(--compare-label, rgba(3, 4, 9, 0.6))";
      dom.layer.append(label);
      dom.labels.push(label);
    }
    const swipe = config.layout === "swipe";
    const xAxis = (config.axis ?? "x") === "x";
    const area = this.area;
    const inset = 12;
    // Grid labels fade in as the cells settle, not on moving rects.
    const settled = swipe
      ? 1
      : Math.min(
          1,
          Math.max(0, (this.progressValue - LABELS_FROM) / (1 - LABELS_FROM)),
        );
    dom.labels.forEach((label, i) => {
      const panel = panels.find((p) => p.index === i);
      const text = config.panels[i]?.label;
      const hidden = !panel || !text || panel.alpha <= 0 || settled <= 0;
      label.style.display = hidden ? "none" : "";
      if (!panel || hidden) {
        return;
      }
      label.textContent = text ?? "";
      label.style.opacity = String(Math.min(panel.alpha, settled));
      // A swipe labels the outer corners of the free zone; a grid each
      // cell's top left.
      const anchor = swipe ? area : panel.clip;
      const second = swipe && i === 1;
      label.style.left = second && xAxis ? "" : `${anchor.x + inset}px`;
      label.style.right =
        second && xAxis
          ? `${view.width - anchor.x - anchor.width + inset}px`
          : "";
      label.style.top = second && !xAxis ? "" : `${anchor.y + inset}px`;
      label.style.bottom =
        second && !xAxis
          ? `${view.height - anchor.y - anchor.height + inset}px`
          : "";
    });
    // Inline displays: page styles may override the hidden attribute.
    dom.line.style.display = swipe ? "" : "none";
    dom.handle.style.display = swipe ? "grid" : "none";
    if (!swipe) {
      return;
    }
    const split = panels.find((p) => p.index === 1)!.clip;
    if (xAxis) {
      Object.assign(dom.line.style, {
        left: `${split.x - 1}px`,
        top: `${area.y}px`,
        width: "2px",
        height: `${area.height}px`,
      });
      dom.handle.style.left = `${split.x}px`;
      dom.handle.style.top = `${area.y + area.height / 2}px`;
    } else {
      Object.assign(dom.line.style, {
        left: `${area.x}px`,
        top: `${split.y - 1}px`,
        width: `${area.width}px`,
        height: "2px",
      });
      dom.handle.style.left = `${area.x + area.width / 2}px`;
      dom.handle.style.top = `${split.y}px`;
    }
    dom.handle.style.transform = xAxis ? "" : "rotate(90deg)";
    dom.handle.setAttribute(
      "aria-valuenow",
      String(Math.round((config.divider ?? 0.5) * 100)),
    );
    dom.handle.setAttribute(
      "aria-orientation",
      xAxis ? "horizontal" : "vertical",
    );
  }

  private moveDivider(divider: number): void {
    const d = Math.min(1, Math.max(0, divider));
    this.setDivider(d);
    this.onDivider(d);
  }

  private attachDrag(handle: HTMLButtonElement): () => void {
    let dragging = false;
    const at = (event: PointerEvent) => {
      const box = this.root.getBoundingClientRect();
      const area = this.area;
      return (this.configValue?.axis ?? "x") === "x"
        ? (event.clientX - box.left - area.x) / area.width
        : (event.clientY - box.top - area.y) / area.height;
    };
    const down = (event: PointerEvent) => {
      dragging = true;
      handle.setPointerCapture(event.pointerId);
      handle.style.cursor = "grabbing";
      event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (dragging) {
        this.moveDivider(at(event));
      }
    };
    const up = (event: PointerEvent) => {
      dragging = false;
      handle.style.cursor = "grab";
      if (handle.hasPointerCapture(event.pointerId)) {
        handle.releasePointerCapture(event.pointerId);
      }
    };
    const key = (event: KeyboardEvent) => {
      const d = this.configValue?.divider ?? 0.5;
      const steps: Record<string, number> = {
        ArrowLeft: d - KEY_STEP,
        ArrowUp: d - KEY_STEP,
        ArrowRight: d + KEY_STEP,
        ArrowDown: d + KEY_STEP,
        Home: 0,
        End: 1,
      };
      if (event.key in steps) {
        event.preventDefault();
        this.moveDivider(steps[event.key]);
      }
    };
    handle.addEventListener("pointerdown", down);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    handle.addEventListener("keydown", key);
    return () => {
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      handle.removeEventListener("keydown", key);
    };
  }

  destroy(): void {
    this.clear();
    this.dom?.detach();
    this.dom?.layer.remove();
    this.dom = null;
  }
}
