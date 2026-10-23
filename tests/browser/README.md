# Browser tests

```bash
npm run test:browser
```

Needs Google Chrome (GeoVideo is H.264) and network access (public
archives). WebGL2 runs on SwiftShader, so captures do not depend on the GPU.
Baselines are macOS captures (`*-darwin.png`).

## Reference renders

`reference.spec.ts` renders fixed scenes (`harness/scenes.ts`) through the
public API and compares each with its baseline **with no tolerance**: any
change to the rendering, even a 1 % change of the trail fade, fails.

The first baselines were the historical renderer's own pixels (zartigl
`src/projversor` before the move), reproduced exactly after it. Since then
they changed only on purpose, each time checked by eye: land drawn below the
fields, the Niño regions (GeoJSON) and an image across the antimeridian.

The harness (`harness/`) opens a scene paused at `TIME` (archives read at a
fixed past time), seeds `Math.random`, waits for `init()` (detailed
coastlines) and `add()` (decoded frame), then runs a fixed number of frames
on a manual clock (`clock.ts`), so every run draws the same frames.

## Demo smoke tests

`demos.spec.ts` opens each demo on its own Vite server (ports in
`playwright.config.ts`), on its live clock, and waits until its first layer
shows, with no console or page error. Their playback is not deterministic,
so they are not captured.

## Updating the baselines

Only for an intended rendering change, after checking it by eye:

```bash
npm run test:browser:update
```

`PROJVERSOR_UNDER_TEST=/abs/path/to/index.ts` renders another copy of
projversor with the same harness (it must expose the same API).
