import { mergeStyles, styleForKind } from "@fxi/zartigl/catalog";
import type { LayerStyleInput } from "@fxi/zartigl/catalog";
import { colorGradeToGrade, type ColorGrade } from "@fxi/zartigl/engine";
import {
  PRESETS,
  PROJVERSOR_LAYERS,
  Projversor,
  SPEEDS,
  chunkLabel,
  decodeShare,
  encodeShare,
  findLayer,
  findPreset,
  formatUnit,
  isTintFor,
  layerPalettes,
  layerSearchText,
  legendTicks,
  loadLayers,
  linearTicks,
  monthLegend,
  playheadLabel,
  rampGradient,
  rampPosition,
  timeTicks,
  tintLayersFor,
  type FieldLayerConfig,
  type FieldLayerHandle,
  type ProjversorLayer,
  type ProjversorMonth,
  type ShareState,
} from "../../src";
import { Compass } from "./Compass";
import { GradePanel } from "./GradePanel";
import { LayerPicker, type PickItem } from "./LayerPicker";

/** Zoom button factor and rotate button step (degrees of longitude). */
const ZOOM_STEP = 1.5;
const ROTATE_STEP = 15;
/** How long the Share button confirms the copy. */
const COPIED_MS = 1500;
/** Id of the one layer the explorer shows. */
const FIELD = "field";

function refs(root: HTMLElement) {
  const get = <T extends Element>(name: string): T => {
    const el = root.querySelector<T>(`[data-ref="${name}"]`);
    if (!el) {
      throw new Error(`Missing element: ${name}`);
    }
    return el;
  };
  return {
    stage: get<HTMLElement>("stage"),
    provider: get<HTMLElement>("provider"),
    projectionName: get<HTMLElement>("projectionName"),
    status: get<HTMLElement>("status"),
    date: get<HTMLElement>("date"),
    hour: get<HTMLElement>("hour"),
    time: get<HTMLInputElement>("time"),
    zoomIn: get<HTMLButtonElement>("zoomIn"),
    zoomOut: get<HTMLButtonElement>("zoomOut"),
    rotateLeft: get<HTMLButtonElement>("rotateLeft"),
    rotateRight: get<HTMLButtonElement>("rotateRight"),
    days: get<HTMLElement>("days"),
    compass: get<HTMLButtonElement>("compass"),
    needle: get<SVGElement>("needle"),
    play: get<HTMLButtonElement>("play"),
    month: get<HTMLSelectElement>("month"),
    speed: get<HTMLSelectElement>("speed"),
    palette: get<HTMLSelectElement>("palette"),
    gradeToggle: get<HTMLButtonElement>("gradeToggle"),
    gradePanel: get<HTMLFormElement>("gradePanel"),
    unit: get<HTMLElement>("unit"),
    speedKey: get<HTMLElement>("speedKey"),
    speedMax: get<HTMLElement>("speedMax"),
    ramp: get<HTMLElement>("ramp"),
    ticks: get<HTMLElement>("ticks"),
    projection: get<HTMLSelectElement>("projection"),
    layer: get<HTMLButtonElement>("layer"),
    tintField: get<HTMLElement>("tintField"),
    tint: get<HTMLButtonElement>("tint"),
    share: get<HTMLButtonElement>("share"),
  };
}

const layerType = (layer: ProjversorLayer) =>
  layer.kind === "vector" ? "particles" : "scalar";

/** The projversor controls: rail, pickers, timeline, legend and share. */
class ProjectionDemo {
  private readonly ui: ReturnType<typeof refs>;
  private readonly projversor: Projversor;
  private readonly shared: Partial<ShareState>;
  private readonly compass: Compass;
  private readonly gradePanel: GradePanel;
  private readonly layerPicker: LayerPicker;
  private readonly tintPicker: LayerPicker;
  /** The shown layer, once opened. */
  private field: FieldLayerHandle | null = null;
  /** Timeline thumb held: playback waits for its release. */
  private scrubbing = false;
  private copiedTimer = 0;

  constructor(root: HTMLElement) {
    this.ui = refs(root);
    const shared = decodeShare(location.hash);
    // Older links may hold a particle grade for a raster layer.
    if (shared.style) {
      const kind = (findLayer(shared.layer) ?? PROJVERSOR_LAYERS[0]).kind;
      shared.style = styleForKind(shared.style, kind);
    }
    this.shared = shared;
    this.projversor = new Projversor(this.ui.stage, {
      preset: shared.preset,
      rotate: shared.rotate,
      zoom: shared.zoom,
      time: shared.time,
      playing: shared.playing ?? true,
    });
    this.compass = new Compass(this.ui.compass, this.ui.needle, {
      onBearing: (deg) => this.projversor.view.setBearing(deg),
      onToggle: () => this.projversor.view.toggleNorth(),
    });
    this.gradePanel = new GradePanel(
      this.ui.gradeToggle,
      this.ui.gradePanel,
      (grade) => this.setGrade(grade),
    );
    const run = (task: Promise<void>) =>
      task.catch((error: unknown) => this.fail(error));
    this.layerPicker = new LayerPicker(this.ui.layer, {
      placeholder: "Search layers: currents, ozone, leman…",
      onPick: (id) => {
        const next = findLayer(id);
        if (next) {
          void run(this.open(next, { frame: true }));
        }
      },
    });
    this.tintPicker = new LayerPicker(this.ui.tint, {
      placeholder: "Color particles by…",
      onPick: (id) => {
        const field = this.field;
        if (field) {
          void run(this.open(field.source, { tint: id || null }));
        }
      },
    });
  }

  /** Create the renderer and open the shared state. Rejects without WebGL2. */
  async start(): Promise<void> {
    const p = this.projversor;
    // Layers published since this build; the bundled ones when offline.
    await Promise.all([p.init(), loadLayers()]);
    this.compass.locked = p.view.northLocked;
    this.buildPickers(p.view.preset.id);
    this.bindRenderer();
    this.bindControls();
    this.setPlaying(p.playing);
    const shared = this.shared;
    const layer = findLayer(shared.layer) ?? PROJVERSOR_LAYERS[0];
    const hasView =
      shared.preset !== undefined ||
      shared.rotate !== undefined ||
      shared.zoom !== undefined;
    await this.open(layer, {
      // "" is "no tint"; an unknown id falls back to the layer's own.
      tint:
        shared.tint === ""
          ? null
          : isTintFor(layer, shared.tint)
            ? shared.tint
            : undefined,
      style: shared.style,
      speed: shared.speed,
      timeRange: shared.timeRange,
      frame: !hasView,
    });
    this.gradePanel.value = this.field!.grade;
  }

  /** Show `layer` in place of the shown one, once its month is decoded. */
  private async open(
    layer: ProjversorLayer,
    options: Omit<FieldLayerConfig, "source"> = {},
  ): Promise<void> {
    this.field = await this.projversor.replace(FIELD, layerType(layer), {
      source: layer.id,
      ...options,
    });
    this.syncLayer(this.field);
  }

  /** Merge into the shown layer's style override. */
  private restyle(style: LayerStyleInput): void {
    const field = this.field;
    if (field) {
      void field.update(mergeStyles(field.style, style));
    }
  }

  private setGrade(grade: ColorGrade): void {
    this.restyle({ particles: { grade: colorGradeToGrade(grade) } });
  }

  private bindRenderer(): void {
    const p = this.projversor;
    p.on("status", ({ text }) => this.setStatus(text));
    p.on("month", ({ month }) => {
      const field = this.field;
      if (field) {
        this.ui.month.value = String(field.chunkIndex);
        this.buildDays(field.times);
      }
      this.buildLegend(month);
    });
    p.on("palette", ({ palette, ramp }) => {
      this.ui.palette.value = palette;
      this.ui.ramp.style.background = rampGradient(palette, ramp);
    });
    p.on("playing", (playing) => this.setPlaying(playing));
    p.on("preset", (preset) => {
      this.ui.projection.value = preset.id;
      this.ui.projectionName.textContent = preset.label;
    });
    p.on("north", (locked) => (this.compass.locked = locked));
    p.on("frame", () => {
      this.compass.bearing = p.view.bearing;
      const times = this.field?.times ?? [];
      if (times.length < 2) {
        return;
      }
      const first = times[0];
      const last = times[times.length - 1];
      if (!this.scrubbing) {
        this.setTimeline((p.time - first) / (last - first));
      }
      const stepMs = (last - first) / (times.length - 1);
      const { date, hour } = playheadLabel(p.time, stepMs);
      this.ui.date.textContent = date;
      this.ui.hour.textContent = hour;
      this.ui.hour.hidden = !hour;
    });
  }

  /** Month, layer, tint, speed and palette pickers for the open layer. */
  private syncLayer(field: FieldLayerHandle): void {
    const layer = field.source;
    const { month, tintField, speed, palette } = this.ui;
    month.replaceChildren(
      ...field.chunks.map(
        (chunk, i) =>
          new Option(
            chunkLabel(chunk.temporal?.start, chunk.temporal?.end),
            String(i),
          ),
      ),
    );
    month.value = String(field.chunkIndex);
    this.ui.provider.textContent = providerLabel(
      field.chunks[0]?.provenance?.provider,
    );
    this.layerPicker.value = layer.id;
    tintField.hidden = layer.kind !== "vector";
    this.gradePanel.available = layer.kind === "vector";
    this.tintPicker.setItems([
      {
        id: "",
        label: "Speed",
        detail: "Brightness and color by speed",
        group: "Particle color",
      },
      ...tintLayersFor(layer).map((l) => pickItem(l, "Color by", l.entryId)),
    ]);
    this.tintPicker.value = field.tint ?? "";
    speed.replaceChildren(
      ...SPEEDS[layer.kind].map((s) => new Option(`${s}×`, String(s))),
    );
    speed.value = String(field.speed);
    palette.replaceChildren(
      ...layerPalettes(layer).map((pal) => new Option(pal.label, pal.id)),
    );
    palette.value = field.palette;
  }

  private buildPickers(activePreset: string): void {
    const { projection } = this.ui;
    projection.replaceChildren(
      ...PRESETS.map((preset) => new Option(preset.label, preset.id)),
    );
    projection.value = activePreset;
    this.ui.projectionName.textContent = projection.selectedOptions[0].text;
    this.layerPicker.setItems(
      PROJVERSOR_LAYERS.map((l) =>
        pickItem(l, l.kind === "vector" ? "Flows" : undefined),
      ),
    );
  }

  private bindControls(): void {
    const p = this.projversor;
    const { projection, month, speed, palette } = this.ui;
    const run = (task: Promise<void>) =>
      task.catch((error: unknown) => this.fail(error));
    projection.addEventListener("change", () => {
      if (findPreset(projection.value)) {
        p.view.goTo({ preset: projection.value });
      }
    });
    month.addEventListener("change", () => {
      if (this.field) {
        void run(this.field.openMonth(Number(month.value)));
      }
    });
    speed.addEventListener("change", () => {
      void run(p.update({ speed: Number(speed.value) }));
    });
    palette.addEventListener("change", () =>
      this.restyle({ palette: palette.value }),
    );

    this.ui.play.addEventListener("click", () => {
      void p.update({ playing: !p.playing });
    });
    this.ui.share.addEventListener("click", () => this.share());
    this.ui.zoomIn.addEventListener("click", () => p.view.zoomBy(ZOOM_STEP));
    this.ui.zoomOut.addEventListener("click", () =>
      p.view.zoomBy(1 / ZOOM_STEP),
    );
    this.ui.rotateLeft.addEventListener("click", () =>
      p.view.rotateBy(-ROTATE_STEP),
    );
    this.ui.rotateRight.addEventListener("click", () =>
      p.view.rotateBy(ROTATE_STEP),
    );

    // The thumb drives the playhead like a jog wheel: playback holds while
    // it is held (pointer or key) and resumes on release.
    const time = this.ui.time;
    const hold = (held: boolean) => {
      this.scrubbing = held;
      void p.update({ held });
    };
    time.addEventListener("pointerdown", (event) => {
      time.setPointerCapture(event.pointerId);
      hold(true);
    });
    time.addEventListener("keydown", () => hold(true));
    for (const type of ["pointerup", "pointercancel", "keyup", "blur"]) {
      time.addEventListener(type, () => hold(false));
    }
    time.addEventListener("input", () => {
      const times = this.field?.times ?? [];
      if (times.length < 2) {
        return;
      }
      const span = times[times.length - 1] - times[0];
      void run(p.update({ time: times[0] + Number(time.value) * span }));
      time.style.setProperty("--p", time.value);
    });
    window.addEventListener("keydown", (event) => {
      if (event.code === "Space" && event.target === document.body) {
        event.preventDefault();
        void p.update({ playing: !p.playing });
      }
    });
  }

  private setStatus(text: string): void {
    if (this.ui.status.textContent !== text) {
      this.ui.status.textContent = text;
    }
  }

  private fail(error: unknown): void {
    console.error(error);
    this.setStatus(String(error));
  }

  /** Everything needed to reproduce the displayed view. */
  private state(field: FieldLayerHandle): ShareState {
    const p = this.projversor;
    return {
      layer: field.source.id,
      time: p.time,
      preset: p.view.preset.id,
      rotate: [...p.view.rotate],
      zoom: p.view.zoom,
      playing: p.playing,
      speed: field.speed,
      tint: field.tint ?? "",
      style: styleForKind(field.style, field.source.kind),
      timeRange: field.timeRange ?? undefined,
    };
  }

  /** Copy a link to the displayed view. */
  private share(): void {
    if (!this.field) {
      return;
    }
    const url = new URL(location.href);
    url.hash = encodeShare(this.state(this.field));
    // navigator.clipboard is missing outside secure contexts.
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(url.href))
      .then(
        () => {
          const button = this.ui.share;
          button.classList.add("copied");
          button.setAttribute("aria-label", "Link copied");
          clearTimeout(this.copiedTimer);
          this.copiedTimer = window.setTimeout(() => {
            button.classList.remove("copied");
            button.setAttribute("aria-label", "Share");
          }, COPIED_MS);
        },
        () => this.setStatus(url.href),
      );
  }

  private setPlaying(playing: boolean): void {
    this.ui.play.classList.toggle("playing", playing);
    this.ui.play.setAttribute("aria-label", playing ? "Pause" : "Play");
  }

  /** Thumb position and the played part of the track, 0–1. */
  private setTimeline(value: number): void {
    this.ui.time.value = String(value);
    this.ui.time.style.setProperty("--p", String(value));
  }

  /**
   * Ramp ticks and unit: a scalar raster or the tint over its domain
   * (linear), the tint with a speed brightness key, else the speed
   * (square-root ramp).
   */
  private buildLegend({ field, tint }: ProjversorMonth): void {
    const speedUnit = formatUnit(field.manifest.style.unit);
    const tick = (value: number, position: number) => {
      const li = document.createElement("li");
      li.textContent = String(value);
      li.style.bottom = `${position * 100}%`;
      return li;
    };
    this.ui.speedKey.hidden = !tint;
    const legend = monthLegend({ field, tint });
    this.ui.unit.textContent = legend.unit;
    if (legend.ramp === "linear") {
      this.ui.ticks.replaceChildren(
        ...linearTicks(legend.min, legend.max).map((t) =>
          tick(t.value, t.position),
        ),
      );
      this.ui.speedMax.textContent = `${field.maxSpeed} ${speedUnit}`;
      return;
    }
    this.ui.ticks.replaceChildren(
      ...legendTicks(legend.max).map((value) =>
        tick(value, rampPosition(value, legend.max)),
      ),
    );
  }

  private buildDays(times: readonly number[]): void {
    const ticks =
      times.length > 1 ? timeTicks(times[0], times[times.length - 1]) : [];
    this.ui.days.replaceChildren(
      ...ticks.map(({ label, position, major }) => {
        const li = document.createElement("li");
        if (major) {
          li.textContent = label;
        } else {
          li.className = "minor";
        }
        li.style.top = `${position * 100}%`;
        return li;
      }),
    );
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  ocean: "Ocean",
  atmosphere: "Atmosphere",
  biology: "Ocean biology",
  ice: "Sea ice",
  waves: "Waves",
  land: "Land",
  coast: "Coast",
  freshwater: "Lakes",
};

/**
 * A layer as a picker choice, listed under `group` or its category. Tint
 * choices pass the entry id as `id`, as the field and share links hold it.
 */
function pickItem(
  layer: ProjversorLayer,
  group?: string,
  id = layer.id,
): PickItem {
  const category = CATEGORY_LABELS[layer.category] ?? layer.category;
  return {
    id,
    label: layer.label,
    detail: [group ? category : undefined, layer.provider]
      .filter(Boolean)
      .join(" · "),
    group: group ?? category,
    search: layerSearchText(layer),
  };
}

function providerLabel(provider: string | undefined): string {
  return provider === "copernicus-marine" ? "Copernicus" : (provider ?? "");
}

const root = document.getElementById("app");
if (root) {
  const fail = (error: unknown) => {
    console.error(error);
    root.querySelector('[data-ref="status"]')!.textContent = String(error);
  };
  try {
    new ProjectionDemo(root).start().catch(fail);
  } catch (error) {
    fail(error);
  }
}
