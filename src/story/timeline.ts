/**
 * The playback timeline: a thin track over the view's time window, a tick
 * at each month or year start, and one thumb on the playhead. Dragging holds
 * playback and seeks, one seek at a time to the latest target while the map
 * catches up; letting go resumes it once the last seek has landed. A slider
 * for the keyboard: arrows by day or year, PageUp/PageDown by month or decade,
 * Home/End to the bounds; playback resumes a moment after the last key.
 */

const DAY = 86_400_000;
/** Playback resumes this long after the last key. */
const KEY_HOLD_MS = 1200;

export type Bounds = readonly [number, number];
export type TimeStep = "day" | "year";

/** Date formatter shared by the visible stamp and the slider's spoken value. */
export function timeFormatter(locale: string, step: TimeStep, spoken = false) {
  return new Intl.DateTimeFormat(locale, {
    ...(step === "day"
      ? {
          day: "numeric" as const,
          month: spoken ? ("long" as const) : ("short" as const),
        }
      : {}),
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Position (0–1) of a time in the window, clamped. */
export function fractionAt(ms: number, [start, end]: Bounds): number {
  if (!(end > start)) {
    return 0;
  }
  return Math.min(1, Math.max(0, (ms - start) / (end - start)));
}

/** Time at a position (0–1) in the window, clamped. */
export function timeAt(fraction: number, [start, end]: Bounds): number {
  return start + Math.min(1, Math.max(0, fraction)) * (end - start);
}

/** Positions of the month starts strictly inside the window, UTC. */
export function monthTicks(bounds: Bounds): number[] {
  const [start, end] = bounds;
  const ticks: number[] = [];
  const at = new Date(start);
  let month = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1);
  while (month < end) {
    ticks.push(fractionAt(month, bounds));
    const next = new Date(month);
    month = Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
  }
  return ticks;
}

/** Positions of year starts strictly inside the window, UTC. */
export function yearTicks(bounds: Bounds): number[] {
  const [start, end] = bounds;
  const ticks: number[] = [];
  let year = new Date(start).getUTCFullYear() + 1;
  while (Date.UTC(year, 0, 1) < end) {
    ticks.push(fractionAt(Date.UTC(year++, 0, 1), bounds));
  }
  return ticks;
}

/** Beyond this window, a day timeline ticks years: months would crowd it. */
const MONTH_TICKS_MAX_MS = 2 * 365.25 * DAY;

/** Tick positions of a window: years at the year step or over two years. */
export function windowTicks(bounds: Bounds, step: TimeStep): number[] {
  return step === "year" || bounds[1] - bounds[0] > MONTH_TICKS_MAX_MS
    ? yearTicks(bounds)
    : monthTicks(bounds);
}

/** A daily value drawn on the track: `time` in epoch ms. */
export interface SeriesPoint {
  time: number;
  value: number;
}

/** Width and height of the series' drawing, stretched over the track. */
const SERIES_BOX = [1000, 100] as const;

/**
 * The series inside the window as SVG paths over {@link SERIES_BOX}: x by
 * {@link fractionAt}, like the thumb, y from the lowest value (bottom) to
 * the highest (top) in the window. Null when fewer than two points fall in.
 */
export function seriesPaths(
  points: readonly SeriesPoint[],
  bounds: Bounds,
): { line: string; area: string; low: number; high: number } | null {
  const inside = points.filter(
    (p) => p.time >= bounds[0] && p.time <= bounds[1],
  );
  if (inside.length < 2) {
    return null;
  }
  let low = Infinity;
  let high = -Infinity;
  for (const p of inside) {
    low = Math.min(low, p.value);
    high = Math.max(high, p.value);
  }
  const [w, h] = SERIES_BOX;
  const span = high - low || 1;
  const xy = inside.map((p) => [
    +(fractionAt(p.time, bounds) * w).toFixed(2),
    +(h - ((p.value - low) / span) * h).toFixed(2),
  ]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
  const area = `${line}L${xy[xy.length - 1][0]},${h}L${xy[0][0]},${h}Z`;
  return { line, area, low, high };
}

/** The value at a time, linear between the points around it; null outside. */
export function seriesValue(
  points: readonly SeriesPoint[],
  ms: number,
): number | null {
  if (points.length === 0 || ms < points[0].time) {
    return null;
  }
  let lo = 0;
  let hi = points.length - 1;
  if (ms > points[hi].time) {
    return null;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= ms) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = points[lo];
  const b = points[hi];
  if (b.time === a.time) {
    return a.value;
  }
  return a.value + ((b.value - a.value) * (ms - a.time)) / (b.time - a.time);
}

/** Shift by calendar years, clamping leap day to February's last day. */
export function shiftYear(ms: number, by: number): number {
  const d = new Date(ms);
  const year = d.getUTCFullYear() + by;
  const month = d.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year,
    month,
    Math.min(d.getUTCDate(), last),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

/** The same day of the month before or after, UTC. */
function shiftMonth(ms: number, by: number): number {
  const d = new Date(ms);
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() + by,
    d.getUTCDate(),
    d.getUTCHours(),
  );
}

export interface TimelineOptions {
  /** Page language, for the date read out. */
  locale: string;
  /** Name of the slider, in the page language. */
  label: string;
  /** Move the playhead; settles once the month holding `ms` shows. */
  onSeek(ms: number): Promise<void>;
  /** True while the reader drags or types, and until the seek lands. */
  onHold(held: boolean): void;
  /** The time the thumb shows: the target while held, else the playhead. */
  onShow?(ms: number): void;
}

/** A series drawn on the track, with how to say its value. */
export interface TimelineSeries {
  points: readonly SeriesPoint[];
  /** Its value at the thumb, for the slider's spoken text. */
  speak(value: number): string;
}

export interface Timeline {
  element: HTMLElement;
  setStep(step: TimeStep): void;
  setBounds(bounds: Bounds | null): void;
  /** A line over the track, on the window's time axis; null removes it. */
  setSeries(series: TimelineSeries | null): void;
  setTime(ms: number): void;
  destroy(): void;
}

export function mountTimeline(
  doc: Document,
  options: TimelineOptions,
): Timeline {
  const win = doc.defaultView!;
  const el = doc.createElement("div");
  el.className = "zs-timeline";
  el.tabIndex = 0;
  el.setAttribute("role", "slider");
  el.setAttribute("aria-label", options.label);
  let step: TimeStep = "day";
  let spoken = timeFormatter(options.locale, step, true);
  const ticks = doc.createElement("div");
  ticks.className = "zs-timeline-ticks";
  const thumb = doc.createElement("span");
  thumb.className = "zs-timeline-thumb";
  el.append(ticks, thumb);

  // The series: an area and a line behind the ticks, a dot on the thumb.
  const NS = "http://www.w3.org/2000/svg";
  const chart = doc.createElementNS(NS, "svg");
  chart.setAttribute("class", "zs-timeline-series");
  chart.setAttribute("viewBox", `0 0 ${SERIES_BOX[0]} ${SERIES_BOX[1]}`);
  chart.setAttribute("preserveAspectRatio", "none");
  chart.setAttribute("aria-hidden", "true");
  const area = doc.createElementNS(NS, "path");
  area.setAttribute("class", "zs-timeline-area");
  const trace = doc.createElementNS(NS, "path");
  trace.setAttribute("class", "zs-timeline-line");
  chart.append(area, trace);
  const dot = doc.createElement("span");
  dot.className = "zs-timeline-dot";
  let series: TimelineSeries | null = null;
  let range: { low: number; high: number } | null = null;

  let bounds: Bounds | null = null;
  let time = 0;
  let shown = -1;
  let dragging = false;

  const valueAt = (ms: number) =>
    series && range ? seriesValue(series.points, ms) : null;
  const placeDot = (ms: number, x: number) => {
    const value = valueAt(ms);
    dot.hidden = value === null;
    if (value !== null && range) {
      // Same box as the chart's: see .zs-timeline-series in site.css.
      const y = 1 - (value - range.low) / (range.high - range.low || 1);
      dot.style.top = `calc(var(--zs-series-top) + ${y.toFixed(4)} * var(--zs-series-h))`;
      dot.style.transform = `translateX(${x}px)`;
    }
  };
  const drawSeries = () => {
    const paths = series && bounds ? seriesPaths(series.points, bounds) : null;
    range = paths && { low: paths.low, high: paths.high };
    el.classList.toggle("has-series", Boolean(paths));
    if (paths) {
      area.setAttribute("d", paths.area);
      trace.setAttribute("d", paths.line);
      el.prepend(chart);
      el.append(dot);
    } else {
      chart.remove();
      dot.remove();
    }
  };

  const place = (ms: number) => {
    time = ms;
    options.onShow?.(ms);
    if (!bounds) {
      return;
    }
    // Moves the thumb only when it moves by a pixel.
    const x = Math.round(fractionAt(ms, bounds) * el.clientWidth);
    if (x !== shown) {
      shown = x;
      thumb.style.transform = `translateX(${x}px)`;
      if (range) {
        placeDot(ms, x);
      }
    }
    const value = valueAt(ms);
    const day = spoken.format(new Date(ms));
    el.setAttribute("aria-valuenow", String(Math.round(ms)));
    el.setAttribute(
      "aria-valuetext",
      value === null || !series ? day : `${day}, ${series.speak(value)}`,
    );
  };

  // Playback holds while the reader drags or types, and until the last
  // seek has landed: resumed earlier, the clock would run on from the old
  // date while the new month loads, and the thumb would jump back.
  let keying = false;
  let inFlight = false;
  let pending: number | null = null;
  let held = false;
  const busy = () => dragging || keying || inFlight || pending !== null;
  const syncHold = () => {
    if (busy() !== held) {
      held = !held;
      options.onHold(held);
    }
  };

  // One seek at a time, the latest target wins: a seek into another month
  // decodes it, and seeks piling up would exhaust the video decoders.
  const pump = () => {
    if (inFlight || pending === null) {
      syncHold();
      return;
    }
    const target = pending;
    pending = null;
    inFlight = true;
    options
      .onSeek(target)
      .catch(() => {})
      .finally(() => {
        inFlight = false;
        pump();
      });
  };
  const seek = (ms: number) => {
    place(ms);
    pending = ms;
    syncHold();
    pump();
  };
  const pointerTime = (event: PointerEvent) => {
    const box = el.getBoundingClientRect();
    return timeAt((event.clientX - box.left) / box.width, bounds!);
  };

  el.addEventListener("pointerdown", (event) => {
    if (!bounds || event.button !== 0) {
      return;
    }
    dragging = true;
    el.setPointerCapture(event.pointerId);
    el.classList.add("is-dragging");
    seek(pointerTime(event));
  });
  el.addEventListener("pointermove", (event) => {
    if (dragging) {
      seek(pointerTime(event));
    }
  });
  const release = () => {
    if (!dragging) {
      return;
    }
    dragging = false;
    el.classList.remove("is-dragging");
    syncHold();
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointercancel", release);

  // Keys hold playback like a drag, and let go a moment after the last one,
  // so the chosen date can be read before it plays on.
  let keyHold = 0;
  el.addEventListener("keydown", (event) => {
    if (!bounds) {
      return;
    }
    // The window's last day, not its last instant: from there playback
    // would loop to the start at once.
    const last =
      step === "year" ? bounds[1] : Math.max(bounds[0], bounds[1] - DAY);
    const moves: Record<string, () => number> = {
      ArrowLeft: () => (step === "year" ? shiftYear(time, -1) : time - DAY),
      ArrowDown: () => (step === "year" ? shiftYear(time, -1) : time - DAY),
      ArrowRight: () => (step === "year" ? shiftYear(time, 1) : time + DAY),
      ArrowUp: () => (step === "year" ? shiftYear(time, 1) : time + DAY),
      PageDown: () =>
        step === "year" ? shiftYear(time, -10) : shiftMonth(time, -1),
      PageUp: () =>
        step === "year" ? shiftYear(time, 10) : shiftMonth(time, 1),
      Home: () => bounds![0],
      End: () => last,
    };
    const move = moves[event.key];
    if (!move) {
      return;
    }
    event.preventDefault();
    keying = true;
    win.clearTimeout(keyHold);
    keyHold = win.setTimeout(() => {
      keying = false;
      syncHold();
    }, KEY_HOLD_MS);
    seek(Math.min(last, Math.max(bounds[0], move())));
  });

  // The thumb's pixel depends on the track width.
  const resize = new ResizeObserver(() => {
    shown = -1;
    place(time);
  });
  resize.observe(el);

  const drawTicks = () => {
    ticks.replaceChildren(
      ...(bounds ? windowTicks(bounds, step) : []).map((at) => {
        const tick = doc.createElement("span");
        tick.style.left = `${at * 100}%`;
        return tick;
      }),
    );
  };

  return {
    element: el,
    setStep(next) {
      step = next;
      spoken = timeFormatter(options.locale, step, true);
      drawTicks();
      place(time);
    },
    setBounds(next) {
      bounds = next;
      el.classList.toggle("is-empty", !next);
      drawTicks();
      if (next) {
        el.setAttribute("aria-valuemin", String(next[0]));
        el.setAttribute("aria-valuemax", String(next[1]));
      }
      drawSeries();
      shown = -1;
      place(time);
    },
    setSeries(next) {
      series = next;
      drawSeries();
      shown = -1;
      place(time);
    },
    setTime(ms) {
      // While held, the thumb shows the target, not the clock catching up.
      if (!busy()) {
        place(ms);
      }
    },
    destroy() {
      resize.disconnect();
      win.clearTimeout(keyHold);
    },
  };
}
