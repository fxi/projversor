# projversor

Catalog data on a sphere that morphs between world projections (globe,
Equal Earth, Mollweide, polar…), for standalone pages and stories.
GeoVideo archives play as particles or rasters, with small GeoJSON and
georeferenced images on top. Rendering primitives and the catalog come from
[zartigl](https://github.com/fxi/zartigl) (`@fxi/zartigl/engine`,
`/catalog`, `/story`); projversor never touches MapLibre. In MapX, use
zartigl's MapLibre layer instead.

## Install

```bash
npm install @fxi/projversor
```

An ES module with its types. `@fxi/zartigl` and d3 stay dependencies, so a
page that also imports zartigl loads it once; the detailed coastlines load on
demand.

## API

```ts
import { Projversor } from "@fxi/projversor";

const pv = new Projversor(root, {
  preset: "globe", // projection preset; also rotate, zoom
  time: Date.parse("2025-03-15"), // playhead; default the latest month
  playing: true,
  interactive: true, // drag, pinch, wheel
  colors: { ocean: "#111d23" }, // over the css custom properties
  waitForLandDetail: true, // false: init() resolves before the 50m coastline
});
await pv.init(); // canvases in root, WebGL2; rejects without it

const currents = await pv.add("currents", "particles", {
  source: "ocean-current-velocity", // projversor layer id or catalog entry id
  tint: null, // particles colored by speed; or a scalar entry id
  style: { palette: "viridis" },
});
await pv.add("sst", "scalar", {
  source: "sea-water-temperature",
  timeRange: { start: "2026-05-01", end: "2026-10-31" }, // as zartigl's
});
await pv.add("photo", "image", {
  image: "https://example.org/map.png", // or a loaded image or canvas
  bounds: [120, -30, 240, 30], // west, south, east, north
  style: { opacity: 0.8 },
});
await pv.add("regions", "geojson", { data, style: { label: "name" } });

await currents.update({ particles: { density: 0.5 } }); // style override
await pv.replace("currents", "particles", { source: "surface-wind" });
await pv.update({ preset: "world", time, playing: false, speed: 2 });
pv.view.zoomBy(1.5); // goTo, rotateBy, setInset, outline, northAngle…
pv.on("month", ({ id, month }) => {}); // also status, palette, playing,
// preset, north, frame
await pv.remove("sst");
pv.destroy();
```

- **Layers.** Fields and images draw in the order added; GeoJSON (lines,
  fill, points with `radius`, labels) always above them. One particles
  layer at a time.
- **Views.** `goTo` onto the view already shown, and `setInset` to the
  current inset, do nothing: construct with the first view's `preset`,
  `rotate` and `zoom` to open on it without a morph.
- **Time.** One playhead. The first field layer drives it through its
  months; the others follow and load their own months. Its `timeRange`, the
  same as zartigl's (`{ start?, end? }` or `{ trailing: "P6M" }`), loops
  playback over that window instead of the whole archive; `null` clears it.
  Share links carry it as `tr=2026-05-01/2026-10-31` or `tr=P6M`.
- **`replace`** switches a layer's source, tint or style in place: the shown
  layer stays until the new month is decoded. A later call supersedes one
  still loading; a failed one keeps the shown layer.
- **Look.** Three canvases: ocean and land below, WebGL data in between,
  graticule, coastlines and GeoJSON above. Colors come from the css custom
  properties `--ocean`, `--land`, `--coast`, `--graticule`, `--equator` and
  `--outline`, read at `init()`; `colors` (option or `update`) overrides
  them at any time.
- **Stories.** `ProjversorStoryView` adapts a projversor to the
  `@fxi/zartigl/story` registry; a view config may carry a `geojson`
  and a `timeRange`.

## Development

zartigl comes from npm. To work on both at once, link the sibling
repository, then reinstall to return to the npm version:

```bash
npm run --prefix ../zartigl build:lib && npm link ../zartigl
npm install
```

```bash
npm test                # unit tests
npm run quality         # prettier, eslint, tsc
npm run build:lib       # dist/: the published package
npm run test:browser    # reference renders and app smoke tests
npm run dev:explorer    # also dev:story, dev:site, dev:minimal
```

Apps: `apps/explorer` (every catalog layer on the sphere), `apps/story` (a
story), `apps/site` (home page with a scroll story) and `apps/minimal` (sea
surface temperature anomaly and the Niño regions, the smallest page).
`npm run dev:explorer` and the like serve each one; `npm run build:apps`
builds them all into `dist-apps/<name>/`.

## Docker

The image serves the apps with nginx on port 8080: the explorer at `/`,
the story at `/story/`, the site at `/site/` and the minimal page at
`/minimal/` (`/healthz` for health checks).

```bash
docker compose up -d --build   # from this folder; open http://localhost:8080
docker compose pull && docker compose up -d   # the published image
```

CI publishes `ghcr.io/fxi/projversor` from `main` (`latest`) and from `v*`
tags.

The same apps are published to GitHub Pages from `main`
(`https://fxi.github.io/projversor/`, `story/`, `site/`, `minimal/`).

## Releases

```bash
npm run release:minor   # or release:patch, release:major
```

`npm version` bumps `package.json`, commits and tags `vX.Y.Z`, then the
script pushes `main` with the tag. The tag publishes the package to npm
(`publish.yml`, after quality, tests and `build:lib`) and the app image.
