# Reference renders

`reference.spec.ts` renders fixed scenes (`harness/scenes.ts`) and compares
each with its baseline **with no tolerance**. The baselines were captured
from the historical renderer, zartigl `src/projversor` at the commit before
the move, and this repository reproduces them pixel for pixel. Any change to
the rendering, even a 1 % change of the trail fade, fails.

```bash
npm run build:zartigl   # the code under test imports zartigl's dist
npm run test:browser
```

Needs Google Chrome (GeoVideo is H.264) and network access (public archives
read at a fixed past time). WebGL2 runs on SwiftShader, so captures do not
depend on the GPU. Baselines are macOS captures (`*-darwin.png`).

The harness (`harness/`) opens a scene paused at `TIME`, seeds
`Math.random`, waits for the detailed coastlines, then runs a fixed number
of frames on a manual clock (`clock.ts`), so every run draws the same
frames.

## Updating the baselines

Only for an intended rendering change, after checking it by eye. To capture
from another copy of the renderer, point the harness at its entry:

```bash
PROJVERSOR_UNDER_TEST=/abs/path/to/src/projversor/index.ts npm run test:browser:update
```
