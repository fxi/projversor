import { describe, expect, it } from "vitest";
import { parseLegendConfig, rampTicks } from "./legend";
import { authoringGuide } from "./guide";
import type { StoryScene } from "@fxi/story";
import {
  applyTheme,
  parseStory,
  sceneAside,
  sceneCatalogId,
  sceneInset,
} from "./mount";
import {
  fractionAt,
  monthTicks,
  seriesPaths,
  seriesValue,
  shiftYear,
  timeAt,
  timeFormatter,
  windowTicks,
  yearTicks,
} from "./timeline";

// Moved from grid-homepage with the story mount.
describe("timeline and legend ticks", () => {
  const may = Date.UTC(2026, 4, 1);
  const july = Date.UTC(2026, 6, 1);
  it("places times and month starts in the window", () => {
    expect(fractionAt(Date.UTC(2026, 5, 1), [may, july])).toBeCloseTo(31 / 61);
    expect(fractionAt(0, [may, july])).toBe(0);
    expect(timeAt(2, [may, july])).toBe(july);
    expect(monthTicks([may, july])).toEqual([31 / 61]);
  });

  it("uses calendar years for annual ticks, spoken dates and leap-day navigation", () => {
    const start = Date.UTC(2020, 11, 31);
    const end = Date.UTC(2023, 11, 31);
    expect(yearTicks([start, end])).toEqual(
      [2021, 2022, 2023].map((year) =>
        fractionAt(Date.UTC(year, 0, 1), [start, end]),
      ),
    );
    const leapDay = Date.UTC(2024, 1, 29, 12, 30);
    expect(shiftYear(leapDay, 1)).toBe(Date.UTC(2025, 1, 28, 12, 30));
    expect(shiftYear(leapDay, -4)).toBe(Date.UTC(2020, 1, 29, 12, 30));
    for (const locale of ["en", "fr"]) {
      expect(timeFormatter(locale, "year").format(leapDay)).toBe("2024");
      expect(timeFormatter(locale, "year", true).format(leapDay)).toBe("2024");
      expect(timeFormatter(locale, "day").format(leapDay)).not.toBe("2024");
    }
    expect(() =>
      parseLegendConfig({ label: { en: "x" }, timeStep: "month" }),
    ).toThrow('legend config: timeStep must be "day" or "year"');
  });

  it("ticks years over windows longer than two years", () => {
    const start = Date.UTC(2022, 5, 1);
    const end = Date.UTC(2026, 9, 31);
    expect(windowTicks([start, end], "day")).toEqual(yearTicks([start, end]));
    expect(windowTicks([may, july], "day")).toEqual(monthTicks([may, july]));
  });

  it("draws a series on the thumb's time axis, and reads it between days", () => {
    const points = [
      { time: may - 86_400_000, value: 9 },
      { time: may, value: 1 },
      { time: Date.UTC(2026, 5, 1), value: 3 },
      { time: july, value: 2 },
    ];
    const paths = seriesPaths(points, [may, july])!;
    expect(paths).toMatchObject({ low: 1, high: 3 });
    const x = +(fractionAt(Date.UTC(2026, 5, 1), [may, july]) * 1000).toFixed(
      2,
    );
    expect(paths.line).toBe(`M0,100L${x},0L1000,50`);
    expect(seriesValue(points, may + 15.5 * 86_400_000)).toBeCloseTo(2);
    expect(seriesValue(points, july + 1)).toBeNull();
    expect(seriesPaths(points, [july, july + 1])).toBeNull();
  });

  it("labels a ramp at its ends and a middle", () => {
    const ticks = rampTicks({ min: -2, max: 2, ramp: "linear" });
    expect(ticks[0]).toEqual({ at: 0, label: "−2" });
    expect(ticks[ticks.length - 1]).toEqual({ at: 1, label: "2" });
    expect(rampTicks({ min: 1, max: 1, ramp: "linear" })).toEqual([]);
  });

  it("writes ramp ticks with the separators of the locale", () => {
    const ticks = rampTicks({ min: 0, max: 0.6, ramp: "linear" }, 3, "fr");
    expect(ticks.map((tick) => tick.label)).toEqual([
      "0,0",
      "0,2",
      "0,4",
      "0,6",
    ]);
  });
});

describe("sceneInset", () => {
  it("frees the side opposite the card on wide screens", () => {
    expect(sceneInset("left", 1400, 900)).toMatchObject({ left: 560 });
    expect(sceneInset("right", 1000, 800)).toMatchObject({ right: 420 });
    expect(sceneInset("intro", 1400, 900)).toMatchObject({ top: 378 });
  });

  it("keeps the sphere above the cards on narrow screens", () => {
    expect(sceneInset("left", 400, 800)).toEqual({
      top: 0,
      right: 0,
      bottom: 240,
      left: 0,
    });
  });
});

describe("sceneAside", () => {
  const scene = (blocks: unknown[]) =>
    ({
      id: "s",
      name: { en: "S" },
      theme: "t",
      layout: "stage",
      blocks: [
        {
          id: "v",
          type: "view",
          slot: "stage",
          view: "globe",
          presentation: "background",
        },
        ...blocks,
      ],
    }) as StoryScene;
  const chart = (slot: string) => ({
    id: "c",
    type: "widget",
    slot,
    widget: "chart",
  });

  it("leaves a column for a stage widget or for the scene's copy", () => {
    expect(sceneAside(scene([]))).toBe(false);
    expect(sceneAside(scene([chart("stage")]))).toBe(true);
    expect(
      sceneAside(
        scene([
          { id: "h", type: "copy", slot: "copy", heading: { en: "H" } },
          chart("copy"),
        ]),
      ),
    ).toBe(true);
  });
});

describe("parseStory", () => {
  const documents = (config: Record<string, unknown>) => [
    {
      schemaVersion: 1,
      defaultLocale: "en",
      title: { en: "Probe" },
      themes: {
        default: {
          background: "#000",
          foreground: "#fff",
          muted: "#888",
          accent: "#7fd4ff",
          accentSoft: "rgba(127, 212, 255, 0.18)",
          surface: "rgba(0, 0, 0, 0.7)",
        },
      },
      scenes: [
        {
          id: "intro",
          name: { en: "Intro" },
          theme: "default",
          layout: "left",
          blocks: [
            {
              id: "intro-view",
              type: "view",
              slot: "stage",
              view: "globe",
              presentation: "background",
            },
          ],
        },
      ],
    },
    {
      schemaVersion: 1,
      views: [{ id: "globe", type: "projversor", config }],
    },
  ];

  it("accepts a bare globe", () => {
    const [story, views] = documents({ preset: "globe" });
    expect(parseStory(story, views).views.views).toHaveLength(1);
  });

  it("checks each view's config, not only when its scene shows", () => {
    const [story, views] = documents({ preset: "globe", layer: "nope" });
    expect(() => parseStory(story, views)).toThrow(
      "views.globe.config.layer is not a projversor layer",
    );
    const [other, unknown] = documents({ preset: "nope" });
    expect(() => parseStory(other, unknown)).toThrow(
      "views.globe.config.preset is unknown",
    );
    const [listed, list] = documents({ preset: ["globe"] });
    expect(() => parseStory(listed, list)).toThrow(
      "views.globe.config.preset is unknown",
    );
  });
});

describe("authoringGuide", () => {
  it("lists the layouts, presets and layers this version renders", () => {
    const guide = authoringGuide();
    expect(guide).toContain("`stage`");
    expect(guide).toContain("`globe` (Globe)");
    expect(guide).toMatch(/\| `surface-wind` \| particles \|/);
    // One line per layer id.
    const ids = [...guide.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("documents the glow and the text backdrop", () => {
    const guide = authoringGuide();
    expect(guide).toContain("`glowAnchor`");
    expect(guide).toContain('"dark-gradient"');
  });
});

describe("applyTheme", () => {
  // The two parts of an element applyTheme writes: no DOM needed.
  const element = () => {
    const props = new Map<string, string>();
    const el = {
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
      },
      dataset: {} as Record<string, string>,
    };
    return { el: el as unknown as HTMLElement, props, dataset: el.dataset };
  };
  const theme = {
    background: "#030409",
    foreground: "#eef4f8",
    muted: "#8b99a8",
    accent: "#9fd8ff",
    accentSoft: "rgba(159, 216, 255, 0.18)",
    surface: "rgba(3, 5, 9, 0.72)",
  };

  it("sets every colour of the theme as a story property", () => {
    const { el, props } = element();
    applyTheme(el, theme);
    expect(Object.fromEntries(props)).toEqual({
      "--zs-bg": "#030409",
      "--zs-ink": "#eef4f8",
      "--zs-muted": "#8b99a8",
      "--zs-accent": "#9fd8ff",
      "--zs-accent-soft": "rgba(159, 216, 255, 0.18)",
      "--zs-surface": "rgba(3, 5, 9, 0.72)",
    });
  });

  it("places the glow at the theme's anchor, none without one", () => {
    const plain = element();
    applyTheme(plain.el, theme);
    expect(plain.dataset.glow).toBe("none");
    const glowing = element();
    applyTheme(glowing.el, { ...theme, glowAnchor: "top-right" });
    expect(glowing.dataset.glow).toBe("top-right");
  });

  it("leaves the element as it is without a theme", () => {
    const { el, props, dataset } = element();
    applyTheme(el, undefined);
    expect(props.size).toBe(0);
    expect(dataset.glow).toBeUndefined();
  });
});

describe("sceneCatalogId", () => {
  const scene = {
    id: "s",
    name: { en: "S" },
    theme: "d",
    layout: "left",
    blocks: [
      { id: "v", type: "view" as const, slot: "stage" as const, view: "v" },
    ],
  };
  const views = (config: Record<string, unknown>) =>
    new Map([["v", { id: "v", type: "projversor", config }]]);

  it("names the layer a scene shows, none for a bare globe", () => {
    expect(sceneCatalogId(scene, views({ layer: "sst" }))).toBe("sst");
    expect(sceneCatalogId(scene, views({ layers: [{ layer: "pm2-5" }] }))).toBe(
      "pm2-5",
    );
    expect(sceneCatalogId(scene, views({ preset: "globe" }))).toBeNull();
    expect(sceneCatalogId(scene, views({ layers: [] }))).toBeNull();
  });
});
