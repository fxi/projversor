import { describe, expect, it } from "vitest";
import {
  comparePanels,
  focusPanel,
  gridRects,
  gridShape,
  parseCompare,
  shiftYears,
  type CompareConfig,
} from "./compare";
import { PROJECTIONS, fitScale } from "./projections";
import { viewArea, type View } from "./view";

const ortho = PROJECTIONS.orthographic;
const view: View = {
  blend: { a: ortho, b: ortho, ka: 400, kb: 400, t: 0 },
  rotate: [150, 0, 0],
  zoom: 1.2,
  width: 1000,
  height: 800,
  inset: { top: 100, right: 0, bottom: 0, left: 200 },
};

const grid: CompareConfig = {
  layout: "grid",
  panels: [
    { yearOffset: -29, label: "1997" },
    { yearOffset: -11, label: "2015" },
    { yearOffset: -3, label: "2023" },
    { yearOffset: 0, label: "2026" },
  ],
  gap: 0,
  preset: "plate",
  zoom: 2,
};

describe("shiftYears", () => {
  it("keeps the month, day and time", () => {
    const ms = Date.UTC(2026, 6, 15, 12);
    expect(new Date(shiftYears(ms, -11)).toISOString()).toBe(
      "2015-07-15T12:00:00.000Z",
    );
    expect(shiftYears(ms, 0)).toBe(ms);
  });
});

describe("gridShape and gridRects", () => {
  it("is as square as the panels allow, unless given", () => {
    expect(gridShape(4, {})).toEqual({ cols: 2, rows: 2 });
    expect(gridShape(5, {})).toEqual({ cols: 3, rows: 2 });
    expect(gridShape(4, { cols: 4 })).toEqual({ cols: 4, rows: 1 });
  });

  it("splits the area into cells row by row, with gaps", () => {
    const rects = gridRects(
      { x: 10, y: 20, width: 210, height: 100 },
      2,
      1,
      10,
    );
    expect(rects).toEqual([
      { x: 10, y: 20, width: 100, height: 100 },
      { x: 120, y: 20, width: 100, height: 100 },
    ]);
  });
});

describe("focusPanel", () => {
  it("is the given one, else the current year, else the first", () => {
    expect(focusPanel(grid)).toBe(3);
    expect(focusPanel({ ...grid, focus: 1 })).toBe(1);
    expect(focusPanel({ ...grid, panels: grid.panels.slice(0, 2) })).toBe(0);
  });
});

describe("comparePanels", () => {
  const area = { x: 200, y: 100, width: 800, height: 700 };

  it("starts a grid as the plain view, on the focus panel", () => {
    const panels = comparePanels(view, grid, 0);
    const focus = panels[3];
    expect(focus.clip).toEqual(area);
    expect(focus.alpha).toBe(1);
    expect(focus.view.blend.t).toBe(0);
    expect(focus.view.zoom).toBe(1.2);
    expect(viewArea(focus.view)).toEqual(viewArea(view));
    expect(panels[0].alpha).toBe(0);
    expect(panels[0].clip.width).toBe(0);
  });

  it("ends a grid in its cells, morphed to the preset", () => {
    const panels = comparePanels(view, grid, 1);
    expect(panels.map((p) => p.clip)).toEqual([
      { x: 200, y: 100, width: 400, height: 350 },
      { x: 600, y: 100, width: 400, height: 350 },
      { x: 200, y: 450, width: 400, height: 350 },
      { x: 600, y: 450, width: 400, height: 350 },
    ]);
    const cell = panels[1].view;
    expect(cell.blend.b).toBe(PROJECTIONS.equirectangular);
    expect(cell.blend.t).toBe(1);
    expect(cell.blend.kb).toBe(fitScale(PROJECTIONS.equirectangular, 400, 350));
    expect(cell.zoom).toBe(2);
    expect(cell.rotate).toEqual([150, 0, 0]);
    expect(viewArea(cell)).toEqual({
      cx: 800,
      cy: 275,
      width: 400,
      height: 350,
    });
    expect(panels.every((p) => p.alpha === 1)).toBe(true);
  });

  it("turns the short way round", () => {
    const panels = comparePanels(view, { ...grid, rotate: [-170, 0, 0] }, 1);
    expect(panels[0].view.rotate[0]).toBeCloseTo(190);
  });

  it("slides a swipe divider in from the far side", () => {
    const swipe: CompareConfig = {
      layout: "swipe",
      panels: [{ yearOffset: 0 }, { yearOffset: -11 }],
      divider: 0.25,
    };
    const [first, second] = comparePanels(view, swipe, 1);
    expect(first.clip).toEqual({ x: 0, y: 0, width: 400, height: 800 });
    expect(second.clip).toEqual({ x: 400, y: 0, width: 600, height: 800 });
    expect(first.view).toBe(view);
    const [plain, hidden] = comparePanels(view, swipe, 0);
    expect(plain.clip.width).toBe(1000);
    expect(hidden.clip.width).toBe(0);
    const [top] = comparePanels(view, { ...swipe, axis: "y" }, 1);
    expect(top.clip).toEqual({ x: 0, y: 0, width: 1000, height: 275 });
  });
});

describe("parseCompare", () => {
  const path = "compare";

  it("accepts a swipe and a grid", () => {
    expect(parseCompare(grid, path)).toEqual(grid);
    expect(
      parseCompare(
        { layout: "swipe", panels: [{ yearOffset: 0 }, { yearOffset: -11 }] },
        path,
      ).layout,
    ).toBe("swipe");
  });

  it("rejects what it cannot draw", () => {
    const bad: [unknown, RegExp][] = [
      [null, /must be an object/],
      [{ ...grid, layout: "stack" }, /layout/],
      [{ ...grid, panels: [{ yearOffset: 0 }] }, /at least two/],
      [{ ...grid, layout: "swipe" }, /a swipe has two/],
      [{ ...grid, panels: [{ yearOffset: 0.5 }, { yearOffset: 0 }] }, /whole/],
      [
        { ...grid, panels: [{ yearOffset: 0, x: 1 }, { yearOffset: 0 }] },
        /panel key/,
      ],
      [{ ...grid, progress: 2 }, /progress/],
      [{ ...grid, cols: 1, rows: 2 }, /fewer than 4/],
      [{ ...grid, focus: 4 }, /focus/],
      [{ ...grid, preset: "nope" }, /preset/],
      [{ ...grid, rotate: [1, 2] }, /rotate/],
      [{ ...grid, zoom: 0 }, /zoom/],
      [{ ...grid, extra: true }, /not a compare key/],
    ];
    for (const [value, error] of bad) {
      expect(() => parseCompare(value, path)).toThrow(error);
    }
  });
});
