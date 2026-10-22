import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Projversor } from "./Projversor";
import {
  ProjversorStoryView,
  parseProjversorView,
  projversorState,
} from "./storyView";

const view = (config: Record<string, unknown>) => ({
  id: "probe",
  type: "projversor",
  config: { layer: "surface-wind", preset: "globe", ...config },
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseProjversorView", () => {
  it("rejects unknown layers, presets, palettes and keys", () => {
    expect(() => parseProjversorView(view({ layer: "nope" }))).toThrow(/layer/);
    expect(() => parseProjversorView(view({ preset: "nope" }))).toThrow(
      /preset/,
    );
    expect(() =>
      parseProjversorView(view({ style: { palette: "nope" } })),
    ).toThrow("views.probe.config.style.palette is not offered");
    expect(() => parseProjversorView(view({ particleDensity: 0.1 }))).toThrow(
      "views.probe.config.particleDensity is not a projversor view key",
    );
  });

  it("accepts GeoJSON regions and rejects malformed ones with their path", () => {
    const geojson = {
      data: { type: "Point", coordinates: [0, 0] },
      style: { label: "name" },
    };
    expect(parseProjversorView(view({ geojson })).geojson).toEqual(geojson);
    expect(() =>
      parseProjversorView(view({ geojson: { data: { type: "Nope" } } })),
    ).toThrow("views.probe.config.geojson.data must be a GeoJSON object");
  });

  it("rejects malformed numbers, dates and tints", () => {
    expect(() => parseProjversorView(view({ rotate: [0, 0] }))).toThrow(
      /rotate/,
    );
    expect(() => parseProjversorView(view({ zoom: 0 }))).toThrow(/zoom/);
    // A speed the renderer would silently ignore for this layer kind.
    expect(() => parseProjversorView(view({ playback: { speed: 3 } }))).toThrow(
      "views.probe.config.playback.speed must be one of",
    );
    expect(() =>
      parseProjversorView(view({ playback: { time: "soon" } })),
    ).toThrow("views.probe.config.playback.time is not a date");
    expect(() =>
      parseProjversorView(
        view({ layer: "sea-ice-thickness", preset: "north", tint: "" }),
      ),
    ).toThrow(/tint/);
  });

  it("accepts particle style on vector layers, with its path on errors", () => {
    const particles = { density: 0.03, speed: 1, fade: 0.6 };
    expect(
      parseProjversorView(view({ style: { particles } })).style?.particles,
    ).toEqual(particles);
    expect(() =>
      parseProjversorView(view({ style: { particles: { density: 1 } } })),
    ).toThrow("views.probe.config.style.particles.density must be");
    expect(() =>
      parseProjversorView(
        view({
          layer: "sea-ice-thickness",
          preset: "north",
          style: { particles: { density: 0.03 } },
        }),
      ),
    ).toThrow("views.probe.config.style.particles needs a vector layer");
  });

  it("accepts a particle backdrop on vector layers", () => {
    const backdrop = { enabled: true, color: "#000", opacity: 0.2 };
    expect(
      parseProjversorView(view({ style: { particles: { backdrop } } })).style
        ?.particles?.backdrop,
    ).toEqual(backdrop);
    expect(() =>
      parseProjversorView(
        view({ style: { particles: { backdrop: { color: "#0000" } } } }),
      ),
    ).toThrow("views.probe.config.style.particles.backdrop must be");
  });

  it("rejects style keys projversor does not render", () => {
    expect(() =>
      parseProjversorView(view({ style: { renderMode: "raster" } })),
    ).toThrow("views.probe.config.style.renderMode is not supported here");
    expect(() =>
      parseProjversorView(view({ style: { raster: { logScale: true } } })),
    ).toThrow("views.probe.config.style.raster.logScale is not supported here");
  });

  it("moves the first format's flat keys to style and playback", () => {
    const config = parseProjversorView(
      view({ palette: "viridis", vibrant: true, speed: 2, time: "2025-01-15" }),
    );
    expect(config).toEqual({
      layer: "surface-wind",
      preset: "globe",
      style: { palette: "viridis", particles: { grade: "vibrant" } },
      playback: { speed: 2, time: "2025-01-15" },
    });
    // The first format ignored the grade on scalar layers.
    expect(
      parseProjversorView(
        view({ layer: "sea-ice-thickness", preset: "north", vibrant: true }),
      ).style,
    ).toBeUndefined();
    // A flat speed is still checked as a playback speed.
    expect(() => parseProjversorView(view({ speed: 3 }))).toThrow(
      /playback\.speed/,
    );
  });

  it("still rejects a malformed style or playback next to flat keys", () => {
    expect(() =>
      parseProjversorView(view({ style: "thermal", palette: "viridis" })),
    ).toThrow("views.probe.config.style must be an object");
    expect(() =>
      parseProjversorView(view({ playback: 5, time: "2025-01-01" })),
    ).toThrow("views.probe.config.playback must be an object");
    expect(() =>
      parseProjversorView(view({ vibrant: true, style: { particles: "x" } })),
    ).toThrow("views.probe.config.style.particles must be an object");
  });
});

describe("projversorState", () => {
  it("maps a config to the projversor state", () => {
    const state = projversorState(
      parseProjversorView(
        view({
          tint: "",
          style: { particles: { grade: "vibrant", density: 0.03 } },
          playback: { speed: 2, time: "2025-01-15T00:00:00Z" },
        }),
      ),
    );
    expect(state).toMatchObject({
      layer: "surface-wind",
      preset: "globe",
      tint: "",
      speed: 2,
      time: Date.parse("2025-01-15T00:00:00Z"),
      style: { particles: { grade: "vibrant", density: 0.03 } },
    });
  });

  it("sets an empty style without an override, so the next view resets", () => {
    const state = projversorState(parseProjversorView(view({})));
    expect(state.style).toEqual({});
  });
});

/** A projversor double recording the calls a story view makes. */
function fakeProjversor() {
  const calls: unknown[][] = [];
  let field: { source: { id: string }; tint: string | null } | undefined;
  const handle = (source: string, tint: string | null) => ({
    source: { id: source },
    tint,
    update: async (style: unknown) => {
      calls.push(["restyle", style]);
    },
  });
  const pv = {
    remove: async (id: string) => {
      calls.push(["remove", id]);
    },
    add: async (id: string, type: string) => {
      calls.push(["add", id, type]);
    },
    update: async (state: unknown) => {
      calls.push(["update", state]);
    },
    get: () => field,
    replace: async (
      id: string,
      type: string,
      config: { source: string; tint: string | null },
    ) => {
      calls.push(["replace", id, type, config]);
      field = handle(config.source, config.tint);
      return field;
    },
  };
  return { pv: pv as unknown as Projversor, calls };
}

describe("ProjversorStoryView", () => {
  const scene = (id: string, config: Record<string, unknown>) => ({
    id,
    type: "projversor",
    config: { preset: "globe", ...config },
  });

  it("opens a layer, then only restyles and seeks while it stays", async () => {
    const { pv, calls } = fakeProjversor();
    const story = new ProjversorStoryView(pv, false);
    await story.activate(scene("a", { layer: "surface-wind" }));
    expect(calls.find((c) => c[0] === "replace")).toEqual([
      "replace",
      "story-field",
      "particles",
      {
        source: "surface-wind",
        tint: null,
        style: {},
        time: undefined,
        speed: undefined,
      },
    ]);
    calls.length = 0;
    await story.activate(
      scene("b", {
        layer: "surface-wind",
        style: { palette: "viridis" },
        playback: { time: "2025-01-15T00:00:00Z" },
      }),
    );
    expect(calls.some((c) => c[0] === "replace")).toBe(false);
    expect(calls).toContainEqual(["restyle", { palette: "viridis" }]);
    expect(calls).toContainEqual([
      "update",
      { speed: undefined, time: Date.parse("2025-01-15T00:00:00Z") },
    ]);
  });

  it("shows a view's GeoJSON and clears it with the next view", async () => {
    const { pv, calls } = fakeProjversor();
    const story = new ProjversorStoryView(pv, false);
    const geojson = { data: { type: "Point", coordinates: [0, 0] } };
    await story.activate(scene("a", { layer: "surface-wind", geojson }));
    expect(calls).toContainEqual(["add", "story-geojson", "geojson"]);
    calls.length = 0;
    await story.activate(scene("b", { layer: "surface-wind" }));
    expect(calls).toContainEqual(["remove", "story-geojson"]);
    expect(calls.some((c) => c[0] === "add")).toBe(false);
  });
});
