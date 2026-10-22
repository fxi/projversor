import { FrameClock, nextTask } from "./clock";
import { SCENES, SEED, SETTLE_FRAMES, TIME, type Scene } from "./scenes";

/** Results the spec reads from `document.body.dataset`. */
export interface HarnessResult {
  /** Frames run before the capture. */
  frames: number;
}

/** mulberry32: a small seeded generator standing in for `Math.random`. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Render a scene deterministically through the public API: open it paused
 * at `TIME` (`init` resolves once the detailed coastlines are in use, `add`
 * once the frame at the playhead is decoded), then run a fixed number of
 * frames on a manual clock, each on its own task, and the frames of a morph.
 */
async function render(
  scene: Scene,
  stage: HTMLElement,
): Promise<HarnessResult> {
  Math.random = seededRandom(SEED);
  const clock = new FrameClock(window);
  const { Projversor, TRANSITION_MS } = await import("@under-test");
  const pv = new Projversor(stage, {
    preset: scene.preset,
    rotate: scene.rotate,
    zoom: scene.zoom,
    time: TIME,
    playing: false,
  });
  await pv.init();
  await pv.add("scene", scene.type, { source: scene.layer });
  if (scene.geojson) {
    await pv.add("regions", "geojson", scene.geojson);
  }
  if (pv.time !== TIME) {
    throw new Error(`Playhead ${pv.time} is not the scene time ${TIME}`);
  }
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    clock.frame();
    await nextTask();
  }
  if (scene.morph) {
    await pv.update({
      preset: scene.morph.preset,
      durationMs: TRANSITION_MS,
    });
    for (let i = 0; i < scene.morph.frames; i++) {
      clock.frame();
      await nextTask();
    }
  }
  return { frames: clock.frames };
}

const root = document.body;
const stage = root.querySelector<HTMLElement>("[data-ref=stage]")!;
const id = new URLSearchParams(location.search).get("scene");
const scene = SCENES.find((s) => s.id === id);
if (!scene) {
  root.dataset.error = `Unknown scene: ${id}`;
} else {
  render(scene, stage).then(
    (result) => {
      root.dataset.result = JSON.stringify(result);
      root.dataset.ready = "true";
    },
    (error: unknown) => {
      root.dataset.error =
        error instanceof Error ? error.message : String(error);
      console.error(error);
    },
  );
}
