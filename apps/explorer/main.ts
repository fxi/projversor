import { mergeStyles, styleForKind } from "@fxi/zartigl/catalog";
import type { LayerStyleInput } from "@fxi/zartigl/catalog";
import {
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
  layerSearchText,
  legendTicks,
  loadLayers,
  linearTicks,
  monthLegend,
  playheadLabel,
  rampConic,
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
import type { PickItem } from "./LayerPicker";
import { Toolbar, glyph, type Tool } from "./panel";
import {
  ExportPanel,
  LayersPanel,
  PalettePanel,
  ProjectionPanel,
  VectorPanel,
} from "./panels";

/** Zoom button factor and rotate button step (degrees of longitude). */
const ZOOM_STEP = 1.5;
const ROTATE_STEP = 15;
/** Id of the one layer the explorer shows. */
const FIELD = "field";

/** Glyphs of the tool buttons, 24px strokes. */
const ICONS = {
  palette: [
    "M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.9 1.4-1.9-.4-1.1.3-2.4 1.6-2.4H17a4 4 0 0 0 4-4C21 7.1 17 3 12 3Z",
    "M7.5 12h.01M9.5 7.8h.01M14.5 7.8h.01M16.8 11.5h.01",
  ],
  vector: [
    "M3 8.5h10.5a2.5 2.5 0 1 0-2.5-2.5",
    "M3 15.5h14.5a2.5 2.5 0 1 1-2.5 2.5",
    "M3 12h7",
  ],
  layers: [
    "M12 3.5 3 8l9 4.5L21 8l-9-4.5Z",
    "M3 12.2l9 4.5 9-4.5",
    "M3 16.4l9 4.5 9-4.5",
  ],
  projection: [
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
    "M3 12h18M12 3c-5 5.5-5 12.5 0 18M12 3c5 5.5 5 12.5 0 18",
  ],
  export: ["M12 14.5V3.5M7.5 8 12 3.5 16.5 8", "M5 11.5V20h14v-8.5"],
};

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
    tools: get<HTMLElement>("tools"),
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
    unit: get<HTMLElement>("unit"),
    speedKey: get<HTMLElement>("speedKey"),
    speedMax: get<HTMLElement>("speedMax"),
    ramp: get<HTMLElement>("ramp"),
    ticks: get<HTMLElement>("ticks"),
  };
}

const layerType = (layer: ProjversorLayer) =>
  layer.kind === "vector" ? "particles" : "scalar";

/**
 * The projversor controls: the tool panels (palette, vector, layers,
 * projection, export) at the bottom left, the rail with timeline, month,
 * speed and legend on the right.
 */
class ProjectionDemo {
  private readonly ui: ReturnType<typeof refs>;
  private readonly projversor: Projversor;
  private readonly shared: Partial<ShareState>;
  private readonly compass: Compass;
  private readonly toolbar: Toolbar;
  private readonly palettePanel: PalettePanel;
  private readonly vectorPanel: VectorPanel;
  private readonly layersPanel: LayersPanel;
  private readonly projectionPanel: ProjectionPanel;
  private readonly exportPanel: ExportPanel;
  private readonly paletteTool: Tool;
  private readonly vectorTool: Tool;
  /** The shown layer, once opened. */
  private field: FieldLayerHandle | null = null;
  /** Timeline thumb held: playback waits for its release. */
  private scrubbing = false;

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
    const run = (task: Promise<void>) =>
      task.catch((error: unknown) => this.fail(error));
    const restyle = (style: LayerStyleInput) => this.restyle(style);

    this.palettePanel = new PalettePanel(restyle);
    this.vectorPanel = new VectorPanel(restyle);
    this.layersPanel = new LayersPanel({
      onLayer: (id) => {
        const next = findLayer(id);
        if (next) {
          void run(this.open(next, { frame: true }));
        }
      },
      onTint: (id) => {
        const field = this.field;
        if (field) {
          void run(this.open(field.source, { tint: id || null }));
        }
      },
    });
    this.projectionPanel = new ProjectionPanel((id) => {
      if (findPreset(id)) {
        this.projversor.view.goTo({ preset: id });
      }
    });
    this.exportPanel = new ExportPanel((text) => this.setStatus(text));

    const toolbar = new Toolbar(this.ui.tools, this.ui.stage);
    this.toolbar = toolbar;
    this.paletteTool = toolbar.add({
      id: "palette",
      label: "Palette",
      icon: glyph(ICONS.palette),
      onOpen: () => this.field && this.palettePanel.sync(this.field, true),
    });
    this.paletteTool.button.classList.add("tool-palette");
    this.paletteTool.body.append(this.palettePanel.el);
    this.vectorTool = toolbar.add({
      id: "vector",
      label: "Particles",
      icon: glyph(ICONS.vector),
      onOpen: () => this.field && this.vectorPanel.sync(this.field),
    });
    this.vectorTool.body.append(this.vectorPanel.el);
    toolbar
      .add({
        id: "layers",
        label: "Layer",
        icon: glyph(ICONS.layers),
        onOpen: () => this.layersPanel.picker.reset(),
      })
      .body.append(this.layersPanel.el);
    toolbar
      .add({
        id: "projection",
        label: "Projection",
        icon: glyph(ICONS.projection),
      })
      .body.append(this.projectionPanel.el);
    toolbar
      .add({
        id: "export",
        label: "Share and export",
        icon: glyph(ICONS.export),
        onOpen: () => this.syncExport(),
      })
      .body.append(this.exportPanel.el);
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
      void field
        .update(mergeStyles(field.style, style))
        .catch((error: unknown) => this.fail(error));
    }
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
      this.ui.ramp.style.background = rampGradient(palette, ramp);
      this.paletteTool.button.style.setProperty(
        "--swatch",
        rampConic(palette, ramp),
      );
      this.palettePanel.showPalette(palette, ramp);
      if (this.field && this.paletteTool.open) {
        this.palettePanel.sync(this.field);
      }
    });
    p.on("playing", (playing) => this.setPlaying(playing));
    p.on("preset", (preset) => {
      this.projectionPanel.value = preset.id;
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

  /** Month and speed pickers, and the panels, for the open layer. */
  private syncLayer(field: FieldLayerHandle): void {
    const layer = field.source;
    const { month, speed } = this.ui;
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
    const vector = layer.kind === "vector";
    this.layersPanel.picker.value = layer.id;
    this.layersPanel.setTints(
      vector
        ? [
            {
              id: "",
              label: "Speed",
              detail: "Brightness and color by speed",
              group: "Particle color",
            },
            ...tintLayersFor(layer).map((l) =>
              pickItem(l, "Color by", l.entryId),
            ),
          ]
        : null,
      field.tint ?? "",
    );
    this.vectorTool.disabled = !vector;
    this.vectorTool.button.title = vector
      ? "Particles"
      : "Particles: open a flow layer (currents, wind, waves)";
    speed.replaceChildren(
      ...SPEEDS[layer.kind].map((s) => new Option(`${s}×`, String(s))),
    );
    speed.value = String(field.speed);
    this.palettePanel.sync(field);
    if (this.vectorTool.open) {
      this.vectorPanel.sync(field);
    }
  }

  private buildPickers(activePreset: string): void {
    this.projectionPanel.value = activePreset;
    this.ui.projectionName.textContent =
      findPreset(activePreset)?.label ?? activePreset;
    this.layersPanel.picker.setItems(
      PROJVERSOR_LAYERS.map((l) =>
        pickItem(l, l.kind === "vector" ? "Flows" : undefined),
      ),
    );
  }

  private bindControls(): void {
    const p = this.projversor;
    const { month, speed } = this.ui;
    const run = (task: Promise<void>) =>
      task.catch((error: unknown) => this.fail(error));
    month.addEventListener("change", () => {
      if (this.field) {
        void run(this.field.openMonth(Number(month.value)));
      }
    });
    speed.addEventListener("change", () => {
      void run(p.update({ speed: Number(speed.value) }));
    });

    this.ui.play.addEventListener("click", () => {
      void p.update({ playing: !p.playing });
    });
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

  /** The export panel shows the view as it is now. */
  private syncExport(): void {
    const field = this.field;
    if (!field) {
      return;
    }
    const state = this.state(field);
    const url = new URL(location.href);
    url.hash = encodeShare(state);
    this.exportPanel.set(state, url.href, field.source.label);
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
    this.palettePanel.setLegend(legend);
    if (this.field && this.paletteTool.open) {
      this.palettePanel.sync(this.field);
    }
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
