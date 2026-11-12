import {
  catalog as bundledCatalog,
  entryBounds,
  getCatalogEntry,
  loadCatalog,
  providerLabel,
  sourceCoversTime,
  requireCatalogEntry,
  resolveLocalizedText,
  type Catalog,
  type CatalogBounds,
  type CatalogEntry,
  type CatalogGeoVideoSource,
  type LoadedCatalog,
} from "@fxi/zartigl/catalog";
import {
  geoVideoChunkSources,
  loadGeoVideoManifest,
  getPalettes,
  isGeoVideoArchiveSource,
  loadGeoVideoIndex,
  type PaletteMeta,
} from "@fxi/zartigl/engine";
import type { LayerStyleInput } from "@fxi/zartigl/catalog";

/**
 * A catalog entry with a GeoVideo archive, with the styling this projversor
 * renderer gives it: vector entries play as particles, scalar ones as a raster.
 */
export interface ProjversorLayer {
  /** Picker and share key: the entry's first alias, else its id. */
  id: string;
  /** zartigl catalog entry id. */
  entryId: string;
  kind: CatalogEntry["kind"];
  label: string;
  /** Catalog category: ocean, atmosphere, biology, freshwater… */
  category: string;
  /** Display name of the archive's provider, when the catalog names one. */
  provider?: string;
  /** Extent of the archive (west, south, east, north); unknown is global. */
  bounds?: CatalogBounds;
  /**
   * Style over the catalog entry's `defaults`, under a view's: always a
   * palette, one this renderer offers for the kind.
   */
  style: LayerStyleInput & { palette: string };
  /**
   * Default scalar entry id whose GeoVideo archive colors the particles (over
   * its catalog color domain); speed then sets their brightness. Its monthly
   * chunks pair with the vector ones by calendar period.
   */
  tint?: string;
}

/** What a layer changes of the base one made from its entry. */
type LayerLook = Partial<Omit<ProjversorLayer, "entryId" | "kind">>;

/**
 * Particle palettes over the catalog's, whose diverging defaults read as
 * signs rather than speeds. They start dark so the bright trails read against
 * the black background. Keyed by entry alias.
 */
const STYLES: Record<string, LayerLook> = {
  "wave-stokes-drift": { style: { palette: "viridis" } },
  "primary-swell-propagation": { style: { palette: "thermal" } },
  "med-wave-stokes-drift": { style: { palette: "viridis" } },
  "med-primary-swell-propagation": { style: { palette: "thermal" } },
};

/** Vector layers repeated with a default tint, after their plain layer. */
const TINTED: Record<string, LayerLook[]> = {
  "ocean-current-velocity": [
    {
      id: "ocean-velocity-temperature",
      label: "Currents × Temperature",
      // Starts bright: cold, slow water stays visible once dimmed by speed.
      style: { palette: "thermal-alt" },
      tint: "3db0120b-17d2-4789-9952-efcc0953ecc4", // sea-water-temperature
    },
  ],
  "med-ocean-current-velocity": [
    {
      id: "med-currents-temperature",
      label: "Mediterranean Currents × Temperature",
      style: { palette: "thermal-alt" },
      tint: "f0812aa5-f9b6-4149-ab51-3de9d9d100c3", // med-sea-water-temperature
    },
  ],
  "surface-wind": [
    {
      id: "surface-wind-temperature",
      label: "Wind × Air Temperature",
      style: { palette: "thermal-alt" },
      // CAMS 2 m temperature, from 2026: earlier months color by speed.
      tint: "b45b2598-c7c1-4367-a3c2-4acb9b31deba", // air-temperature-2m
    },
  ],
};

/** Particle palette of vector entries whose catalog palette does not fit. */
const PARTICLE_PALETTE = "plasma";

/**
 * Palettes offered for the particles: diverging and cyclic ramps carry no
 * meaning for a speed, and black trails vanish on the black background.
 */
export const PARTICLE_PALETTES: PaletteMeta[] = getPalettes().filter(
  (p) =>
    p.id !== "mono-black" &&
    !p.tags.includes("diverging") &&
    !p.tags.includes("cyclic"),
);

/** Palettes offered for a scalar raster: any but black. */
export const RASTER_PALETTES: PaletteMeta[] = getPalettes().filter(
  (p) => p.id !== "mono-black",
);

export function layerPalettes(layer: ProjversorLayer): PaletteMeta[] {
  return layer.kind === "vector" ? PARTICLE_PALETTES : RASTER_PALETTES;
}

function basePalette(entry: CatalogEntry): string {
  const palette = entry.defaults.palette;
  if (entry.kind === "scalar") {
    return palette ?? "viridis";
  }
  return PARTICLE_PALETTES.some((p) => p.id === palette)
    ? palette!
    : PARTICLE_PALETTE;
}

/**
 * Bounds the bundled catalog gives an entry, for a live catalog published
 * before it carried them.
 */
function bundledBounds(entryId: string): CatalogBounds | undefined {
  const entry = getCatalogEntry(entryId, bundledCatalog);
  return entry && entryBounds(entry);
}

/** Every catalog entry with a GeoVideo archive, vector layers first. */
export function catalogLayers(
  entries: readonly CatalogEntry[] = bundledCatalog.layers,
): ProjversorLayer[] {
  const ids = new Set(entries.map((e) => e.id));
  const layers: ProjversorLayer[] = [];
  for (const entry of entries) {
    const archive = entry.sources.find(isGeoVideoArchiveSource);
    if (!archive) {
      continue;
    }
    const id = entry.aliases?.[0] ?? entry.id;
    const provider = archive.provenance?.provider;
    const bounds = entryBounds(entry) ?? bundledBounds(entry.id);
    const base: ProjversorLayer = {
      id,
      entryId: entry.id,
      kind: entry.kind,
      label: resolveLocalizedText(entry.title, "en"),
      category: entry.category,
      ...(provider ? { provider: providerLabel(provider) } : {}),
      ...(bounds ? { bounds } : {}),
      style: { palette: basePalette(entry) },
      ...STYLES[id],
    };
    layers.push(base);
    // A preset whose tint left the catalog is dropped, not left uncolored.
    for (const tinted of TINTED[id] ?? []) {
      if (!tinted.tint || ids.has(tinted.tint)) {
        layers.push({ ...base, ...tinted });
      }
    }
  }
  return layers.sort(
    (a, b) => Number(a.kind === "scalar") - Number(b.kind === "scalar"),
  );
}

/** The catalog the layers come from: the bundled one until `loadLayers`. */
let layerCatalog: Catalog = bundledCatalog;

/**
 * Layers of the catalog in use, refilled in place by `loadLayers` so that
 * existing references see the live catalog.
 */
export const PROJVERSOR_LAYERS: ProjversorLayer[] = catalogLayers();

/** Scalar layers, any of which can color particles it covers. */
export const TINT_LAYERS: ProjversorLayer[] = PROJVERSOR_LAYERS.filter(
  (l) => l.kind === "scalar",
);

/** Use `data` for the layers, their lookups and their archives. */
export function useLayerCatalog(data: Catalog): ProjversorLayer[] {
  layerCatalog = data;
  const layers = catalogLayers(data.layers);
  PROJVERSOR_LAYERS.splice(0, PROJVERSOR_LAYERS.length, ...layers);
  TINT_LAYERS.splice(
    0,
    TINT_LAYERS.length,
    ...layers.filter((l) => l.kind === "scalar"),
  );
  return PROJVERSOR_LAYERS;
}

let loading: Promise<ProjversorLayer[]> | undefined;

/**
 * Switch the layers to zartigl's live catalog, so layers published since
 * this build appear; the bundled catalog stays when it cannot be read.
 * Loads once; later calls share the first.
 */
export function loadLayers(
  load: () => Promise<LoadedCatalog> = () => loadCatalog(),
): Promise<ProjversorLayer[]> {
  loading ??= load().then(({ catalog }) => useLayerCatalog(catalog));
  return loading;
}

/** Layer of a share key: a layer id, or the entry id older links carry. */
export function findLayer(
  key: string | undefined,
  layers: readonly ProjversorLayer[] = PROJVERSOR_LAYERS,
): ProjversorLayer | undefined {
  return (
    layers.find((l) => l.id === key) ?? layers.find((l) => l.entryId === key)
  );
}

const WORLD: CatalogBounds = [-180, -90, 180, 90];

/** Longitude span of bounds, the whole circle for (near) global ones. */
function lonSpan([west, , east]: CatalogBounds): [number, number] {
  return east - west >= 359 ? [-Infinity, Infinity] : [west, east];
}

/** Area on the sphere, up to a constant: longitudes × sine of latitudes. */
function area(bounds: CatalogBounds): number {
  const [west, east] = lonSpan(bounds);
  const lon = Number.isFinite(west) ? east - west : 360;
  const rad = Math.PI / 180;
  return lon * (Math.sin(bounds[3] * rad) - Math.sin(bounds[1] * rad));
}

function intersect(a: CatalogBounds, b: CatalogBounds): CatalogBounds | null {
  const [aw, ae] = lonSpan(a);
  const [bw, be] = lonSpan(b);
  const west = Math.max(aw, bw);
  const east = Math.min(ae, be);
  const south = Math.max(a[1], b[1]);
  const north = Math.min(a[3], b[3]);
  if (west >= east || south >= north) {
    return null;
  }
  const lon: [number, number] = Number.isFinite(west)
    ? [west, east]
    : [-180, 180];
  return [lon[0], south, lon[1], north];
}

/** Share of `inner` that `outer` covers, by area on the sphere. */
export function coverage(outer: CatalogBounds, inner: CatalogBounds): number {
  const both = intersect(outer, inner);
  return both ? area(both) / area(inner) : 0;
}

/** Least share of a flow a tint must cover to be offered. */
const MIN_COVERAGE = 0.5;
/** A tint up to this many times the flow's area is regional to it. */
const REGIONAL = 4;

/**
 * What a catalog category describes: a grid that covers a place in its bounds
 * may still hold no value there (an ocean field over a lake).
 */
const MEDIUM: Record<string, string> = {
  ocean: "sea",
  waves: "sea",
  ice: "sea",
  biology: "sea",
  coast: "sea",
  freshwater: "lake",
  land: "land",
  atmosphere: "air",
};

const medium = (layer: ProjversorLayer) =>
  MEDIUM[layer.category] ?? layer.category;

/**
 * Whether a tint describes what the flow moves through: the same medium, or
 * the air above any; winds take any medium below them.
 */
function sameMedium(flow: ProjversorLayer, tint: ProjversorLayer): boolean {
  const [f, t] = [medium(flow), medium(tint)];
  return f === t || f === "air" || t === "air";
}

/**
 * Scalar layers that can color the particles of `layer`: those of its medium
 * (or the air) covering at least half of it, regional ones first (Lake Geneva
 * temperature before global air fields), then in catalog order.
 */
export function tintLayersFor(
  layer: ProjversorLayer,
  tints: readonly ProjversorLayer[] = TINT_LAYERS,
): ProjversorLayer[] {
  if (layer.kind !== "vector") {
    return [];
  }
  const flow = layer.bounds ?? WORLD;
  const flowArea = area(flow);
  return tints
    .filter(
      (t) =>
        sameMedium(layer, t) &&
        coverage(t.bounds ?? WORLD, flow) >= MIN_COVERAGE,
    )
    .map((t, index) => ({
      t,
      index,
      regional: area(t.bounds ?? WORLD) <= REGIONAL * flowArea,
    }))
    .sort(
      (a, b) => Number(b.regional) - Number(a.regional) || a.index - b.index,
    )
    .map(({ t }) => t);
}

/** Whether the scalar entry `entryId` can color the particles of `layer`. */
export function isTintFor(
  layer: ProjversorLayer,
  entryId: string | undefined,
): entryId is string {
  return tintLayersFor(layer).some((l) => l.entryId === entryId);
}

/** Catalog entry of a layer, from the catalog the layers come from. */
export function layerEntry(layer: ProjversorLayer): CatalogEntry {
  return requireCatalogEntry(layer.entryId, layerCatalog);
}

/** Month chunks of an entry's GeoVideo archive. */
export async function loadChunks(
  entryId: string,
  loadIndex = loadGeoVideoIndex,
): Promise<CatalogGeoVideoSource[]> {
  const entry = requireCatalogEntry(entryId, layerCatalog);
  const source = entry.sources.find(isGeoVideoArchiveSource);
  if (!source) {
    throw new Error(`No GeoVideo archive for ${entry.id}`);
  }
  return geoVideoChunkSources(source, await loadIndex(source.indexUrl), entry);
}

/**
 * Month chunks of a tint archive; empty without a tint or when its index
 * cannot be read, so the layer still opens, colored by speed.
 */
export async function loadTintChunks(
  entryId: string | null | undefined,
  loadIndex = loadGeoVideoIndex,
): Promise<CatalogGeoVideoSource[]> {
  if (!entryId) {
    return [];
  }
  try {
    return await loadChunks(entryId, loadIndex);
  } catch (error) {
    console.error(error);
    return [];
  }
}

/**
 * Warm the HTTP cache with a layer's archive index and the manifest of the
 * month holding `at`, else the latest, so opening it later starts sooner.
 */
export async function preloadLayer(source: string, at?: number): Promise<void> {
  const layer = findLayer(source);
  if (!layer) {
    return;
  }
  const chunks = await loadChunks(layer.entryId);
  const chunk =
    (at === undefined
      ? undefined
      : chunks.find((c) => sourceCoversTime(c, { time: at }))) ??
    chunks[chunks.length - 1];
  if (chunk) {
    await loadGeoVideoManifest(chunk.manifestUrl);
  }
}

/** Whether `id` is the catalog entry of a scalar layer that can tint particles. */
export function isTintEntry(id: string | undefined): id is string {
  return TINT_LAYERS.some((l) => l.entryId === id);
}

/**
 * Text a layer search matches: its key, label, category, provider, and its
 * entry's aliases, tags and description, lowercased.
 */
export function layerSearchText(layer: ProjversorLayer): string {
  const entry = getCatalogEntry(layer.entryId, layerCatalog);
  return [
    layer.id,
    layer.label,
    layer.category,
    layer.provider,
    ...(entry?.aliases ?? []),
    ...(entry?.tags ?? []),
    resolveLocalizedText(entry?.title, "en"),
    resolveLocalizedText(entry?.description, "en"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
