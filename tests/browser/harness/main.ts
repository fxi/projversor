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

async function until(test: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!test()) {
    if (Date.now() - start > 60_000) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function canvas(stage: HTMLElement): HTMLCanvasElement {
  const c = stage.ownerDocument.createElement("canvas");
  c.style.cssText = "position: absolute; inset: 0; width: 100%; height: 100%";
  stage.append(c);
  return c;
}

/**
 * Render a scene deterministically: open it paused at `TIME` (the open
 * resolves once the frame at the playhead is decoded), wait for the
 * detailed coastlines, then run a fixed number of frames on a manual clock,
 * each on its own task, and the frames of a morph.
 */
async function render(
  scene: Scene,
  stage: HTMLElement,
): Promise<HarnessResult> {
  Math.random = seededRandom(SEED);
  const clock = new FrameClock(window);
  const { Projversor, TRANSITION_MS } = await import("@under-test");
  const p = new Projversor(
    { stage, back: canvas(stage), gl: canvas(stage), front: canvas(stage) },
    { playing: false },
  );
  // The detailed coastlines load after construction, with no public signal:
  // observe the private overlay so every capture uses them.
  const overlay = (
    p as unknown as { overlay: { setLandDetail(f: unknown): void } }
  ).overlay;
  const setLandDetail = overlay.setLandDetail.bind(overlay);
  let detailed = false;
  overlay.setLandDetail = (feature) => {
    setLandDetail(feature);
    detailed = true;
  };
  await p.apply(
    { layer: scene.layer, preset: scene.preset, time: TIME, playing: false },
    { animate: false },
  );
  if (p.time !== TIME) {
    throw new Error(`Playhead ${p.time} is not the scene time ${TIME}`);
  }
  await until(() => detailed, "detailed coastlines");
  for (let i = 0; i < SETTLE_FRAMES; i++) {
    clock.frame();
    await nextTask();
  }
  if (scene.morph) {
    p.goTo({ preset: scene.morph.preset, durationMs: TRANSITION_MS });
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
