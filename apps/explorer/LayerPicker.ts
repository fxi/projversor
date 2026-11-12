/** One choice of a picker. */
export interface PickItem {
  id: string;
  label: string;
  /** Muted second line: provider, or what the choice does. */
  detail?: string;
  /** Heading the item lists under; groups keep the order items come in. */
  group: string;
  /** Lowercased text the search matches, beyond the label. */
  search?: string;
}

/** How well `item` matches every term: 0 when one is missing. */
function score(item: PickItem, terms: readonly string[]): number {
  const label = item.label.toLowerCase();
  const text = `${label} ${item.id.toLowerCase()} ${item.search ?? ""}`;
  let total = 0;
  for (const term of terms) {
    if (!text.includes(term)) {
      return 0;
    }
    total += label.startsWith(term) ? 20 : label.includes(term) ? 10 : 1;
  }
  return total;
}

let uid = 0;

/**
 * A chip in the layer bar that opens a searchable list above it: type to
 * filter, arrows to move, Enter to pick, Escape or a click outside to close.
 */
export class LayerPicker {
  private readonly popover = document.createElement("div");
  private readonly input = document.createElement("input");
  private readonly list = document.createElement("ul");
  private readonly text: HTMLElement;
  private items: PickItem[] = [];
  private shown: PickItem[] = [];
  private active = 0;
  private current = "";
  private readonly prefix = `pick${uid++}`;

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly options: {
      placeholder: string;
      onPick: (id: string) => void;
    },
  ) {
    this.text = button.querySelector<HTMLElement>(".chip-text") ?? button;
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");

    this.popover.className = "pick";
    this.popover.hidden = true;
    this.input.className = "pick-search";
    this.input.type = "search";
    this.input.placeholder = options.placeholder;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-expanded", "true");
    this.input.setAttribute("aria-controls", `${this.prefix}-list`);
    this.input.setAttribute("aria-label", button.getAttribute("aria-label")!);
    this.list.className = "pick-list";
    this.list.id = `${this.prefix}-list`;
    this.list.setAttribute("role", "listbox");
    this.popover.append(this.input, this.list);
    document.body.append(this.popover);

    button.addEventListener("click", () =>
      this.popover.hidden ? this.open() : this.close(),
    );
    this.input.addEventListener("input", () => this.render());
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    this.list.addEventListener("pointermove", (event) => {
      const index = this.indexOf(event.target);
      if (index >= 0 && index !== this.active) {
        this.setActive(index, false);
      }
    });
    this.list.addEventListener("click", (event) => {
      const index = this.indexOf(event.target);
      if (index >= 0) {
        this.pick(this.shown[index]);
      }
    });
    document.addEventListener("pointerdown", (event) => {
      const target = event.target as Node;
      if (
        !this.popover.hidden &&
        !this.popover.contains(target) &&
        !this.button.contains(target)
      ) {
        this.close();
      }
    });
    window.addEventListener("resize", () => this.place());
  }

  /** Replace the choices; the current one keeps its label if still there. */
  setItems(items: readonly PickItem[]): void {
    this.items = [...items];
    this.value = this.current;
    if (!this.popover.hidden) {
      this.render();
    }
  }

  get value(): string {
    return this.current;
  }

  set value(id: string) {
    this.current = id;
    const item = this.items.find((i) => i.id === id);
    this.text.textContent = item?.label ?? "";
    this.button.title = item?.detail
      ? `${item.label} · ${item.detail}`
      : (item?.label ?? "");
  }

  open(): void {
    this.input.value = "";
    this.popover.hidden = false;
    this.button.setAttribute("aria-expanded", "true");
    this.render();
    this.place();
    this.input.focus();
  }

  close(refocus = false): void {
    if (this.popover.hidden) {
      return;
    }
    this.popover.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    if (refocus) {
      this.button.focus();
    }
  }

  /** Above the chip, inside the window. */
  private place(): void {
    if (this.popover.hidden) {
      return;
    }
    const chip = this.button.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(420, window.innerWidth - 2 * margin);
    const left = Math.min(
      Math.max(margin, chip.left),
      window.innerWidth - width - margin,
    );
    this.popover.style.left = `${left}px`;
    this.popover.style.width = `${width}px`;
    this.popover.style.bottom = `${window.innerHeight - chip.top + margin}px`;
    this.popover.style.maxHeight = `${Math.max(160, chip.top - 2 * margin)}px`;
  }

  private render(): void {
    const terms = this.input.value.trim().toLowerCase().split(/\s+/);
    const query = terms.filter(Boolean);
    const scored = this.items
      .map((item, index) => ({ item, index, score: score(item, query) }))
      .filter((s) => !query.length || s.score > 0);
    // Groups in the order they come; best matches first within each.
    const groups = [...new Set(this.items.map((i) => i.group))];
    this.shown = groups.flatMap((group) =>
      scored
        .filter((s) => s.item.group === group)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map((s) => s.item),
    );
    const rows: HTMLElement[] = [];
    let group: string | undefined;
    this.shown.forEach((item, index) => {
      if (item.group !== group) {
        group = item.group;
        const heading = document.createElement("li");
        heading.className = "pick-group";
        heading.setAttribute("role", "presentation");
        heading.textContent = group;
        rows.push(heading);
      }
      const row = document.createElement("li");
      row.id = `${this.prefix}-${index}`;
      row.className = "pick-item";
      row.dataset.index = String(index);
      row.setAttribute("role", "option");
      row.setAttribute("aria-selected", String(item.id === this.current));
      const label = document.createElement("span");
      label.className = "pick-label";
      label.textContent = item.label;
      row.append(label);
      if (item.detail) {
        const detail = document.createElement("span");
        detail.className = "pick-detail";
        detail.textContent = item.detail;
        row.append(detail);
      }
      rows.push(row);
    });
    if (!rows.length) {
      const empty = document.createElement("li");
      empty.className = "pick-empty";
      empty.textContent = "No match";
      rows.push(empty);
    }
    this.list.replaceChildren(...rows);
    const selected = this.shown.findIndex((i) => i.id === this.current);
    this.setActive(query.length || selected < 0 ? 0 : selected, true);
  }

  private setActive(index: number, scroll: boolean): void {
    this.list.querySelector(".pick-item.active")?.classList.remove("active");
    this.active = index;
    const row = this.list.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!row) {
      this.input.removeAttribute("aria-activedescendant");
      return;
    }
    row.classList.add("active");
    this.input.setAttribute("aria-activedescendant", row.id);
    if (scroll) {
      row.scrollIntoView({ block: "nearest" });
    }
  }

  private onKey(event: KeyboardEvent): void {
    const last = this.shown.length - 1;
    switch (event.key) {
      case "ArrowDown":
        this.setActive(Math.min(last, this.active + 1), true);
        break;
      case "ArrowUp":
        this.setActive(Math.max(0, this.active - 1), true);
        break;
      case "Home":
        this.setActive(0, true);
        break;
      case "End":
        this.setActive(Math.max(0, last), true);
        break;
      case "Enter":
        if (this.shown[this.active]) {
          this.pick(this.shown[this.active]);
        }
        break;
      case "Escape":
        this.close(true);
        break;
      case "Tab":
        this.close();
        return;
      default:
        return;
    }
    event.preventDefault();
    // Keep Space and arrows from reaching the page's playback keys.
    event.stopPropagation();
  }

  private indexOf(target: EventTarget | null): number {
    const row = (target as Element | null)?.closest<HTMLElement>(".pick-item");
    return row ? Number(row.dataset.index) : -1;
  }

  private pick(item: PickItem): void {
    this.close(true);
    if (item.id !== this.current) {
      this.value = item.id;
      this.options.onPick(item.id);
    }
  }
}
