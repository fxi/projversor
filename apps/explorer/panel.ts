/**
 * Tool buttons over the map, each opening a panel beside it: one panel open
 * at a time, an arrow pointing at the button that opened it, Escape or a
 * click outside to close. Panels stay inside the stage, so they work on a
 * phone as on a desktop. Form atoms below build the panels' content.
 */

const SVG = "http://www.w3.org/2000/svg";

/** A round button's 24px stroked glyph, from path data. */
export function glyph(paths: string[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("class", "glyph");
  g.setAttribute("transform", "translate(12 12)");
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    g.append(path);
  }
  svg.append(g);
  return svg;
}

export interface ToolOptions {
  id: string;
  label: string;
  icon: SVGSVGElement;
  /** Called as the panel shows, to refresh its content. */
  onOpen?: () => void;
}

/** A tool button and its panel. */
export class Tool {
  readonly button = document.createElement("button");
  readonly panel = document.createElement("section");
  /** Content of the panel, under its title. */
  readonly body = document.createElement("div");
  private readonly arrow = document.createElement("span");

  constructor(
    private readonly bar: Toolbar,
    readonly options: ToolOptions,
  ) {
    const { id, label, icon } = options;
    const panelId = `tool-${id}`;
    this.button.type = "button";
    this.button.className = "round tool";
    this.button.dataset.tool = id;
    this.button.title = label;
    this.button.setAttribute("aria-label", label);
    this.button.setAttribute("aria-controls", panelId);
    this.button.setAttribute("aria-expanded", "false");
    this.button.append(icon);
    this.button.addEventListener("click", () => bar.toggle(this));

    this.panel.id = panelId;
    this.panel.className = "tool-panel";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", label);
    this.arrow.className = "tool-arrow";
    const title = document.createElement("h2");
    title.className = "tool-title";
    title.textContent = label;
    this.body.className = "tool-body";
    this.panel.append(this.arrow, title, this.body);
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  /** A disabled tool closes and cannot open, e.g. Vector on a scalar layer. */
  set disabled(disabled: boolean) {
    this.button.disabled = disabled;
    if (disabled && this.open) {
      this.bar.close();
    }
  }

  /** Beside its button, inside the stage; the arrow at the button's middle. */
  place(): void {
    if (!this.open) {
      return;
    }
    const stage = this.bar.stage.getBoundingClientRect();
    const button = this.button.getBoundingClientRect();
    const gap = 12;
    const left = button.right - stage.left + gap;
    const width = Math.min(300, stage.width - left - gap);
    this.panel.style.left = `${left}px`;
    this.panel.style.width = `${width}px`;
    this.panel.style.maxHeight = `${stage.height - 2 * gap}px`;
    const height = this.panel.offsetHeight;
    const middle = button.top + button.height / 2 - stage.top;
    const top = Math.min(
      Math.max(gap, middle - height / 2),
      stage.height - height - gap,
    );
    this.panel.style.top = `${top}px`;
    this.arrow.style.top = `${middle - top}px`;
  }
}

/** The tool buttons and the one open panel. */
export class Toolbar {
  readonly tools: Tool[] = [];
  private current: Tool | null = null;

  /**
   * @param root The button column, inside `stage`.
   * @param stage Panels are placed inside it.
   */
  constructor(
    readonly root: HTMLElement,
    readonly stage: HTMLElement,
  ) {
    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Element;
      const open = this.current;
      // Lists opened from the panel (native selects) live outside the page.
      if (
        open &&
        !open.panel.contains(target) &&
        !open.button.contains(target)
      ) {
        this.close();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.current) {
        const button = this.current.button;
        this.close();
        button.focus();
      }
    });
    window.addEventListener("resize", () => this.current?.place());
  }

  add(options: ToolOptions): Tool {
    const tool = new Tool(this, options);
    this.tools.push(tool);
    this.root.append(tool.button);
    this.stage.append(tool.panel);
    // Content that grows or shrinks (a section shown) keeps the panel in.
    new ResizeObserver(() => tool.place()).observe(tool.body);
    // Keys typed in a panel (Space in an input) stay out of playback.
    tool.panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        event.stopPropagation();
      }
    });
    return tool;
  }

  toggle(tool: Tool): void {
    if (tool.open) {
      this.close();
    } else {
      this.show(tool);
    }
  }

  show(tool: Tool): void {
    this.close();
    tool.panel.hidden = false;
    tool.options.onOpen?.();
    tool.button.setAttribute("aria-expanded", "true");
    this.current = tool;
    tool.place();
  }

  close(): void {
    const tool = this.current;
    if (!tool) {
      return;
    }
    tool.panel.hidden = true;
    tool.button.setAttribute("aria-expanded", "false");
    this.current = null;
  }
}

// ---- form atoms -----------------------------------------------------------

/** A group of controls under an optional heading. */
export function section(title?: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "tool-section";
  if (title) {
    const heading = document.createElement("h3");
    heading.textContent = title;
    el.append(heading);
  }
  return el;
}

export interface Range {
  el: HTMLElement;
  input: HTMLInputElement;
  value: number;
  disabled: boolean;
}

/** A labelled slider showing its value; `onInput` as it moves. */
export function range(options: {
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  onInput: (value: number) => void;
}): Range {
  const el = document.createElement("label");
  el.className = "tool-range";
  const name = document.createElement("span");
  name.textContent = options.label;
  const output = document.createElement("output");
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  const format = options.format ?? ((v: number) => String(v));
  const show = () => {
    output.textContent = format(Number(input.value));
    const p = (Number(input.value) - options.min) / (options.max - options.min);
    input.style.setProperty("--p", String(p));
  };
  input.addEventListener("input", () => {
    show();
    options.onInput(Number(input.value));
  });
  el.append(name, output, input);
  return {
    el,
    input,
    get value() {
      return Number(input.value);
    },
    set value(value: number) {
      input.value = String(value);
      show();
    },
    get disabled() {
      return input.disabled;
    },
    set disabled(disabled: boolean) {
      input.disabled = disabled;
      el.classList.toggle("disabled", disabled);
    },
  };
}

/** A labelled switch; `onChange` with its state. */
export function toggle(
  label: string,
  onChange: (checked: boolean) => void,
): { el: HTMLElement; input: HTMLInputElement } {
  const el = document.createElement("label");
  el.className = "tool-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.addEventListener("change", () => onChange(input.checked));
  const text = document.createElement("span");
  text.textContent = label;
  el.append(text, input);
  return { el, input };
}

/** A text button, quiet until hovered. */
export function textButton(
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tool-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Copy `text`, then confirm on `button` for a moment. Falls back to
 * selecting it where the clipboard is unavailable (insecure contexts).
 */
export function copy(
  text: string,
  button: HTMLButtonElement,
  fallback: () => void,
): void {
  const label = button.textContent;
  Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(() => {
      button.textContent = "Copied";
      button.classList.add("done");
      window.setTimeout(() => {
        button.textContent = label;
        button.classList.remove("done");
      }, 1500);
    }, fallback);
}
