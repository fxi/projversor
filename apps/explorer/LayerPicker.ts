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
 * A searchable list of layers, inside a panel: type to filter, arrows to
 * move, Enter or a click to pick.
 */
export class LayerPicker {
  readonly el = document.createElement("div");
  private readonly input = document.createElement("input");
  private readonly list = document.createElement("ul");
  private items: PickItem[] = [];
  private shown: PickItem[] = [];
  private active = 0;
  private current = "";
  private readonly prefix = `pick${uid++}`;

  constructor(
    private readonly options: {
      label: string;
      placeholder: string;
      onPick: (id: string) => void;
    },
  ) {
    this.el.className = "pick";
    this.input.className = "pick-search";
    this.input.type = "search";
    this.input.placeholder = options.placeholder;
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.setAttribute("role", "combobox");
    this.input.setAttribute("aria-expanded", "true");
    this.input.setAttribute("aria-controls", `${this.prefix}-list`);
    this.input.setAttribute("aria-label", options.label);
    this.list.className = "pick-list";
    this.list.id = `${this.prefix}-list`;
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", options.label);
    this.el.append(this.input, this.list);

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
  }

  /** Replace the choices. */
  setItems(items: readonly PickItem[]): void {
    this.items = [...items];
    this.render();
  }

  get value(): string {
    return this.current;
  }

  set value(id: string) {
    this.current = id;
    this.render();
  }

  /** Label of the current choice. */
  get label(): string {
    return this.items.find((i) => i.id === this.current)?.label ?? "";
  }

  /** Clear the search, show the current choice, focus the search field. */
  reset(): void {
    this.input.value = "";
    this.render();
    this.input.focus({ preventScroll: true });
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
      empty.textContent = "No layer matches. Try another word.";
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
    // Scrolled within the list only: the stage around it must not move.
    const list = this.list;
    if (scroll && list.clientHeight) {
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      if (top < list.scrollTop) {
        list.scrollTop = top;
      } else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight;
      }
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
      case "Enter":
        if (this.shown[this.active]) {
          this.pick(this.shown[this.active]);
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private indexOf(target: EventTarget | null): number {
    const row = (target as Element | null)?.closest<HTMLElement>(".pick-item");
    return row ? Number(row.dataset.index) : -1;
  }

  private pick(item: PickItem): void {
    if (item.id !== this.current) {
      this.value = item.id;
      this.options.onPick(item.id);
    }
  }
}
