/**
 * Comparisons: the GODAS 5 m ocean temperature anomaly from June to
 * October, 2026 against past El Niño years. A swipe splits the view; a grid
 * morphs it into four cells, scrubbed by the progress slider.
 */
import { Projversor, type CompareConfig } from "../../src";

const map = document.getElementById("map")!;
const status = document.getElementById("status")!;
const date = document.getElementById("date")!;
const progress = document.getElementById("progress") as HTMLInputElement;
const play = document.getElementById("play") as HTMLButtonElement;
const projection = document.getElementById("projection") as HTMLButtonElement;
const layoutButtons = [
  ...document.querySelectorAll<HTMLButtonElement>("[data-layout]"),
];

const SWIPE: CompareConfig = {
  layout: "swipe",
  panels: [
    { yearOffset: 0, label: "2026" },
    { yearOffset: -11, label: "2015" },
  ],
  divider: 0.5,
};

const grid = (flat: boolean): CompareConfig => ({
  layout: "grid",
  panels: [
    { yearOffset: -29, label: "1997" },
    { yearOffset: -11, label: "2015" },
    { yearOffset: -3, label: "2023" },
    { yearOffset: 0, label: "2026" },
  ],
  gap: 2,
  ...(flat ? { preset: "plate", rotate: [150, 0, 0], zoom: 2.1 } : {}),
});

const pv = new Projversor(map, {
  preset: "globe",
  rotate: [140, -5, 0],
  zoom: 1.1,
});
pv.on("status", ({ text }) => (status.textContent = text));
pv.on("compare", ({ divider }) => {
  SWIPE.divider = divider;
});
const formatDate = new Intl.DateTimeFormat("en", {
  month: "long",
  timeZone: "UTC",
});
pv.on("frame", () => {
  date.textContent = Number.isFinite(pv.time) ? formatDate.format(pv.time) : "";
  const shown = pv.compare;
  if (shown && document.activeElement !== progress) {
    progress.value = String(shown.progress);
  }
});

let layout: "none" | "swipe" | "grid" = "none";
let flat = true;

function show(next: typeof layout): void {
  layout = next;
  layoutButtons.forEach((button) =>
    button.setAttribute("aria-pressed", String(button.dataset.layout === next)),
  );
  progress.disabled = next === "none";
  projection.disabled = next !== "grid";
  void pv.update({
    compare:
      next === "swipe" ? { ...SWIPE } : next === "grid" ? grid(flat) : null,
  });
}

layoutButtons.forEach((button) =>
  button.addEventListener("click", () =>
    show(button.dataset.layout as typeof layout),
  ),
);
progress.addEventListener("input", () =>
  pv.setCompareProgress(Number(progress.value)),
);
projection.addEventListener("click", () => {
  flat = !flat;
  projection.setAttribute("aria-pressed", String(flat));
  if (layout === "grid") {
    void pv.update({ compare: grid(flat), durationMs: 1200 });
  }
});
play.addEventListener("click", () => {
  const playing = !pv.playing;
  void pv.update({ playing });
  play.textContent = playing ? "Pause" : "Play";
});

async function main(): Promise<void> {
  await pv.init();
  await pv.add("anomaly", "scalar", {
    source: "godas-pottmp-anom",
    style: { palette: "viridis", raster: { colorDomain: [-1, 3] } },
    speed: 2,
    timeRange: { start: "2026-06-01", end: "2026-10-01" },
    time: Date.parse("2026-06-01"),
  });
  show("swipe");
  // The layer shows: a hook for tests.
  document.body.dataset.ready = "true";
}

main().catch((error: unknown) => {
  console.error(error);
  status.textContent = String(error);
});
