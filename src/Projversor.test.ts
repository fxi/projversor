import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A promise resolved from the outside. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const manifests = new Map<string, ReturnType<typeof deferred<unknown>>>();
const manifestFor = (url: string) => {
  if (!manifests.has(url)) {
    manifests.set(url, deferred<unknown>());
  }
  return manifests.get(url)!;
};

vi.mock("@fxi/zartigl/engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@fxi/zartigl/engine")>()),
  loadGeoVideoManifest: vi.fn((url: string) => manifestFor(url).promise),
  createColorRampTexture: vi.fn(() => ({})),
}));

vi.mock("./layers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./layers")>()),
  loadChunks: vi.fn(async (entryId: string) =>
    ["jan", "feb"].map((month, i) => ({
      manifestUrl: `${entryId}/${month}`,
      temporal: {
        mode: "fixed",
        start: `2025-0${i + 1}-01T00:00:00Z`,
        end: `2025-0${i + 1}-28T00:00:00Z`,
      },
    })),
  ),
  loadTintChunks: vi.fn(async () => []),
}));

vi.mock("./GeoVideoField", () => ({
  GeoVideoField: class {
    readonly times: number[];
    readonly bounds = [-180, -90, 180, 90] as const;
    constructor(_gl: unknown, manifest: { times: number[] }) {
      this.times = manifest.times;
    }
    async prime(): Promise<void> {}
    focus(): void {}
    destroy(): void {}
  },
}));

const overlayColors: unknown[] = [];

vi.mock("./Overlay", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./Overlay")>()),
  Overlay: class {
    readonly geojson = new Map();
    setLandDetail(): void {}
    setColors(colors: unknown): void {
      overlayColors.push(colors);
    }
  },
}));

vi.mock("./SphereParticles", () => ({
  SphereParticles: class {
    resize(): void {}
    destroy(): void {}
  },
  visibleCap: () => 1,
}));

const imagesDestroyed: number[][] = [];

vi.mock("./SphereImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./SphereImage")>()),
  SphereImage: class {
    constructor(
      _gl: unknown,
      _image: unknown,
      readonly bounds: number[],
    ) {}
    destroy(): void {
      imagesDestroyed.push(this.bounds);
    }
  },
}));

vi.mock("./SphereScalar", () => ({
  SphereScalar: class {
    destroy(): void {}
  },
}));

const { Projversor } = await import("./Projversor");
const { loadChunks } = await import("./layers");

const WIND = "72aa3549-8cdf-4275-b8f7-5b32ca40a3f2";
const SST = "3db0120b-17d2-4789-9952-efcc0953ecc4";
const CURRENTS = "61a81ddd-6c8e-4020-a59f-06ef13a90419";

/** Month manifest of an entry, two daily frames in January or February. */
function resolveMonth(entryId: string, month: "jan" | "feb"): void {
  const start = Date.parse(`2025-${month === "jan" ? "01" : "02"}-01`);
  const url = `${entryId}/${month}`;
  manifestFor(url).resolve({ url, times: [start, start + 86_400_000] });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A root element with just what projversor touches. */
function fakeRoot() {
  const gl = { deleteTexture: vi.fn() };
  const canvases: { remove: () => void }[] = [];
  const doc = {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        style: { cssText: "" },
        dataset: {},
        getContext: () => gl,
        addEventListener: vi.fn(),
        remove: vi.fn(),
      };
      return canvas;
    },
    defaultView: { getComputedStyle: () => ({ position: "relative" }) },
  };
  const root = {
    clientWidth: 800,
    clientHeight: 600,
    ownerDocument: doc,
    style: {},
    prepend: (...added: { remove: () => void }[]) => canvases.push(...added),
  };
  return { root: root as unknown as HTMLElement, canvases };
}

/** Add a layer and decode its month. */
async function added(
  pv: InstanceType<typeof Projversor>,
  id: string,
  type: "particles" | "scalar",
  source: string,
  entryId: string,
) {
  const adding = pv.add(id, type, { source });
  await flush();
  resolveMonth(entryId, "feb");
  return adding;
}

describe("Projversor", () => {
  beforeEach(() => {
    manifests.clear();
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    vi.stubGlobal("window", { devicePixelRatio: 1 });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("needs init before layers", async () => {
    const pv = new Projversor(fakeRoot().root);
    await expect(
      pv.add("wind", "particles", { source: "surface-wind" }),
    ).rejects.toThrow("init()");
  });

  it("creates its canvases in the root and removes them on destroy", async () => {
    const { root, canvases } = fakeRoot();
    const pv = new Projversor(root, { interactive: false });
    await pv.init();
    expect(canvases).toHaveLength(3);
    pv.destroy();
    for (const canvas of canvases) {
      expect(canvas.remove).toHaveBeenCalled();
    }
  });

  it("opens the first layer at the given time and lets it drive", async () => {
    const time = Date.parse("2025-02-01T12:00:00Z");
    const pv = new Projversor(fakeRoot().root, { time, interactive: false });
    await pv.init();
    const wind = await added(pv, "wind", "particles", "surface-wind", WIND);
    expect(wind.driving).toBe(true);
    expect(wind.chunkIndex).toBe(1);
    expect(pv.time).toBe(time);
    expect(pv.get("wind")).toBe(wind);
    expect(pv.ids).toEqual(["wind"]);
  });

  it("rejects unknown sources, kind mismatches, taken ids and a second particles layer", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    await expect(
      pv.add("x", "particles", { source: "nowhere" }),
    ).rejects.toThrow("unknown source");
    await expect(
      pv.add("x", "particles", { source: "sea-water-temperature" }),
    ).rejects.toThrow("scalar source, not particles");
    await added(pv, "wind", "particles", "surface-wind", WIND);
    await expect(
      pv.add("wind", "scalar", { source: "sea-water-temperature" }),
    ).rejects.toThrow("already exists");
    await expect(
      pv.add("currents", "particles", { source: "ocean-current-velocity" }),
    ).rejects.toThrow("one particles layer");
    expect(pv.ids).toEqual(["wind"]);
  });

  it("hands the playhead to the next layer when the driving one goes", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    await added(pv, "wind", "particles", "surface-wind", WIND);
    const sst = await added(pv, "sst", "scalar", "sea-water-temperature", SST);
    expect(sst.driving).toBe(false);
    await pv.remove("wind");
    expect(sst.driving).toBe(true);
    expect(pv.ids).toEqual(["sst"]);
  });

  it("plays on from a picked month, not from the one it replaced", async () => {
    vi.mocked(loadChunks).mockImplementationOnce(
      async (entryId) =>
        ["jan", "feb", "mar"].map((month, i) => ({
          manifestUrl: `${entryId}/${month}`,
          temporal: {
            mode: "fixed",
            start: `2025-0${i + 1}-01T00:00:00Z`,
            end: `2025-0${i + 1}-28T00:00:00Z`,
          },
        })) as Awaited<ReturnType<typeof loadChunks>>,
    );
    const pv = new Projversor(fakeRoot().root, {
      time: Date.parse("2025-01-01"),
      interactive: false,
    });
    await pv.init();
    const adding = pv.add("sst", "scalar", { source: "sea-water-temperature" });
    await flush();
    resolveMonth(SST, "jan");
    const sst = await adding;
    // The handle's layer, to step its playhead without the render loop.
    const { field } = sst as unknown as {
      field: { advanceTime(dt: number): void };
    };
    const month = (name: string, start: string) => {
      const url = `${SST}/${name}`;
      const t = Date.parse(start);
      manifestFor(url).resolve({ url, times: [t, t + 86_400_000] });
    };
    // March is picked; January plays on past its prefetch point meanwhile.
    const picking = sst.openMonth(2);
    field.advanceTime(0.4);
    month("feb", "2025-02-01");
    await flush();
    month("mar", "2025-03-01");
    await picking;
    expect(sst.chunkIndex).toBe(2);
    // Past March's end: April does not exist, the archive wraps to January.
    field.advanceTime(0.4);
    await flush();
    field.advanceTime(0.4);
    expect(sst.chunkIndex).toBe(0);
  });

  it("relays layer events with the layer id and restyles through the handle", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    const statuses: { id: string; text: string }[] = [];
    const palettes: { id: string; palette: string; ramp: unknown }[] = [];
    pv.on("status", (s) => statuses.push(s));
    pv.on("palette", (p) => palettes.push(p));
    const wind = await added(pv, "wind", "particles", "surface-wind", WIND);
    expect(statuses[statuses.length - 1]).toEqual({ id: "wind", text: "" });
    await wind.update({ palette: "viridis" });
    expect(wind.palette).toBe("viridis");
    expect(palettes[palettes.length - 1]).toEqual({
      id: "wind",
      palette: "viridis",
      ramp: { reverse: false, alphaFade: { low: 0, high: 0, curve: "linear" } },
    });
  });

  it("adds, restyles and removes a GeoJSON layer, and rejects other data", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    const data = { type: "Point" as const, coordinates: [0, 0] };
    const zones = await pv.add("zones", "geojson", { data });
    expect(zones.type).toBe("geojson");
    expect(pv.ids).toEqual(["zones"]);
    await zones.update({ label: "name" });
    expect(zones.style).toEqual({ label: "name" });
    await expect(
      pv.add("bad", "geojson", { data: { type: "Map" } as never }),
    ).rejects.toThrow("must be a GeoJSON object");
    await pv.remove("zones");
    expect(pv.ids).toEqual([]);
  });

  it("adds, restyles and removes an image, and checks its bounds and opacity", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    const image = {} as ImageBitmap;
    await expect(
      pv.add("bad", "image", { image, bounds: [10, 0, -10, 20] }),
    ).rejects.toThrow("bounds must be [west, south, east, north]");
    await expect(
      pv.add("bad", "image", {
        image,
        bounds: [0, 0, 10, 10],
        style: { opacity: 2 },
      }),
    ).rejects.toThrow("opacity must be within 0–1");
    const photo = await pv.add("photo", "image", {
      image,
      bounds: [160, -10, 200, 10],
    });
    expect(photo.bounds).toEqual([160, -10, 200, 10]);
    await photo.update({ opacity: 0.5 });
    expect(photo.style).toEqual({ opacity: 0.5 });
    imagesDestroyed.length = 0;
    await pv.remove("photo");
    expect(imagesDestroyed).toEqual([[160, -10, 200, 10]]);
    expect(pv.ids).toEqual([]);
  });

  it("recolors the overlay on update and rejects unknown color keys", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    overlayColors.length = 0;
    await pv.update({ colors: { ocean: "#111d23" } });
    expect(overlayColors).toEqual([{ ocean: "#111d23" }]);
    await expect(
      pv.update({ colors: { sea: "#000" } as never }),
    ).rejects.toThrow("projversor colors.sea is not one of");
  });

  it("replaces a layer in place once the new source is decoded", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    const field = await added(pv, "field", "particles", "surface-wind", WIND);
    const replacing = pv.replace("field", "particles", {
      source: "ocean-current-velocity",
    });
    await flush();
    // Index loaded, month still decoding: the shown layer stays.
    expect(field.source.id).toBe("surface-wind");
    resolveMonth(CURRENTS, "feb");
    expect(await replacing).toBe(field);
    expect(field.source.id).toBe("ocean-current-velocity");
    expect(pv.ids).toEqual(["field"]);
  });

  it("lets a later replace win over one still loading, across kinds", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    const field = await added(pv, "field", "particles", "surface-wind", WIND);
    const stale = pv.replace("field", "particles", {
      source: "ocean-current-velocity",
    });
    await flush();
    const winner = pv.replace("field", "scalar", {
      source: "sea-water-temperature",
    });
    await flush();
    resolveMonth(SST, "feb");
    await winner;
    resolveMonth(CURRENTS, "feb");
    await stale;
    expect(field.source.id).toBe("sea-water-temperature");
    expect(field.type).toBe("scalar");
  });

  it("keeps the shown layer when a replace fails", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    const field = await added(pv, "field", "particles", "surface-wind", WIND);
    vi.mocked(loadChunks).mockResolvedValueOnce([]);
    await expect(
      pv.replace("field", "particles", { source: "ocean-current-velocity" }),
    ).rejects.toThrow("has no archive months");
    expect(field.source.id).toBe("surface-wind");
  });
});
