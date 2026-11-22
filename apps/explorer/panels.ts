import type { LayerStyleInput } from "@fxi/zartigl/catalog";
import {
  COLOR_GRADE_VIBRANT,
  colorGradeToGrade,
  resolveColorGrade,
  type ColorGrade,
  type PaletteMeta,
} from "@fxi/zartigl/engine";
import {
  PRESETS,
  layerPalettes,
  rampGradient,
  sceneStub,
  slugId,
  viewEntry,
  type FieldLayerHandle,
  type LegendScale,
  type ShareState,
} from "../../src";
import type { RampOptions } from "../../src/scales";
import { LayerPicker, type PickItem } from "./LayerPicker";
import { copy, range, section, textButton, toggle, type Range } from "./panel";

/** Restyle the shown layer: merged into its style override. */
type Restyle = (style: LayerStyleInput) => void;

const percent = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => (v > 0 ? `+${v.toFixed(2)}` : v.toFixed(2));
const fixed = (digits: number) => (v: number) => v.toFixed(digits);

/** Legend ends, about a hundredth of their range. */
function legendValue(value: number, span: number): string {
  const digits = Math.max(0, Math.min(6, 2 - Math.floor(Math.log10(span))));
  return Number(value.toFixed(digits)).toString();
}

// ---- palette --------------------------------------------------------------

const KINDS: [tag: string, label: string][] = [
  ["sequential", "Sequential"],
  ["diverging", "Diverging"],
  ["cyclic", "Cyclic"],
  ["monochrome", "Single color"],
];

function kindOf(palette: PaletteMeta): string {
  return KINDS.find(([tag]) => palette.tags.includes(tag))?.[1] ?? "Other";
}

/**
 * The palette, how it is drawn and, on a raster, the values it spans: a
 * preview with the legend ends, palettes grouped by kind, reverse, then the
 * raster's opacity, vibrance, fades and value range.
 */
export class PalettePanel {
  readonly el = document.createElement("div");
  private readonly preview = document.createElement("div");
  private readonly ends = document.createElement("div");
  private readonly list = document.createElement("div");
  private readonly reverse;
  private readonly raster = section("Raster");
  private readonly domain = section("Value range");
  private readonly opacity: Range;
  private readonly vibrance: Range;
  private readonly fadeLow: Range;
  private readonly fadeHigh: Range;
  private readonly min = document.createElement("input");
  private readonly max = document.createElement("input");
  private palettes: PaletteMeta[] = [];
  private palette = "";
  private ramp: RampOptions = {};

  constructor(private readonly restyle: Restyle) {
    this.el.className = "palette-panel";
    const head = section();
    this.preview.className = "palette-preview";
    this.ends.className = "palette-ends";
    head.append(this.preview, this.ends);

    this.list.className = "palette-list";
    this.list.addEventListener("click", (event) => {
      const row = (event.target as Element).closest<HTMLElement>("[data-id]");
      if (row) {
        this.restyle({ palette: row.dataset.id });
      }
    });
    this.reverse = toggle("Reverse", (reversePalette) =>
      this.restyle({ reversePalette }),
    );
    const palettes = section();
    palettes.append(this.list, this.reverse.el);

    const raster = (key: string, label: string, min = 0, format = percent) =>
      range({
        label,
        min,
        max: 1,
        step: 0.01,
        format,
        onInput: (value) => this.restyle({ raster: { [key]: value } }),
      });
    this.opacity = raster("opacity", "Opacity");
    this.vibrance = raster("vibrance", "Vibrance", -1, signed);
    this.fadeLow = raster("alphaFadeLow", "Fade in from low values");
    this.fadeHigh = raster("alphaFadeHigh", "Fade out to high values");
    this.raster.append(
      this.opacity.el,
      this.vibrance.el,
      this.fadeLow.el,
      this.fadeHigh.el,
    );

    const bounds = document.createElement("div");
    bounds.className = "tool-pair";
    for (const [input, label] of [
      [this.min, "Min"],
      [this.max, "Max"],
    ] as const) {
      const field = document.createElement("label");
      field.className = "tool-field";
      const name = document.createElement("span");
      name.textContent = label;
      input.type = "number";
      input.step = "any";
      input.addEventListener("change", () => this.applyDomain());
      field.append(name, input);
      bounds.append(field);
    }
    const auto = textButton("Fit to data", () =>
      this.restyle({ raster: { colorDomain: null } }),
    );
    this.domain.append(bounds, auto);

    this.el.append(head, palettes, this.raster, this.domain);
  }

  /**
   * Controls of the shown layer, from its resolved style; `reveal` scrolls
   * the picked palette into view, as the panel opens.
   */
  sync(field: FieldLayerHandle, reveal = false): void {
    const style = field.resolvedStyle;
    const scalar = field.source.kind === "scalar";
    this.palettes = layerPalettes(field.source);
    this.reverse.input.checked = style.reversePalette;
    this.raster.hidden = !scalar;
    this.domain.hidden = !scalar;
    this.opacity.value = style.raster.opacity;
    this.vibrance.value = style.raster.vibrance;
    this.fadeLow.value = style.raster.alphaFadeLow;
    this.fadeHigh.value = style.raster.alphaFadeHigh;
    const domain = field.domain;
    if (domain) {
      const span = domain[1] - domain[0] || 1;
      for (const [input, value] of [
        [this.min, domain[0]],
        [this.max, domain[1]],
      ] as const) {
        if (document.activeElement !== input) {
          input.value = legendValue(value, span);
        }
      }
    }
    this.renderList();
    // The picked palette in view, near the middle of the list.
    const picked = this.list.querySelector<HTMLElement>(
      '[aria-pressed="true"]',
    );
    if (reveal && picked && this.list.clientHeight) {
      this.list.scrollTop = picked.offsetTop - this.list.clientHeight / 2;
    }
  }

  /** The drawn palette changed: preview and the picked row. */
  showPalette(palette: string, ramp: RampOptions): void {
    const reversed = ramp.reverse !== this.ramp.reverse;
    this.palette = palette;
    this.ramp = ramp;
    this.preview.style.background = rampGradient(palette, ramp, "to right");
    if (reversed) {
      this.renderList();
    }
    for (const row of this.list.querySelectorAll<HTMLElement>("[data-id]")) {
      row.setAttribute("aria-pressed", String(row.dataset.id === palette));
    }
  }

  /** Values at the preview ends. */
  setLegend(legend: LegendScale): void {
    const span = legend.max - legend.min || 1;
    const text = (value: string) => {
      const span = document.createElement("span");
      span.textContent = value;
      return span;
    };
    this.ends.replaceChildren(
      text(legendValue(legend.min, span)),
      text(legend.unit),
      text(legendValue(legend.max, span)),
    );
  }

  private renderList(): void {
    const rows: HTMLElement[] = [];
    for (const [, kind] of [...KINDS, ["", "Other"]]) {
      const palettes = this.palettes.filter((p) => kindOf(p) === kind);
      if (!palettes.length) {
        continue;
      }
      const heading = document.createElement("h4");
      heading.textContent = kind;
      rows.push(heading);
      for (const p of palettes) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "palette-row";
        row.dataset.id = p.id;
        row.title = p.label;
        row.setAttribute("aria-pressed", String(p.id === this.palette));
        const swatch = document.createElement("span");
        swatch.className = "palette-swatch";
        swatch.style.background = rampGradient(
          p.id,
          { reverse: this.ramp.reverse },
          "to right",
        );
        const label = document.createElement("span");
        label.textContent = p.label;
        row.append(swatch, label);
        rows.push(row);
      }
    }
    this.list.replaceChildren(...rows);
  }

  private applyDomain(): void {
    const min = this.min.valueAsNumber;
    const max = this.max.valueAsNumber;
    if (Number.isFinite(min) && Number.isFinite(max) && min < max) {
      this.restyle({ raster: { colorDomain: [min, max] } });
    }
  }
}

// ---- vector ---------------------------------------------------------------

const GRADE_KEYS = [
  ["exposure", "Exposure", 0, 4, 0.05],
  ["contrast", "Contrast", 0, 1, 0.01],
  ["saturation", "Saturation", -1, 1, 0.01],
  ["highlights", "Highlights", 0, 1, 0.01],
] as const;

/**
 * The particles: density, speed, trail and glow, a solid backdrop under
 * them, and the color grade of their trails.
 */
export class VectorPanel {
  readonly el = document.createElement("div");
  private readonly density: Range;
  private readonly speed: Range;
  private readonly fade: Range;
  private readonly glow: Range;
  private readonly speedShade: Range;
  private readonly backdrop;
  private readonly backdropSource = document.createElement("select");
  private readonly backdropColorField = document.createElement("label");
  private readonly backdropColor = document.createElement("input");
  private readonly backdropOpacity: Range;
  private readonly graded;
  private readonly grade = {} as Record<(typeof GRADE_KEYS)[number][0], Range>;

  constructor(private readonly restyle: Restyle) {
    const particle = (
      key: "density" | "speed" | "fade" | "glow" | "speedShade",
      label: string,
      min: number,
      max: number,
      step: number,
      format: (v: number) => string,
    ) =>
      range({
        label,
        min,
        max,
        step,
        format,
        onInput: (value) => this.restyle({ particles: { [key]: value } }),
      });
    this.density = particle("density", "Density", 0.001, 0.2, 0.001, fixed(3));
    this.speed = particle("speed", "Speed", 0.1, 10, 0.1, fixed(1));
    this.fade = particle("fade", "Trail length", 0, 1, 0.01, percent);
    this.glow = particle("glow", "Glow", 0, 1, 0.01, percent);
    // Colored by another field, speed shows as brightness: 0 keeps it even.
    this.speedShade = particle(
      "speedShade",
      "Dim slow particles",
      0,
      1,
      0.01,
      percent,
    );
    const particles = section();
    particles.append(
      this.density.el,
      this.speed.el,
      this.fade.el,
      this.glow.el,
      this.speedShade.el,
    );

    // The backdrop is replaced as a whole: each control sends all of it.
    const sendBackdrop = () =>
      this.restyle({
        particles: {
          backdrop: {
            enabled: this.backdrop.input.checked,
            source: this.backdropSource.value as "color" | "field",
            color: this.backdropColor.value,
            opacity: this.backdropOpacity.value,
          },
        },
      });
    this.backdrop = toggle("Fill under the trails", () => {
      this.syncDisabled();
      sendBackdrop();
    });
    const source = document.createElement("label");
    source.className = "tool-field";
    const sourceName = document.createElement("span");
    sourceName.textContent = "Fill with";
    this.backdropSource.className = "tool-select";
    this.backdropSource.append(
      new Option("A color", "color"),
      new Option("The particle color field", "field"),
    );
    this.backdropSource.addEventListener("change", () => {
      this.syncDisabled();
      sendBackdrop();
    });
    source.append(sourceName, this.backdropSource);
    const color = this.backdropColorField;
    color.className = "tool-field tool-color";
    const colorName = document.createElement("span");
    colorName.textContent = "Color";
    this.backdropColor.type = "color";
    this.backdropColor.addEventListener("input", sendBackdrop);
    color.append(colorName, this.backdropColor);
    this.backdropOpacity = range({
      label: "Opacity",
      min: 0,
      max: 1,
      step: 0.01,
      format: percent,
      onInput: sendBackdrop,
    });
    const backdrop = section("Backdrop");
    backdrop.append(this.backdrop.el, source, color, this.backdropOpacity.el);

    this.graded = toggle("Enhanced colors", () => {
      this.syncDisabled();
      this.sendGrade();
    });
    const grade = section("Color grade");
    grade.append(this.graded.el);
    for (const [key, label, min, max, step] of GRADE_KEYS) {
      this.grade[key] = range({
        label,
        min,
        max,
        step,
        format: fixed(2),
        onInput: () => this.sendGrade(),
      });
      grade.append(this.grade[key].el);
    }
    grade.append(
      textButton("Reset color grade", () => {
        this.gradeValue = {
          ...COLOR_GRADE_VIBRANT,
          enabled: this.graded.input.checked,
        };
        this.sendGrade();
      }),
    );

    this.el.append(particles, backdrop, grade);
  }

  sync(field: FieldLayerHandle): void {
    const { particles } = field.resolvedStyle;
    this.density.value = particles.density;
    this.speed.value = particles.speed;
    this.fade.value = particles.fade;
    this.glow.value = particles.glow;
    this.speedShade.value = particles.speedShade;
    // Only particles colored by another field are shaded or fill with it.
    const tinted = field.tint !== null;
    this.speedShade.el.hidden = !tinted;
    this.backdropSource.options[1].disabled = !tinted;
    this.backdrop.input.checked = particles.backdrop.enabled;
    this.backdropSource.value = particles.backdrop.source;
    this.backdropColor.value = hex6(particles.backdrop.color);
    this.backdropOpacity.value = particles.backdrop.opacity;
    this.gradeValue = field.grade;
  }

  private get gradeValue(): ColorGrade {
    const grade: Partial<ColorGrade> = { enabled: this.graded.input.checked };
    for (const [key] of GRADE_KEYS) {
      grade[key] = this.grade[key].value;
    }
    return resolveColorGrade(grade);
  }

  private set gradeValue(grade: ColorGrade) {
    this.graded.input.checked = grade.enabled;
    for (const [key] of GRADE_KEYS) {
      this.grade[key].value = grade[key];
    }
    this.syncDisabled();
  }

  private sendGrade(): void {
    this.restyle({ particles: { grade: colorGradeToGrade(this.gradeValue) } });
  }

  private syncDisabled(): void {
    for (const [key] of GRADE_KEYS) {
      this.grade[key].disabled = !this.graded.input.checked;
    }
    const on = this.backdrop.input.checked;
    this.backdropOpacity.disabled = !on;
    this.backdropSource.disabled = !on;
    this.backdropColor.disabled = !on;
    this.backdropColorField.hidden = this.backdropSource.value === "field";
  }
}

/** `#rgb` as `#rrggbb`, which a color input needs. */
function hex6(color: string): string {
  return /^#[0-9a-f]{3}$/i.test(color)
    ? `#${[...color.slice(1)].map((c) => c + c).join("")}`
    : color;
}

// ---- layers ---------------------------------------------------------------

/** The layer, searchable, and what colors the particles of a vector one. */
export class LayersPanel {
  readonly el = document.createElement("div");
  readonly picker: LayerPicker;
  private readonly tint = document.createElement("select");
  private readonly tintSection = section("Particle color");

  constructor(options: {
    onLayer: (id: string) => void;
    onTint: (id: string) => void;
  }) {
    this.picker = new LayerPicker({
      label: "Layer",
      placeholder: "Search layers: currents, ozone, leman…",
      onPick: options.onLayer,
    });
    this.tint.className = "tool-select";
    this.tint.setAttribute("aria-label", "Particle color");
    this.tint.addEventListener("change", () => options.onTint(this.tint.value));
    this.tintSection.append(this.tint);
    this.el.className = "layers-panel";
    this.el.append(this.picker.el, this.tintSection);
  }

  /** Tint choices of the shown layer; hidden for a scalar one. */
  setTints(items: PickItem[] | null, value: string): void {
    this.tintSection.hidden = !items;
    this.tint.replaceChildren(
      ...(items ?? []).map((item) => new Option(item.label, item.id)),
    );
    this.tint.value = value;
  }
}

// ---- projection -----------------------------------------------------------

/** The projection presets, the shown one pressed. */
export class ProjectionPanel {
  readonly el = document.createElement("div");

  constructor(onPick: (id: string) => void) {
    this.el.className = "projection-grid";
    for (const preset of PRESETS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "projection-choice";
      button.dataset.id = preset.id;
      button.textContent = preset.label;
      button.addEventListener("click", () => onPick(preset.id));
      this.el.append(button);
    }
  }

  set value(id: string) {
    for (const button of this.el.querySelectorAll<HTMLElement>("[data-id]")) {
      button.setAttribute("aria-pressed", String(button.dataset.id === id));
    }
  }
}

// ---- export ---------------------------------------------------------------

/**
 * The shown view to take elsewhere: a link to it, a views.json entry for a
 * story, or a story scene showing it.
 */
export class ExportPanel {
  readonly el = document.createElement("div");
  private readonly id = document.createElement("input");
  private readonly link = document.createElement("output");
  private readonly view = document.createElement("pre");
  private readonly scene = document.createElement("pre");
  private state: ShareState | null = null;
  private label = "";
  private url = "";

  constructor(private readonly onFallback: (text: string) => void) {
    this.el.className = "export-panel";
    const link = section("Link");
    this.link.className = "export-link";
    link.append(
      this.link,
      this.copyButton("Copy link", () => this.url),
    );

    const id = document.createElement("label");
    id.className = "tool-field";
    const idName = document.createElement("span");
    idName.textContent = "View id";
    this.id.spellcheck = false;
    this.id.autocomplete = "off";
    this.id.addEventListener("input", () => this.render());
    id.append(idName, this.id);

    const view = section("Story view");
    view.append(
      id,
      this.view,
      this.copyButton("Copy views.json entry", () => this.view.textContent!),
    );
    const scene = section("Story scene");
    scene.append(
      this.scene,
      this.copyButton("Copy story.json scene", () => this.scene.textContent!),
    );
    for (const pre of [this.view, this.scene]) {
      pre.className = "export-code";
      pre.tabIndex = 0;
    }
    this.el.append(link, view, scene);
  }

  /** The view to export, as the panel opens. */
  set(state: ShareState, url: string, label: string): void {
    if (label !== this.label) {
      this.id.value = slugId(label);
    }
    this.state = state;
    this.url = url;
    this.label = label;
    this.render();
  }

  private render(): void {
    if (!this.state) {
      return;
    }
    const id = slugId(this.id.value);
    this.link.textContent = this.url;
    this.view.textContent = JSON.stringify(viewEntry(this.state, id), null, 2);
    this.scene.textContent = JSON.stringify(sceneStub(id, this.label), null, 2);
  }

  private copyButton(label: string, text: () => string): HTMLButtonElement {
    const button = textButton(label, () =>
      copy(text(), button, () => this.onFallback(text())),
    );
    return button;
  }
}
