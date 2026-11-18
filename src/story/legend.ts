import { scaleLinear, scaleSqrt } from "d3";
import type { LegendScale } from "../scales";
import type { LocalizedText } from "@fxi/story";
import { isContentPath } from "./contentPath";
import {
  mountTimeline,
  seriesValue,
  timeFormatter,
  type Bounds,
  type SeriesPoint,
  type TimeStep,
} from "./timeline";

/**
 * The key along the bottom of the stage, quiet like the progress line: the
 * date and timeline of the playing layer, then the color ramps of the view's
 * layers, bottom first, or the swatches of a stage widget. Adapted from the
 * legend band of the El Niño story.
 */

/** A swatch of a stage widget's key. */
export interface LegendSwatch {
  color: string;
  label: string;
  shape?: "dot" | "line" | "area";
}

/** What a scene keys, in the page language. */
export interface LegendKeys {
  /** The bottom layer's ramp; `stamp` adds the date and the timeline. */
  field?: { label: string; stamp: boolean; timeStep?: TimeStep };
  /** The ramps of the layers above it, in stack order, smaller. */
  layers?: { label: string }[];
  swatches?: LegendSwatch[];
}

/** `config` of a `legend` block: what the colors of the scene's map mean. */
export interface LegendConfig {
  /** The bottom layer's label. */
  label: LocalizedText;
  /** How the data was made: shown under the scene's text. */
  basis?: LocalizedText;
  /** Labels of the layers above the bottom one, in the view's stack order. */
  layers?: LocalizedText[];
  /** Date and timeline; true by default. */
  stamp?: boolean;
  /** Date precision and keyboard steps; daily by default. */
  timeStep?: TimeStep;
  /** A daily series of the field drawn on the timeline, with its name. */
  series?: { data: string; label: LocalizedText };
}

/** A series on the timeline, in the page language. */
export interface LegendSeries {
  label: string;
  unit: string;
  points: SeriesPoint[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is LocalizedText =>
  isRecord(value) &&
  Object.keys(value).length > 0 &&
  Object.values(value).every((v) => typeof v === "string");

/** Validate a legend config; throws on the first problem, with its path. */
export function parseLegendConfig(value: unknown): LegendConfig {
  const fail = (path: string, what: string): never => {
    throw new Error(`legend config: ${path} ${what}`);
  };
  if (!isRecord(value)) {
    return fail("", "must be an object");
  }
  for (const key of Object.keys(value)) {
    if (
      !["label", "basis", "layers", "stamp", "timeStep", "series"].includes(key)
    ) {
      fail(key, "is not a legend key");
    }
  }
  if (!isText(value.label)) {
    fail("label", "must be a localized text");
  }
  if (value.basis !== undefined && !isText(value.basis)) {
    fail("basis", "must be a localized text");
  }
  if (value.layers !== undefined) {
    if (!Array.isArray(value.layers)) {
      fail("layers", "must be an array");
    }
    (value.layers as unknown[]).forEach((label, i) => {
      if (!isText(label)) {
        fail(`layers.${i}`, "must be a localized text");
      }
    });
  }
  if (value.stamp !== undefined && typeof value.stamp !== "boolean") {
    fail("stamp", "must be a boolean");
  }
  if (
    value.timeStep !== undefined &&
    value.timeStep !== "day" &&
    value.timeStep !== "year"
  ) {
    fail("timeStep", 'must be "day" or "year"');
  }
  if (value.series !== undefined) {
    const series = value.series;
    if (!isRecord(series)) {
      return fail("series", "must be an object");
    }
    for (const key of Object.keys(series)) {
      if (key !== "data" && key !== "label") {
        fail(`series.${key}`, "is not a series key");
      }
    }
    if (!isContentPath(series.data)) {
      fail("series.data", "must be a path under the content root");
    }
    if (!isText(series.label)) {
      fail("series.label", "must be a localized text");
    }
  }
  return value as unknown as LegendConfig;
}

/**
 * Read a series file: `units` and daily `points` of `{time, value}`, in
 * time order. Throws on the first problem.
 */
export function parseSeriesData(value: unknown): {
  unit: string;
  points: SeriesPoint[];
} {
  const fail = (what: string): never => {
    throw new Error(`series data: ${what}`);
  };
  if (!isRecord(value) || !Array.isArray(value.points)) {
    return fail("needs a points array");
  }
  if (typeof value.units !== "string") {
    fail("needs units");
  }
  let last = -Infinity;
  const points = (value.points as unknown[]).map((p, i) => {
    const time =
      isRecord(p) && typeof p.time === "string" ? Date.parse(p.time) : NaN;
    const v = isRecord(p) ? p.value : undefined;
    if (
      !Number.isFinite(time) ||
      typeof v !== "number" ||
      !Number.isFinite(v)
    ) {
      return fail(`points.${i} needs a date and a finite value`);
    }
    if (time <= last) {
      fail(`points.${i} is out of time order`);
    }
    last = time;
    return { time, value: v };
  });
  return { unit: value.units as string, points };
}

/** Group and decimal separators of a locale: "," and "." in English. */
function separators(locale: string): Record<string, string> {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const part = (type: string, fallback: string) =>
    parts.find((p) => p.type === type)?.value ?? fallback;
  return { ",": part("group", ","), ".": part("decimal", ".") };
}

/** Tick values and positions (0–1) along a ramp: its ends and a middle. */
export function rampTicks(
  scale: Pick<LegendScale, "min" | "max" | "ramp">,
  count = 3,
  locale = "en",
): { at: number; label: string }[] {
  const { min, max } = scale;
  if (!(max > min)) {
    return [];
  }
  const s =
    scale.ramp === "sqrt" && min >= 0
      ? scaleSqrt().domain([min, max]).range([0, 1])
      : scaleLinear().domain([min, max]).range([0, 1]);
  const format = s.tickFormat(count);
  const marks = separators(locale);
  const room = 0.12;
  const inner = s.ticks(count).filter((v) => s(v) > room && s(v) < 1 - room);
  return [min, ...inner, max].map((value) => ({
    at: s(value),
    label: format(value)
      .replace("-", "−")
      .replace(/[,.]/g, (mark) => marks[mark] ?? mark),
  }));
}

interface Ramp {
  el: HTMLElement;
  bar: HTMLElement;
  ticks: HTMLElement;
  unit: HTMLElement;
}

function ramp(doc: Document, label: string, className: string): Ramp {
  const el = doc.createElement("div");
  el.className = `zs-legend-ramp ${className}`;
  const head = doc.createElement("p");
  head.className = "zs-legend-label";
  head.textContent = label;
  const unit = doc.createElement("span");
  unit.className = "zs-legend-unit";
  head.append(unit);
  const bar = doc.createElement("div");
  bar.className = "zs-legend-bar";
  const ticks = doc.createElement("div");
  ticks.className = "zs-legend-ticks";
  el.append(head, bar, ticks);
  return { el, bar, ticks, unit };
}

export interface LegendOptions {
  locale: string;
  /** Names of the key and of the timeline, in the page language. */
  labels: { key: string; timeline: string };
  onSeek(ms: number): Promise<void>;
  onHold(held: boolean): void;
}

export interface Legend {
  element: HTMLElement;
  /** What the active scene keys; null clears the band. */
  setKeys(keys: LegendKeys | null): void;
  /** Range and colors of the decoded month of the layer at `index`, bottom 0. */
  setRange(index: number, scale: LegendScale, gradient: string | null): void;
  /** Time window of the field, for the timeline. */
  setBounds(bounds: Bounds | null): void;
  /** The series on the timeline, its name and its value at the playhead. */
  setSeries(series: LegendSeries | null): void;
  /** Playhead, epoch ms: the date and the timeline's thumb. */
  setTime(ms: number): void;
  destroy(): void;
}

export function mountLegend(doc: Document, options: LegendOptions): Legend {
  let stamp = timeFormatter(options.locale, "day");
  const band = doc.createElement("div");
  band.className = "zs-legend";
  band.setAttribute("role", "group");
  band.setAttribute("aria-label", options.labels.key);
  const date = doc.createElement("p");
  date.className = "zs-legend-date";
  let lastDay = "";
  // The series' name and its value at the thumb, across from the date.
  const reading = doc.createElement("p");
  reading.className = "zs-legend-reading";
  const readingLabel = doc.createElement("span");
  const readingValue = doc.createElement("strong");
  reading.append(readingLabel, " ", readingValue);
  const number = new Intl.NumberFormat(options.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  let series: LegendSeries | null = null;
  const speak = (value: number) =>
    series ? `${number.format(value)} ${series.unit}` : "";
  const timeline = mountTimeline(doc, {
    locale: options.locale,
    label: options.labels.timeline,
    onSeek: options.onSeek,
    onHold: options.onHold,
    onShow(ms) {
      const day = stamp.format(new Date(ms));
      if (day !== lastDay) {
        lastDay = day;
        date.textContent = day;
        if (series) {
          const value = seriesValue(series.points, ms);
          readingValue.textContent = value === null ? "–" : speak(value);
        }
      }
    },
  });
  const head = doc.createElement("div");
  head.className = "zs-legend-head";
  head.append(date);
  const time = doc.createElement("div");
  time.className = "zs-legend-time";
  time.append(head, timeline.element);

  let shown: string | undefined;
  let stamped = false;
  // By stack position: the bottom layer's, then those above it.
  let ramps: (Ramp | undefined)[] = [];

  const draw = (keys: LegendKeys | null) => {
    ramps = [];
    const parts: HTMLElement[] = [];
    stamped = Boolean(keys?.field?.stamp);
    if (stamped) {
      parts.push(time);
    }
    if (keys?.field) {
      ramps[0] = ramp(doc, keys.field.label, "is-field");
      parts.push(ramps[0].el);
    }
    keys?.layers?.forEach((layer, i) => {
      const above = ramp(doc, layer.label, "is-overlay");
      ramps[i + 1] = above;
      parts.push(above.el);
    });
    if (keys?.swatches?.length) {
      const list = doc.createElement("ul");
      list.className = "zs-legend-swatches";
      for (const swatch of keys.swatches) {
        const li = doc.createElement("li");
        const chip = doc.createElement("span");
        chip.className = `zs-legend-chip is-${swatch.shape ?? "area"}`;
        chip.style.color = swatch.color;
        li.append(chip, swatch.label);
        list.append(li);
      }
      parts.push(list);
    }
    band.replaceChildren(...parts);
    band.hidden = parts.length === 0;
  };
  draw(null);

  const setSeries = (next: LegendSeries | null) => {
    series = stamped ? next : null;
    if (series) {
      readingLabel.textContent = series.label;
      readingValue.textContent = "";
      head.append(reading);
    } else {
      reading.remove();
    }
    lastDay = "";
    timeline.setSeries(series && { points: series.points, speak });
  };

  return {
    element: band,
    setKeys(keys) {
      const next = JSON.stringify(keys);
      if (next === shown) {
        return;
      }
      shown = next;
      lastDay = "";
      date.textContent = "";
      timeline.setBounds(null);
      setSeries(null);
      const step = keys?.field?.timeStep ?? "day";
      stamp = timeFormatter(options.locale, step);
      timeline.setStep(step);
      draw(keys);
    },
    setRange(index, scale, gradient) {
      const target = ramps[index];
      if (!target) {
        return;
      }
      if (gradient) {
        target.bar.style.background = gradient;
      }
      target.unit.textContent = scale.unit ? ` (${scale.unit})` : "";
      target.ticks.replaceChildren(
        ...rampTicks(scale, 3, options.locale).map((tick) => {
          const node = doc.createElement("span");
          node.style.left = `${tick.at * 100}%`;
          node.textContent = tick.label;
          return node;
        }),
      );
    },
    setBounds(bounds) {
      timeline.setBounds(stamped ? bounds : null);
    },
    setSeries,
    setTime(ms) {
      if (stamped) {
        timeline.setTime(ms);
      }
    },
    destroy() {
      timeline.destroy();
      band.remove();
    },
  };
}
