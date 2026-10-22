# projversor

Catalog data on a sphere that morphs between world projections (globe,
Equal Earth, Mollweide, polar…), for standalone pages and stories.
GeoVideo archives play as particles or rasters, with small GeoJSON and
georeferenced images on top. Rendering primitives and the catalog come from
[zartigl](https://github.com/fxi/zartigl) (`@fxi/zartigl/engine`,
`/catalog`, `/story`); projversor never touches MapLibre. In MapX, use
zartigl's MapLibre layer instead.

## API

```ts
import { Projversor } from "@fxi/projversor";

const pv = new Projversor(root, {
  preset: "globe", // projection preset; also rotate, zoom
  time: Date.parse("2025-03-15"), // playhead; default the latest month
  playing: true,
  interactive: true, // drag, pinch, wheel
  colors: { ocean: "#111d23" }, // over the css custom properties
});
await pv.init(); // canvases in root, WebGL2; rejects without it

const currents = await pv.add("currents", "particles", {
  source: "ocean-current-velocity", // projversor layer id or catalog entry id
  tint: null, // particles colored by speed; or a scalar entry id
  style: { palette: "viridis" },
});
await pv.add("sst", "scalar", { source: "sea-water-temperature" });
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
  fill, labels) always above them. One particles layer at a time.
- **Time.** One playhead. The first field layer drives it through its
  months; the others follow and load their own months.
- **`replace`** switches a layer's source, tint or style in place: the shown
  layer stays until the new month is decoded. A later call supersedes one
  still loading; a failed one keeps the shown layer.
- **Look.** Three canvases: ocean and land below, WebGL data in between,
  graticule, coastlines and GeoJSON above. Colors come from the css custom
  properties `--ocean`, `--land`, `--coast`, `--graticule`, `--equator` and
  `--outline`, read at `init()`; `colors` (option or `update`) overrides
  them at any time.
- **Stories.** `ProjversorStoryView` adapts a projversor to the
  `@fxi/zartigl/story` registry; a view config may carry a `geojson`.

## Development

zartigl is a sibling repository (`file:../zartigl`): build it first.

```bash
npm run build:zartigl
npm test                # unit tests
npm run typecheck
npm run test:browser    # reference renders and demo smoke tests
npm run dev:projection  # also dev:story, dev:site
```

Demos: `demos/projection` (explorer), `demos/story` (a story) and
`demos/site` (home page with a scroll story).
