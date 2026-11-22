import { parseStoryDocuments } from "@fxi/story/browser";
import { describe, expect, it } from "vitest";
import { PROJVERSOR_LAYERS } from "./layers";
import type { ShareState } from "./share";
import { parseProjversorView } from "./storyView";
import { sceneStub, slugId, viewEntry } from "./viewExport";

const vector = PROJVERSOR_LAYERS.find((l) => l.kind === "vector" && l.tint)!;
const scalar = PROJVERSOR_LAYERS.find((l) => l.kind === "scalar")!;

const state = (over: Partial<ShareState> = {}): ShareState => ({
  layer: scalar.id,
  time: Date.UTC(2026, 4, 14, 12),
  preset: "mollweide",
  rotate: [-137.234, -38.06, 0],
  zoom: 4.6123,
  playing: true,
  speed: 1,
  tint: "",
  style: {},
  ...over,
});

describe("viewEntry", () => {
  it("writes a view the story parser accepts", () => {
    const entry = viewEntry(
      state({ style: { palette: "viridis", raster: { opacity: 0.8 } } }),
      "japan",
    );
    expect(entry).toMatchObject({
      id: "japan",
      type: "projversor",
      config: {
        layer: scalar.id,
        preset: "mollweide",
        rotate: [-137.2, -38.1, 0],
        zoom: 4.61,
        style: { palette: "viridis", raster: { opacity: 0.8 } },
        playback: { speed: 1, time: "2026-05-14T12:00:00.000Z" },
      },
    });
    expect(() => parseProjversorView(entry)).not.toThrow();
  });

  it("leaves out the layer's own tint and an empty style", () => {
    const own = viewEntry(state({ layer: vector.id, tint: vector.tint }), "v");
    expect(own.config).not.toHaveProperty("tint");
    expect(own.config).not.toHaveProperty("style");
    const bySpeed = viewEntry(state({ layer: vector.id, tint: "" }), "v");
    expect(bySpeed.config.tint).toBe("");
    expect(() => parseProjversorView(bySpeed)).not.toThrow();
  });

  it("keeps the time window", () => {
    const entry = viewEntry(state({ timeRange: { trailing: "P7D" } }), "v");
    expect(entry.config.timeRange).toEqual({ trailing: "P7D" });
    expect(() => parseProjversorView(entry)).not.toThrow();
  });
});

describe("sceneStub", () => {
  it("shows the view behind a copy block the story parser accepts", () => {
    const view = viewEntry(state(), "japan");
    const scene = sceneStub("japan", "Japan");
    expect(scene.blocks[0]).toMatchObject({ type: "view", view: "japan" });
    expect(() =>
      parseStoryDocuments(
        {
          schemaVersion: 1,
          defaultLocale: "en",
          title: { en: "Story" },
          themes: {
            deep: {
              background: "#04050b",
              foreground: "#e9ebf2",
              muted: "#8a8fa3",
              accent: "#7fd4ff",
              accentSoft: "rgba(127, 212, 255, 0.18)",
              surface: "rgba(4, 5, 11, 0.72)",
            },
          },
          scenes: [scene],
        },
        { schemaVersion: 1, views: [view] },
        { layouts: ["w-e"] },
      ),
    ).not.toThrow();
  });
});

describe("slugId", () => {
  it("turns a label into an id", () => {
    expect(slugId("Mer Méditerranée × Température")).toBe(
      "mer-mediterranee-temperature",
    );
    expect(slugId("  ")).toBe("view");
  });
});
