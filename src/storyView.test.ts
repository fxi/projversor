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

  it("accepts alpha fades and reads legacy palettes as their replacement", () => {
    const config = parseProjversorView(
      view({ style: { reversePalette: true, raster: { alphaFadeLow: 0.2 } } }),
    );
    expect(config.style).toEqual({
      reversePalette: true,
      raster: { alphaFadeLow: 0.2 },
    });
    expect(
      parseProjversorView(view({ style: { palette: "heat-alert" } })).style,
    ).toEqual({ palette: "heat", raster: { alphaFadeLow: 0.25 } });
  });

  it("accepts the particle glow and checks its range", () => {
    expect(
      parseProjversorView(view({ style: { particles: { glow: 0.5 } } })).style,
    ).toEqual({ particles: { glow: 0.5 } });
    expect(() =>
      parseProjversorView(view({ style: { particles: { glow: 2 } } })),
    ).toThrow("views.probe.config.style.particles.glow must be");
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
    const style = { palette: "viridis", particles: { grade: "vibrant" } };
    expect(config).toEqual({
      layers: [{ layer: "surface-wind", style }],
      layer: "surface-wind",
      preset: "globe",
      style,
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

describe("parseProjversorView timeRange", () => {
  it("accepts zartigl's time range and rejects a malformed one with its path", () => {
    const range = { start: "2026-05-01", end: "2026-10-31" };
    expect(parseProjversorView(view({ timeRange: range })).timeRange).toEqual(
      range,
    );
    expect(() =>
      parseProjversorView(view({ timeRange: { trailing: "P6M" } })),
    ).not.toThrow();
    expect(() =>
      parseProjversorView(
        view({ timeRange: { start: "2026-10-31", end: "2026-05-01" } }),
      ),
    ).toThrow("views.probe.config.timeRange.start must not follow its end");
    expect(() =>
      parseProjversorView(view({ timeRange: { loop: true } })),
    ).toThrow("views.probe.config.timeRange.loop is not a time range key");
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
    expect(state.timeRange).toBeNull();
  });
});

/** A projversor double recording the calls a story view makes. */
function fakeProjversor({ stuck = false } = {}) {
  const calls: unknown[][] = [];
  const layers = new Map<string, unknown>();
  // Each replace waits for the one before: a slow decode, for the races.
  let loading: Promise<void> = Promise.resolve();
  const handle = (
    id: string,
    type: string,
    source: string,
    tint: string | null,
  ) => ({
    id,
    type,
    source: { id: source },
    tint,
    update: async (style: unknown) => {
      calls.push(["restyle", id, style]);
    },
    // Stuck: a follower month that never decodes, until superseded.
    followed: (signal?: AbortSignal) => {
      calls.push(["followed", id]);
      return stuck
        ? new Promise<void>((resolve) =>
            signal?.addEventListener("abort", () => resolve()),
          )
        : Promise.resolve();
    },
  });
  const pv = {
    remove: async (id: string) => {
      calls.push(["remove", id]);
      layers.delete(id);
    },
    add: async (id: string, type: string) => {
      calls.push(["add", id, type]);
      if (layers.has(id)) {
        throw new Error(`projversor: layer "${id}" already exists`);
      }
      layers.set(id, { id, type });
    },
    update: async (state: unknown) => {
      calls.push(["update", state]);
    },
    get: (id: string) => layers.get(id),
    get ids() {
      return [...layers.keys()];
    },
    replace: async (
      id: string,
      type: string,
      config: { source: string; tint: string | null },
    ) => {
      calls.push(["replace", id, type, config]);
      const existing = [...layers].find(
        ([other, e]) =>
          other !== id && (e as { type: string }).type === "particles",
      );
      if (type === "particles" && existing) {
        throw new Error("projversor: one particles layer at a time");
      }
      await (loading = loading.then(() => new Promise((r) => setTimeout(r))));
      layers.set(id, handle(id, type, config.source, config.tint));
      return layers.get(id);
    },
  };
  return { pv: pv as unknown as Projversor, calls, ids: () => pv.ids };
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
      "story-layer-0",
      "particles",
      {
        source: "surface-wind",
        tint: null,
        style: {},
        time: undefined,
        speed: undefined,
        timeRange: null,
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
    expect(calls).toContainEqual([
      "restyle",
      "story-layer-0",
      { palette: "viridis" },
    ]);
    expect(calls).toContainEqual([
      "update",
      {
        speed: undefined,
        timeRange: null,
        time: Date.parse("2025-01-15T00:00:00Z"),
      },
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

  it("adds a stack bottom up, the bottom one on the clock", async () => {
    const { pv, calls, ids } = fakeProjversor();
    const story = new ProjversorStoryView(pv, false);
    const timeRange = { start: "2026-06-01", end: "2026-08-31" };
    await story.activate(scene("a", { layers: fires(), timeRange }));
    const replaces = calls.filter((c) => c[0] === "replace");
    expect(replaces.map((c) => [c[1], c[2]])).toEqual([
      ["story-layer-0", "scalar"],
      ["story-layer-1", "scalar"],
    ]);
    expect(replaces[0][3]).toMatchObject({ source: "pm2-5", timeRange });
    expect(replaces[1][3]).not.toHaveProperty("timeRange");
    expect(replaces[1][3]).not.toHaveProperty("time");
    // Resolved once the stack is final and the follower shows the playhead.
    expect(calls[calls.length - 1]).toEqual(["followed", "story-layer-1"]);
    expect(ids()).toEqual(["story-layer-0", "story-layer-1"]);
    expect(story.layers.map((l) => l.source.id)).toEqual([
      "pm2-5",
      "fire-radiative-power",
    ]);
    expect(story.field?.source.id).toBe("pm2-5");
  });

  it("restyles a stack that stays, and drops only the top of a shorter one", async () => {
    const { pv, calls, ids } = fakeProjversor();
    const story = new ProjversorStoryView(pv, false);
    await story.activate(scene("a", { layers: fires() }));
    calls.length = 0;
    await story.activate(scene("b", { layers: fires() }));
    expect(calls.some((c) => c[0] === "replace" || c[0] === "add")).toBe(false);
    expect(calls).toContainEqual([
      "restyle",
      "story-layer-1",
      { palette: "heat" },
    ]);
    calls.length = 0;
    await story.activate(scene("c", { layer: "pm2-5" }));
    expect(calls).toContainEqual(["remove", "story-layer-1"]);
    expect(calls).not.toContainEqual(["remove", "story-layer-0"]);
    expect(calls.some((c) => c[0] === "replace")).toBe(false);
    expect(ids()).toEqual(["story-layer-0"]);
    expect(story.layers).toHaveLength(1);
  });

  it("moves the particles between slots without doubling them", async () => {
    const { pv, ids } = fakeProjversor();
    const story = new ProjversorStoryView(pv, false);
    await story.activate(
      scene("a", { layers: [{ layer: "pm2-5" }, { layer: "surface-wind" }] }),
    );
    await story.activate(
      scene("b", { layers: [{ layer: "surface-wind" }, { layer: "pm2-5" }] }),
    );
    expect(ids()).toEqual(["story-layer-0", "story-layer-1"]);
    expect(story.layers.map((l) => l.source.id)).toEqual([
      "surface-wind",
      "pm2-5",
    ]);
  });

  it("applies only the last of activations called at once", async () => {
    const { pv, calls, ids } = fakeProjversor();
    const story = new ProjversorStoryView(pv, false);
    await story.activate(scene("a", { layer: "pm2-5" }));
    calls.length = 0;
    // A fast scroll: through the fires and past them before they load.
    await Promise.all([
      story.activate(scene("b", { layers: fires() })),
      story.activate(
        scene("c", { layer: "sea-ice-thickness", preset: "north" }),
      ),
    ]);
    expect(
      calls.some((c) => c[0] === "replace" && c[1] === "story-layer-1"),
    ).toBe(false);
    expect(ids()).toEqual(["story-layer-0"]);
    expect(story.field?.source.id).toBe("sea-ice-thickness");
  });

  it("stops waiting for a follower once a later view supersedes it", async () => {
    const { pv, ids } = fakeProjversor({ stuck: true });
    const story = new ProjversorStoryView(pv, false);
    const stuck = story.activate(scene("a", { layers: fires() }));
    // Let it reach the wait for its follower.
    await new Promise((r) => setTimeout(r, 20));
    await Promise.all([stuck, story.activate(scene("b", { layer: "pm2-5" }))]);
    expect(ids()).toEqual(["story-layer-0"]);
  });

  it("keeps the stack order when a stack follows a loading view", async () => {
    const { pv, ids } = fakeProjversor();
    const story = new ProjversorStoryView(pv, false);
    const first = story.activate(scene("a", { layer: "pm2-5" }));
    // Called once the first one runs: it waits instead of racing it.
    await Promise.resolve();
    await Promise.all([first, story.activate(scene("b", { layers: fires() }))]);
    expect(ids()).toEqual(["story-layer-0", "story-layer-1"]);
    expect(story.layers.map((l) => l.source.id)).toEqual([
      "pm2-5",
      "fire-radiative-power",
    ]);
  });
});

/** The smoke and its fires, a fresh copy each time. */
const fires = () => [
  { layer: "pm2-5", style: { palette: "gray" } },
  { layer: "fire-radiative-power", style: { palette: "heat" } },
];

describe("parseProjversorView layers", () => {
  const stacked = (config: Record<string, unknown>) =>
    view({ layer: undefined, ...config });

  it("accepts a stack, and reads the flat keys as a stack of one", () => {
    const config = parseProjversorView(stacked({ layers: fires() }));
    expect(config.layers).toEqual(fires());
    expect(config).toMatchObject({
      layer: "pm2-5",
      style: { palette: "gray" },
    });
    expect(
      parseProjversorView(view({ tint: "", style: { palette: "viridis" } }))
        .layers,
    ).toEqual([
      { layer: "surface-wind", tint: "", style: { palette: "viridis" } },
    ]);
  });

  it("checks the playback speed against the bottom layer", () => {
    expect(() =>
      parseProjversorView(
        stacked({ layers: fires(), playback: { speed: 20 } }),
      ),
    ).not.toThrow();
    expect(() =>
      parseProjversorView(
        stacked({
          layers: [{ layer: "surface-wind" }, { layer: "pm2-5" }],
          playback: { speed: 20 },
        }),
      ),
    ).toThrow("views.probe.config.playback.speed must be one of");
  });

  it("rejects a malformed stack with its path", () => {
    expect(() => parseProjversorView(stacked({ layers: [] }))).toThrow(
      "views.probe.config.layers must be a non-empty array",
    );
    expect(() => parseProjversorView(view({ layers: fires() }))).toThrow(
      "views.probe.config.layer is set in layers, not next to them",
    );
    expect(() =>
      parseProjversorView(stacked({ layers: [{ layer: "nope" }] })),
    ).toThrow("views.probe.config.layers.0.layer is not a projversor layer");
    expect(() =>
      parseProjversorView(
        stacked({ layers: [{ layer: "pm2-5" }, { layer: "nope" }] }),
      ),
    ).toThrow("views.probe.config.layers.1.layer is not a projversor layer");
    expect(() =>
      parseProjversorView(
        stacked({
          layers: [{ layer: "pm2-5" }, { layer: "pm2-5", opacity: 0.5 }],
        }),
      ),
    ).toThrow("views.probe.config.layers.1.opacity is not a layer key");
    expect(() =>
      parseProjversorView(
        stacked({
          layers: [
            { layer: "pm2-5" },
            { layer: "fire-radiative-power", style: { palette: "nope" } },
          ],
        }),
      ),
    ).toThrow("views.probe.config.layers.1.style.palette is not offered");
    expect(() =>
      parseProjversorView(stacked({ layers: [{ layer: "pm2-5", tint: "" }] })),
    ).toThrow("views.probe.config.layers.0.tint must be");
    // The first format's style keys would style no layer of a stack.
    for (const legacy of [{ palette: "gray" }, { vibrant: true }]) {
      expect(() =>
        parseProjversorView(stacked({ layers: fires(), ...legacy })),
      ).toThrow(
        `views.probe.config.${Object.keys(legacy)[0]} is set in layers, not next to them`,
      );
    }
    // Its playback keys still move.
    expect(
      parseProjversorView(stacked({ layers: fires(), speed: 20 })).playback,
    ).toEqual({ speed: 20 });
    expect(() =>
      parseProjversorView(
        stacked({
          layers: [{ layer: "surface-wind" }, { layer: "surface-wind" }],
        }),
      ),
    ).toThrow("views.probe.config.layers holds more than one vector layer");
  });

  it("rejects the former overlay key", () => {
    expect(() =>
      parseProjversorView(view({ overlay: { layer: "pm2-5" } })),
    ).toThrow("views.probe.config.overlay is not a projversor view key");
  });
});

describe("ProjversorStoryView time range", () => {
  it("passes a view's range on and clears it with the next view", async () => {
    const { pv, calls } = fakeProjversor();
    const story = new ProjversorStoryView(pv, false);
    const timeRange = { start: "2026-05-01", end: "2026-10-31" };
    await story.activate({
      id: "a",
      config: { layer: "surface-wind", preset: "globe", timeRange },
    });
    expect(calls.find((c) => c[0] === "replace")?.[3]).toMatchObject({
      timeRange,
    });
    calls.length = 0;
    await story.activate({
      id: "b",
      config: { layer: "surface-wind", preset: "mollweide" },
    });
    expect(calls).toContainEqual([
      "update",
      { speed: undefined, timeRange: null, time: undefined },
    ]);
  });
});
