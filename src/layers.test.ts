import { afterEach, describe, expect, it, vi } from "vitest";
import { catalog, type CatalogEntry } from "@fxi/zartigl/catalog";
import {
  isGeoVideoArchiveSource,
  type GeoVideoIndex,
} from "@fxi/zartigl/engine";
import {
  PROJVERSOR_LAYERS,
  PARTICLE_PALETTES,
  TINT_LAYERS,
  catalogLayers,
  coverage,
  findLayer,
  isTintFor,
  layerPalettes,
  loadLayers,
  loadTintChunks,
  tintLayersFor,
  useLayerCatalog,
  type ProjversorLayer,
} from "./layers";

const tinted = PROJVERSOR_LAYERS.find((l) => l.tint)!;

describe("catalogLayers", () => {
  it("lists every catalog entry with a GeoVideo archive", () => {
    const archived = catalog.layers.filter((e) =>
      e.sources.some(isGeoVideoArchiveSource),
    );
    const entryIds = new Set(PROJVERSOR_LAYERS.map((l) => l.entryId));
    expect(entryIds).toEqual(new Set(archived.map((e) => e.id)));
  });

  it("includes Mediterranean vectors and scalars", () => {
    expect(findLayer("med-ocean-current-velocity")?.kind).toBe("vector");
    expect(findLayer("med-sea-water-temperature")?.kind).toBe("scalar");
  });

  it("puts vector layers first, each tinted layer after its plain one", () => {
    const kinds = PROJVERSOR_LAYERS.map((l) => l.kind);
    expect(kinds.indexOf("scalar")).toBe(kinds.lastIndexOf("vector") + 1);
    const plain = PROJVERSOR_LAYERS.findIndex(
      (l) => l.id === "ocean-current-velocity",
    );
    expect(PROJVERSOR_LAYERS[plain + 1].id).toBe("ocean-velocity-temperature");
  });

  it("gives every layer a unique key", () => {
    const keys = PROJVERSOR_LAYERS.map((l) => l.id);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("tints only with scalar layers", () => {
    const scalars = new Set(TINT_LAYERS.map((l) => l.entryId));
    for (const layer of PROJVERSOR_LAYERS.filter((l) => l.tint)) {
      expect(layer.kind).toBe("vector");
      expect(scalars.has(layer.tint!)).toBe(true);
    }
  });

  it("styles particles with speed palettes, rasters with the catalog's", () => {
    for (const layer of PROJVERSOR_LAYERS) {
      expect(
        layerPalettes(layer).some((p) => p.id === layer.style.palette),
      ).toBe(true);
    }
    expect(findLayer("ocean-current-velocity")?.style.palette).toBe("plasma");
    const sst = catalog.layers.find(
      (e) => e.aliases?.[0] === "sea-water-temperature",
    )!;
    expect(findLayer("sea-water-temperature")?.style.palette).toBe(
      sst.defaults.palette,
    );
    expect(PARTICLE_PALETTES.some((p) => p.tags.includes("diverging"))).toBe(
      false,
    );
  });

  it("skips entries without an archive and keys by id without alias", () => {
    const [entry] = catalog.layers;
    const bare: CatalogEntry = { ...entry, aliases: undefined };
    const noArchive: CatalogEntry = {
      ...entry,
      id: "no-archive",
      sources: entry.sources.filter((s) => !isGeoVideoArchiveSource(s)),
    };
    expect(catalogLayers([bare, noArchive]).map((l) => l.id)).toEqual([
      entry.id,
    ]);
  });
});

describe("findLayer", () => {
  it("finds layers by key and by the entry id older links carry", () => {
    expect(findLayer("ocean-velocity-temperature")).toBe(tinted);
    expect(findLayer(tinted.entryId)?.id).toBe("ocean-current-velocity");
    expect(findLayer("nope")).toBeUndefined();
  });
});

describe("loadTintChunks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is empty without a tint", async () => {
    const load = vi.fn();
    await expect(loadTintChunks(null, load)).resolves.toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  it("falls back to no chunks when the tint index cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const load = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(loadTintChunks(tinted.tint, load)).resolves.toEqual([]);
  });

  it("lists the tint archive chunks", async () => {
    const load = vi.fn(
      async (): Promise<GeoVideoIndex> => ({
        schemaVersion: 1,
        type: "geovideo-index",
        catalogEntryId: tinted.tint!,
        sourceId: "1c21d5ae-ee20-47aa-aec0-30e69506bc9b",
        updatedAt: null,
        chunks: [
          {
            period: {
              start: "2026-09-01T00:00:00Z",
              end: "2026-10-01T00:00:00Z",
            },
            start: "2026-09-01T00:00:00Z",
            end: "2026-09-30T00:00:00Z",
            samples: 30,
            key: "0a8da727c742",
            manifestUrl: "0a8da727c742/manifest.json",
          },
        ],
      }),
    );
    const chunks = await loadTintChunks(tinted.tint, load);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].temporal?.start).toBe("2026-09-01T00:00:00Z");
  });
});

describe("catalog defaults", () => {
  it("keeps a particle palette the catalog sets, not a diverging one", () => {
    expect(findLayer("lake-geneva-currents")?.style.palette).toBe("viridis");
    expect(findLayer("sea-ice-drift")?.style.palette).toBe("ice");
    expect(findLayer("surface-wind")?.style.palette).toBe("plasma");
  });

  it("carries category, provider and the archive bounds", () => {
    const wind = findLayer("surface-wind")!;
    expect(wind.category).toBe("atmosphere");
    // The archive is global; the catalog's Cyclone Chido artifact is not.
    expect(wind.bounds![2] - wind.bounds![0]).toBeGreaterThanOrEqual(359);
    expect(findLayer("lake-geneva-currents")?.provider).toMatch(/Eawag/);
  });

  it("drops a tinted preset whose tint left the catalog", () => {
    const entries = catalog.layers.filter(
      (e) => e.aliases?.[0] !== "sea-water-temperature",
    );
    const ids = catalogLayers(entries).map((l) => l.id);
    expect(ids).toContain("ocean-current-velocity");
    expect(ids).not.toContain("ocean-velocity-temperature");
  });
});

describe("coverage", () => {
  it("is the share of the inner bounds the outer covers", () => {
    expect(coverage([-180, -90, 180, 90], [6, 46, 7, 47])).toBe(1);
    expect(coverage([-6, 30, 36, 46], [6, 46.2, 7, 46.5])).toBe(0);
    expect(coverage([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(0.5);
  });

  it("treats a 360° span as wrapping the antimeridian", () => {
    expect(coverage([-180.04, -80, 179.96, 90], [170, 0, 180, 10])).toBe(1);
  });
});

describe("tintLayersFor", () => {
  const tintIds = (alias: string) =>
    tintLayersFor(findLayer(alias)!).map((l) => l.id);

  it("offers the lake's own field first, then the air above it", () => {
    const ids = tintIds("lake-geneva-currents");
    expect(ids[0]).toBe("lake-geneva-temperature");
    expect(ids).toContain("air-temperature-2m");
    expect(ids).not.toContain("sea-water-temperature");
    expect(ids).not.toContain("med-sea-water-temperature");
  });

  it("puts regional fields before global ones on regional flows", () => {
    const ids = tintIds("med-ocean-current-velocity");
    expect(ids[0]).toBe("med-sea-water-temperature");
    expect(ids.indexOf("sea-water-temperature")).toBeGreaterThan(
      ids.lastIndexOf("med-sea-surface-temperature-satellite"),
    );
    expect(ids).not.toContain("baltic-bottom-oxygen");
  });

  it("leaves regional fields out of global flows", () => {
    const ids = tintIds("ocean-current-velocity");
    expect(ids).toContain("sea-water-temperature");
    expect(ids).not.toContain("med-sea-water-temperature");
    expect(ids).not.toContain("lake-geneva-temperature");
  });

  it("offers every curated tint for its flow", () => {
    for (const layer of PROJVERSOR_LAYERS.filter((l) => l.tint)) {
      expect(isTintFor(layer, layer.tint)).toBe(true);
    }
  });

  it("is empty for a scalar layer and global without bounds", () => {
    expect(tintLayersFor(findLayer("sea-water-temperature")!)).toEqual([]);
    const unbounded: ProjversorLayer = {
      ...findLayer("lake-geneva-currents")!,
      bounds: undefined,
    };
    expect(tintLayersFor(unbounded).map((l) => l.id)).not.toContain(
      "lake-geneva-temperature",
    );
  });
});

describe("loadLayers", () => {
  afterEach(() => void useLayerCatalog(catalog));

  it("refills the layers in place from the loaded catalog", async () => {
    const [entry] = catalog.layers;
    const added: CatalogEntry = {
      ...entry,
      id: "00000000-0000-4000-8000-000000000000",
      aliases: ["new-flow"],
    };
    const layers = await loadLayers(async () => ({
      catalog: { ...catalog, layers: [...catalog.layers, added] },
      source: "remote",
    }));
    expect(layers).toBe(PROJVERSOR_LAYERS);
    expect(findLayer("new-flow")?.entryId).toBe(added.id);
    expect(TINT_LAYERS.every((l) => l.kind === "scalar")).toBe(true);
  });
});

describe("bounds of a live catalog without them", () => {
  afterEach(() => void useLayerCatalog(catalog));

  it("come from the bundled catalog", () => {
    const stripped = {
      ...catalog,
      layers: catalog.layers.map((e) => ({
        ...e,
        sources: e.sources.map((s) =>
          s.type === "geovideo" ? { ...s, bounds: undefined } : s,
        ),
      })),
    } as typeof catalog;
    useLayerCatalog(stripped);
    expect(tintLayersFor(findLayer("lake-geneva-currents")!)[0].id).toBe(
      "lake-geneva-temperature",
    );
  });
});
