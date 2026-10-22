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

vi.mock("./Overlay", () => ({
  Overlay: class {
    fillLand = true;
    setLandDetail(): void {}
  },
}));

vi.mock("./SphereParticles", () => ({
  SphereParticles: class {
    resize(): void {}
    destroy(): void {}
  },
  visibleCap: () => 1,
}));

vi.mock("./SphereScalar", () => ({
  SphereScalar: class {
    destroy(): void {}
  },
}));

const { Projversor } = await import("./Projversor");

const WIND = "72aa3549-8cdf-4275-b8f7-5b32ca40a3f2";
const SST = "3db0120b-17d2-4789-9952-efcc0953ecc4";

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
    append: (canvas: { remove: () => void }) => canvases.push(canvas),
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

  it("relays layer events with the layer id and restyles through the handle", async () => {
    const pv = new Projversor(fakeRoot().root, { interactive: false });
    await pv.init();
    const statuses: { id: string; text: string }[] = [];
    const palettes: { id: string; palette: string }[] = [];
    pv.on("status", (s) => statuses.push(s));
    pv.on("palette", (p) => palettes.push(p));
    const wind = await added(pv, "wind", "particles", "surface-wind", WIND);
    expect(statuses[statuses.length - 1]).toEqual({ id: "wind", text: "" });
    await wind.update({ palette: "viridis" });
    expect(wind.palette).toBe("viridis");
    expect(palettes[palettes.length - 1]).toEqual({
      id: "wind",
      palette: "viridis",
    });
  });
});
