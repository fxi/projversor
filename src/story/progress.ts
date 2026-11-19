/**
 * Chapter progress: one thin vertical line, the current step number above
 * it and the count below. The fill follows the scroll continuously; ticks
 * mark the step boundaries. On the first step, before any scroll, a short
 * segment runs down the empty line: the scroll invitation. Buttons at both
 * ends step one scene back or on, or jump to the first or the last scene.
 * Keyboard and screen-reader users also get one (visually hidden) button
 * per chapter.
 */

const EASE = "cubic-bezier(.16,1,.3,1)";
const NAME_MS = 2400;

const pad = (n: number) => String(n).padStart(2, "0");

const SVG = "http://www.w3.org/2000/svg";

/** Names of the buttons at the ends of the line. */
export type StepLabels = Record<"first" | "previous" | "next" | "last", string>;

/** Target scene of a step button, clamped to the scenes. */
export function stepTarget(
  key: keyof StepLabels,
  active: number,
  count: number,
): number {
  const last = count - 1;
  const at = Math.max(0, active);
  const target =
    key === "first"
      ? 0
      : key === "last"
        ? last
        : at + (key === "next" ? 1 : -1);
  return Math.min(last, Math.max(0, target));
}

/** Keys of the step buttons, as `aria-keyshortcuts` and their tooltips. */
const STEP_KEYS: Partial<Record<keyof StepLabels, [string, string]>> = {
  previous: ["ArrowLeft", "←"],
  next: ["ArrowRight", "→"],
};

/**
 * Scene a key goes to, or null: ← and → one scene back or on, a digit the
 * scene of that number (0 the opening one).
 */
export function keyTarget(
  key: string,
  active: number,
  count: number,
  /** Display numbers by step (null: prelude): a digit opens that number. */
  numbers?: readonly (number | null)[],
): number | null {
  if (key === "ArrowLeft" || key === "ArrowRight") {
    return stepTarget(key === "ArrowLeft" ? "previous" : "next", active, count);
  }
  if (/^[0-9]$/.test(key)) {
    const digit = Number(key);
    if (numbers && digit > 0) {
      const target = numbers.indexOf(digit);
      return target >= 0 ? target : null;
    }
    return digit < count ? digit : null;
  }
  return null;
}

/** Whether a key press belongs to a control rather than the page. */
function ownedByControl(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(
    event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      target?.isContentEditable ||
      target?.closest?.(
        'input, textarea, select, [role="slider"], [role="textbox"]',
      ),
  );
}

/** A chevron pointing up or down, with a bar on its tip for the ends. */
function chevron(doc: Document, up: boolean, bar: boolean): SVGSVGElement {
  const svg = doc.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  const path = doc.createElementNS(SVG, "path");
  const d = up
    ? `M3 ${bar ? 14 : 13} L10 ${bar ? 7 : 6} L17 ${bar ? 14 : 13}${bar ? " M3 3 H17" : ""}`
    : `M3 ${bar ? 6 : 7} L10 ${bar ? 13 : 14} L17 ${bar ? 6 : 7}${bar ? " M3 17 H17" : ""}`;
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

export interface ProgressOptions {
  names: readonly string[];
  /**
   * Display number of each step, null for a prelude scene (from
   * `sceneNumbers`). Defaults to the old rule: the first step unnumbered.
   */
  numbers?: readonly (number | null)[];
  /** Name of the chapter list, for assistive technology. */
  label: string;
  /** The scroll invitation beside the empty line. */
  scrollLabel: string;
  stepLabels: StepLabels;
  steps: readonly HTMLElement[];
  /** Fraction of the viewport height where a step becomes active. */
  line: number;
  reduced: boolean;
}

export interface Progress {
  element: HTMLElement;
  /** `quiet`: no number roll, no name flash (the story was edited in place). */
  setActive(index: number, quiet?: boolean): void;
  destroy(): void;
}

/**
 * How far a step has run past the activation line, 0–1: 0 as its top
 * crosses the line, 1 once `span` of its height has.
 */
export function stepProgress(
  top: number,
  height: number,
  viewport: number,
  line: number,
  span = 0.5,
): number {
  const run = Math.max(1, height * span);
  return Math.min(1, Math.max(0, (viewport * line - top) / run));
}

/** Scroll position as a fraction of the steps' extent, at the activation line. */
export function progressAt(
  scrollY: number,
  viewport: number,
  line: number,
  first: number,
  last: number,
): number {
  if (last <= first) {
    return 0;
  }
  const at = scrollY + viewport * line;
  return Math.min(1, Math.max(0, (at - first) / (last - first)));
}

export function mountProgress(
  doc: Document,
  options: ProgressOptions,
): Progress {
  const win = doc.defaultView!;
  const { names, steps, line, reduced, label, scrollLabel, stepLabels } =
    options;
  const behavior: ScrollBehavior = reduced ? "auto" : "smooth";
  const numbers = options.numbers ?? names.map((_, i) => (i > 0 ? i : null));
  const count = Math.max(0, ...numbers.map((n) => n ?? 0));
  const numberOf = (i: number) => numbers[i] ?? null;

  const nav = doc.createElement("nav");
  nav.className = "zs-progress";
  nav.setAttribute("aria-label", label);

  const now = doc.createElement("p");
  now.className = "zs-progress-now";
  now.setAttribute("aria-hidden", "true");
  const number = doc.createElement("span");
  number.className = "zs-progress-n";
  const name = doc.createElement("span");
  name.className = "zs-progress-name";
  now.append(number, name);

  const track = doc.createElement("div");
  track.className = "zs-progress-track";
  track.setAttribute("aria-hidden", "true");
  const fill = doc.createElement("span");
  fill.className = "zs-progress-fill";
  const nudge = doc.createElement("span");
  nudge.className = "zs-progress-nudge";
  const ticks = steps.slice(1).map(() => {
    const tick = doc.createElement("span");
    tick.className = "zs-progress-tick";
    track.append(tick);
    return tick;
  });
  track.prepend(fill, nudge);

  const total = doc.createElement("p");
  total.className = "zs-progress-total";
  total.setAttribute("aria-hidden", "true");
  total.textContent = pad(count);

  // The cue runs beside the top of the line, inside the track.
  const cue = doc.createElement("p");
  cue.className = "zs-progress-cue";
  cue.setAttribute("aria-hidden", "true");
  cue.textContent = scrollLabel;

  // Accessible chapter list: visually hidden, shown in the name on focus.
  const list = doc.createElement("ol");
  list.className = "zs-progress-list";
  const jump = (i: number, how: ScrollBehavior = behavior) =>
    steps[i]?.scrollIntoView({ behavior: how, block: "center" });
  names.forEach((label, i) => {
    const li = doc.createElement("li");
    const button = doc.createElement("button");
    button.type = "button";
    const n = numberOf(i);
    button.textContent = n !== null ? `${pad(n)} ${label}` : label;
    // The digit that opens this step: its number, or 0 for the first step.
    const shortcut = n !== null ? n : i === 0 ? 0 : null;
    if (shortcut !== null && shortcut <= 9) {
      button.setAttribute("aria-keyshortcuts", String(shortcut));
    }
    button.addEventListener("click", () => jump(i));
    button.addEventListener("focus", () => flash(i));
    li.append(button);
    list.append(li);
  });

  track.append(cue);

  // One scene back or on, smoothly; the ends at once, without running the
  // sphere through every scene between.
  const stepButtons = (["first", "previous", "next", "last"] as const).map(
    (key) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = `zs-progress-step is-${key}`;
      button.setAttribute("aria-label", stepLabels[key]);
      const shortcut = STEP_KEYS[key];
      button.title = shortcut
        ? `${stepLabels[key]} (${shortcut[1]})`
        : stepLabels[key];
      if (shortcut) {
        button.setAttribute("aria-keyshortcuts", shortcut[0]);
      }
      const up = key === "first" || key === "previous";
      button.append(chevron(doc, up, key === "first" || key === "last"));
      button.addEventListener("click", () => {
        if (button.getAttribute("aria-disabled") === "true") {
          return;
        }
        const target = stepTarget(key, active, steps.length);
        jump(target, key === "previous" || key === "next" ? behavior : "auto");
      });
      return { button, up };
    },
  );
  const syncButtons = () =>
    stepButtons.forEach(({ button, up }) =>
      button.setAttribute(
        "aria-disabled",
        String(up ? active <= 0 : active >= steps.length - 1),
      ),
    );
  const ends = stepButtons.map((b) => b.button);

  nav.append(...ends.slice(0, 2), now, track, total, ...ends.slice(2), list);

  // Extent of the steps, in document px, and the tick positions in it.
  let first = 0;
  let last = 1;
  let starts: number[] = [];
  const measure = () => {
    const top = (el: HTMLElement) =>
      el.getBoundingClientRect().top + win.scrollY;
    starts = steps.map(top);
    first = starts[0];
    const end = steps[steps.length - 1];
    last = top(end) + end.offsetHeight - win.innerHeight * (1 - line);
    // A step activates when the line reaches its top: its tick sits where
    // the fill is at that moment.
    ticks.forEach((tick, i) => {
      const f = (starts[i + 1] - first) / Math.max(1, last - first);
      tick.style.top = `${Math.min(1, Math.max(0, f)) * 100}%`;
    });
  };

  let frame = 0;
  const update = () => {
    frame = 0;
    const p = progressAt(win.scrollY, win.innerHeight, line, first, last);
    fill.style.transform = `scaleY(${p})`;
    nav.classList.toggle("is-nudging", win.scrollY < 24 && !reduced);
  };
  const onScroll = () => {
    if (!frame) {
      frame = win.requestAnimationFrame(update);
    }
  };
  win.addEventListener("scroll", onScroll, { passive: true });
  const resize = new ResizeObserver(() => {
    measure();
    update();
  });
  resize.observe(doc.documentElement);

  // A click on the line jumps to the step whose span holds that point.
  track.addEventListener("click", (event) => {
    const box = track.getBoundingClientRect();
    const f = (event.clientY - box.top) / box.height;
    const at = first + f * (last - first);
    let target = 0;
    starts.forEach((start, i) => {
      if (start <= at) {
        target = i;
      }
    });
    jump(target);
  });

  let nameTimer = 0;
  const flash = (i: number) => {
    win.clearTimeout(nameTimer);
    name.textContent = numberOf(i) !== null ? names[i] : "";
    nav.classList.add("is-named");
    nameTimer = win.setTimeout(() => nav.classList.remove("is-named"), NAME_MS);
  };

  // Keys, while the story is on screen: ← → one scene back or on, smoothly;
  // a digit to its scene, at once when that skips scenes. Keys a control
  // handles, or typed in a field, stay theirs.
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || ownedByControl(event)) {
      return;
    }
    const top = steps[0]?.getBoundingClientRect().top ?? 0;
    const bottom = steps[steps.length - 1]?.getBoundingClientRect().bottom ?? 0;
    if (top >= win.innerHeight || bottom <= 0) {
      return;
    }
    const target = keyTarget(event.key, active, steps.length, numbers);
    if (target === null) {
      return;
    }
    event.preventDefault();
    if (target !== Math.max(0, active)) {
      jump(target, Math.abs(target - active) > 1 ? "auto" : behavior);
    }
  };
  doc.addEventListener("keydown", onKey);

  let active = -1;
  syncButtons();
  return {
    element: nav,
    setActive(index, quiet = false) {
      if (index === active) {
        return;
      }
      const down = index > active;
      active = index;
      syncButtons();
      const n = numberOf(index);
      number.textContent = n !== null ? pad(n) : "";
      // A prelude step: the number gives way to the scroll invitation.
      nav.classList.toggle("is-first", n === null);
      if (quiet) {
        return;
      }
      if (!reduced && n !== null) {
        number.animate(
          [
            { opacity: 0, transform: `translateY(${down ? 60 : -60}%)` },
            { opacity: 1, transform: "none" },
          ],
          { duration: 600, easing: EASE },
        );
      }
      if (n !== null) {
        flash(index);
      }
    },
    destroy() {
      doc.removeEventListener("keydown", onKey);
      win.removeEventListener("scroll", onScroll);
      win.cancelAnimationFrame(frame);
      win.clearTimeout(nameTimer);
      resize.disconnect();
      nav.remove();
    },
  };
}
