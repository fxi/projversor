import {
  LoadingIndicator,
  StoryScroller,
  parseStoryDocuments,
  sceneNumbers,
  sceneViewId,
  storyExternalLinkAttributes,
  type StoryCopyBlock,
  type StoryDocument,
  type StoryScene,
  type StoryViewDefinition,
  type StoryViewsDocument,
  type StoryWidgetBlock,
} from "@fxi/story/browser";
import { catalogLink, loadCatalog, type Catalog } from "@fxi/zartigl/catalog";
import type { ProjversorMonth } from "../FieldLayer";
import { Projversor } from "../Projversor";
import { monthLegend, rampGradient } from "../scales";
import { ProjversorStoryView, parseProjversorView } from "../storyView";
import type { Inset } from "../view";
import {
  asInstance,
  type StoryText,
  type StoryWidget,
  type StoryWidgetContext,
  type StoryWidgetInstance,
} from "./widgets";
import {
  mountLegend,
  parseLegendConfig,
  parseSeriesData,
  type LegendConfig,
} from "./legend";
import { mountDeepLink, sceneFromHash } from "./deeplink";
import { paragraphs } from "./paragraphs";
import { mountProgress, stepProgress, type StepLabels } from "./progress";

/**
 * Scene layouts of a scroll story: the side the text takes beside the
 * sphere, or `stage`, no text: the view takes the screen.
 */
export const STORY_LAYOUTS = ["intro", "left", "right", "stage"] as const;
export type StoryLayout = (typeof STORY_LAYOUTS)[number];

/** Below this width, the text runs under the sphere instead of beside it. */
const WIDE_MIN = 900;
/** Activation line, from the top of the viewport. */
const LINE = 0.6;
const EASE = "cubic-bezier(.16,1,.3,1)";

/**
 * Free zone of the sphere for a scene layout, css px: beside the text on
 * wide screens, above it on narrow ones.
 */
export function sceneInset(
  layout: string,
  width: number,
  height: number,
  /** Height of the site header over the stage, css px. */
  header = 0,
  /** A stage scene has a widget beside its view, e.g. a chart. */
  aside = false,
): Inset {
  if (layout === "stage") {
    // The view over the screen, under the header and above the key; a
    // widget takes the right column, or the bottom on phones, where the
    // key runs under the header.
    if (width < WIDE_MIN) {
      return {
        top: header + 72,
        right: 28,
        bottom: aside ? Math.round(height * 0.4) : 16,
        left: 8,
      };
    }
    return {
      top: header + 20,
      right: aside ? Math.round(Math.min(width * 0.4, 620)) : 76,
      bottom: 110,
      left: 32,
    };
  }
  if (width < WIDE_MIN) {
    return { top: 0, right: 0, bottom: Math.round(height * 0.3), left: 0 };
  }
  const side = Math.round(Math.min(width * 0.42, 560));
  if (layout === "left") {
    return { top: 0, right: 0, bottom: 0, left: side };
  }
  if (layout === "right") {
    return { top: 0, right: side, bottom: 0, left: 0 };
  }
  return { top: Math.round(height * 0.42), right: 0, bottom: 0, left: 0 };
}

async function fetchJson(url: URL, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`${url.pathname}: HTTP ${response.status}`);
  }
  return response.json();
}

export interface StoryDocuments {
  story: StoryDocument;
  views: StoryViewsDocument;
}

/** Validate story documents against the layouts this mount renders. */
export function parseStory(story: unknown, views: unknown): StoryDocuments {
  return parseStoryDocuments(story, views, { layouts: STORY_LAYOUTS });
}

/** Load and validate a story folder: `story.json` and `views.json`. */
export async function loadStory(
  folder: URL,
  signal?: AbortSignal,
): Promise<StoryDocuments> {
  const [story, views] = await Promise.all([
    fetchJson(new URL("story.json", folder), signal),
    fetchJson(new URL("views.json", folder), signal),
  ]);
  return parseStory(story, views);
}

/** The widget blocks of a scene, without its legend block. */
function sceneWidgets(scene: StoryScene): StoryWidgetBlock[] {
  return scene.blocks.filter(
    (block): block is StoryWidgetBlock =>
      block.type === "widget" && block.widget !== LEGEND,
  );
}

/** The `legend` block of a scene: what the colors of its map mean. */
const LEGEND = "legend";

export function sceneLegend(scene: StoryScene): LegendConfig | null {
  const block = scene.blocks.find(
    (b): b is StoryWidgetBlock => b.type === "widget" && b.widget === LEGEND,
  );
  return block ? parseLegendConfig(block.config) : null;
}

/** Fraction the sphere keeps behind a scene's stage widget; 0 hides it. */
function stageDim(scene: StoryScene): number | null {
  const block = sceneWidgets(scene).find((b) => b.slot === "stage");
  if (!block) {
    return null;
  }
  const dim = block.config?.dim;
  return typeof dim === "number" && dim >= 0 && dim <= 1 ? dim : 0.16;
}

function sceneCopy(scene: StoryScene): StoryCopyBlock | undefined {
  return scene.blocks.find(
    (block): block is StoryCopyBlock => block.type === "copy",
  );
}

/**
 * Whether a scene continues the chapter of the scene before it: both have a
 * copy block with the same heading in the page language. Not the opening.
 */
export function sceneContinues(
  previous: StoryScene | undefined,
  scene: StoryScene,
  text: (value: StoryCopyBlock["heading"]) => string,
): boolean {
  const before = previous && sceneCopy(previous);
  const copy = sceneCopy(scene);
  return Boolean(
    before &&
      copy &&
      text(before.heading) !== "" &&
      text(before.heading) === text(copy.heading),
  );
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A headline with one masked span per word, for the reveal. */
function headline(doc: Document, tag: "h1" | "h2", text: string): HTMLElement {
  const el = doc.createElement(tag);
  el.className = "zs-headline";
  el.setAttribute("aria-label", text);
  text
    .split(/\s+/)
    .filter(Boolean)
    .forEach((word, i) => {
      if (i > 0) {
        el.append(" ");
      }
      const mask = doc.createElement("span");
      mask.className = "zs-w";
      mask.setAttribute("aria-hidden", "true");
      const inner = doc.createElement("span");
      inner.textContent = word;
      mask.append(inner);
      el.append(mask);
    });
  return el;
}

/** Widget hosts of one mount, by block: no lookup by id, which may repeat. */
type WidgetHosts = Map<StoryWidgetBlock, HTMLElement>;

/** The element a widget block fills, kept in `hosts` for mounting. */
function widgetHost(
  doc: Document,
  block: StoryWidgetBlock,
  hosts: WidgetHosts,
): HTMLElement {
  const host = doc.createElement("div");
  host.className = "zs-widget";
  host.dataset.widget = block.widget;
  host.dataset.block = block.id;
  hosts.set(block, host);
  return host;
}

/**
 * Catalog id of a scene's map: its view's `layer` when it names one, else
 * the view id. Null for a scene without a view.
 */
export function sceneCatalogId(
  scene: StoryScene,
  viewById: ReadonlyMap<string, StoryViewDefinition>,
): string | null {
  const id = sceneViewId(scene);
  if (!id) {
    return null;
  }
  const layer = viewById.get(id)?.config.layer;
  return typeof layer === "string" ? layer : id;
}

/**
 * Link to the methodology page of a layer, from the catalog: undefined when
 * the layer or its page is unknown, so the scene shows no link.
 */
export function methodLink(
  id: string | null,
  catalog: Catalog,
): string | undefined {
  return id ? catalogLink(id, "documentation", catalog) : undefined;
}

/** Methodology link of a step: hidden until the catalog gives its page. */
interface StepMethod {
  label: string;
  href: Promise<string | undefined>;
}

function renderStep(
  doc: Document,
  story: StoryDocument,
  scene: StoryScene,
  index: number,
  /** Display number; null for a prelude scene. */
  displayNumber: number | null,
  t: StoryText,
  hosts: WidgetHosts,
  method?: StepMethod,
): HTMLElement {
  const step = doc.createElement("article");
  step.className = "zs-step";
  step.dataset.layout = scene.layout;
  step.dataset.scene = scene.id;
  const text = doc.createElement("div");
  text.className = "zs-text";
  const copy = sceneCopy(scene);
  if (scene.layout === "stage") {
    // No text on screen: the view is the scene. Its name, for screen readers.
    const name = doc.createElement("h2");
    name.className = "zs-sr";
    name.textContent = copy ? t.text(copy.heading) : t.text(scene.name);
    text.append(name);
    step.append(text);
    return step;
  }

  // A prelude scene (`role: "prelude"`) has no kicker and no number.
  if (displayNumber !== null) {
    const kicker = doc.createElement("p");
    kicker.className = "zs-kicker";
    const number = doc.createElement("span");
    number.className = "zs-index";
    number.textContent = pad(displayNumber);
    const rule = doc.createElement("span");
    rule.className = "zs-rule";
    kicker.append(number, rule);
    if (copy?.label) {
      kicker.append(t.text(copy.label));
    }
    text.append(kicker);
  }
  // A scene under the previous one's heading continues its chapter: the
  // heading steps back and the kicker reads as the subtitle.
  if (sceneContinues(story.scenes[index - 1], scene, t.text)) {
    step.classList.add("is-continued");
  }
  text.append(
    headline(
      doc,
      index === 0 ? "h1" : "h2",
      copy ? t.text(copy.heading) : t.text(scene.name),
    ),
  );
  if (copy?.text) {
    for (const paragraph of paragraphs(t.text(copy.text))) {
      const lede = doc.createElement("p");
      lede.className = "zs-lede";
      lede.textContent = paragraph;
      text.append(lede);
    }
  }
  // How the map's data was made, under the text.
  const basis = sceneLegend(scene)?.basis;
  if (basis) {
    const note = doc.createElement("p");
    note.className = "zs-basis";
    note.textContent = t.text(basis);
    text.append(note);
  }
  // Its methodology page, once the catalog resolves it; the view never waits.
  if (method) {
    const p = doc.createElement("p");
    p.className = "zs-method";
    p.hidden = true;
    const a = doc.createElement("a");
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = method.label;
    p.append(a);
    text.append(p);
    method.href.then(
      (href) => {
        if (href) {
          a.href = href;
          p.hidden = false;
        }
      },
      () => {},
    );
  }
  const references = copy?.references ?? [];
  if (references.length) {
    const source = doc.createElement("p");
    source.className = "zs-source";
    references.forEach((reference, i) => {
      if (i > 0) {
        source.append(" · ");
      }
      const a = doc.createElement("a");
      Object.assign(
        a,
        storyExternalLinkAttributes(reference, t.text(reference.label)),
      );
      source.append(a);
    });
    text.append(source);
  }
  const theme = story.themes[scene.theme];
  if (theme) {
    step.style.setProperty("--zs-accent", theme.accent);
  }
  step.append(text);
  // Copy widgets close the text column; the others run along the top of
  // their step, out of it.
  // Stage widgets live in the stage, out of the steps: see mountStory.
  const band = doc.createElement("div");
  band.className = "zs-band";
  for (const block of sceneWidgets(scene)) {
    if (block.slot === "stage") {
      continue;
    }
    (block.slot === "copy" ? text : band).append(widgetHost(doc, block, hosts));
  }
  if (band.childElementCount) {
    step.prepend(band);
  }
  return step;
}

/** Words rise through their masks, then the rest fades in. */
function reveal(step: HTMLElement): void {
  step.querySelectorAll<HTMLElement>(".zs-w > span").forEach((el, i) => {
    el.animate(
      [{ transform: "translateY(105%)" }, { transform: "translateY(0)" }],
      { duration: 900, delay: 120 + i * 55, easing: EASE, fill: "backwards" },
    );
  });
  const parts: [string, number][] = [
    [".zs-kicker", 0],
    [".zs-lede", 380],
    [".zs-source", 520],
    [".zs-text > .zs-widget", 640],
  ];
  for (const [selector, delay] of parts) {
    step.querySelectorAll(selector).forEach((el) => {
      el.animate(
        [
          { opacity: 0, transform: "translateY(10px)" },
          { opacity: 1, transform: "none" },
        ],
        { duration: 700, delay, easing: EASE, fill: "backwards" },
      );
    });
  }
  step
    .querySelector(".zs-rule")
    ?.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
      duration: 900,
      easing: EASE,
      fill: "backwards",
    });
}

export interface StoryLabels {
  loading: string;
  scroll: string;
  /** Names of the buttons at the ends of the progress line. */
  steps: StepLabels;
  /** Names of the legend band and of its timeline slider. */
  key: string;
  timeline: string;
  /** Name of the link to a layer's methodology page. */
  method: string;
}

export interface MountStoryOptions<T extends StoryText = StoryText> {
  /** A story folder (`story.json`, `views.json`), or documents already parsed. */
  source: URL | StoryDocuments;
  /**
   * Files named by widgets and legends resolve under it. Defaults to the
   * folder of `source`.
   */
  contentUrl?: URL;
  t: T;
  labels: StoryLabels;
  /** Widgets by the `widget` name of a story block; `legend` is built in. */
  widgets?: Readonly<Record<string, StoryWidget<T>>>;
  /** Keep the current scene in the url hash, and open on the hashed one. */
  deepLink?: boolean;
}

export interface MountedStory {
  /** Settles once the first view shows; rejects if it cannot. */
  ready: Promise<void>;
  destroy(): void;
}

/** @deprecated Kept for the old option names; use `MountStoryOptions`. */
interface StorySlotOptions {
  t: StoryText;
  loadingLabel: string;
  scrollLabel: string;
  /** Names of the buttons at the ends of the progress line. */
  stepLabels: StepLabels;
  /** Names of the legend band and of its timeline slider. */
  keyLabel: string;
  timelineLabel: string;
  /** Name of the link to a layer's methodology page. */
  methodLabel: string;
  /** Keep the current scene in the url hash, and open on the hashed one. */
  deepLink?: boolean;
}

/**
 * A scroll story: one sticky projversor sphere behind the text, a veil on
 * the text side and a chapter rail. The step crossing the activation line
 * drives the view and replays its reveal; the sphere pauses when the story
 * is off screen or the tab hidden. Throws when WebGL2 is missing, before
 * anything is attached.
 */
export async function mountStory<T extends StoryText>(
  host: HTMLElement,
  mountOptions: MountStoryOptions<T>,
): Promise<MountedStory> {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  const abort = new AbortController();
  const { labels } = mountOptions;
  // A folder URL without its trailing slash would resolve files in its parent.
  const source =
    mountOptions.source instanceof URL
      ? asFolder(mountOptions.source)
      : mountOptions.source;
  const { story, views } =
    source instanceof URL ? await loadStory(source, abort.signal) : source;
  // Parsed documents without a contentUrl: widget files resolve against the
  // page's base URL.
  const contentUrl = mountOptions.contentUrl
    ? asFolder(mountOptions.contentUrl)
    : source instanceof URL
      ? source
      : new URL(doc.baseURI);
  const hosts: WidgetHosts = new Map();
  const widgetsByName = mountOptions.widgets ?? {};
  // The body below predates the option object: same names, one place.
  const options: StorySlotOptions = {
    t: mountOptions.t,
    loadingLabel: labels.loading,
    scrollLabel: labels.scroll,
    stepLabels: labels.steps,
    keyLabel: labels.key,
    timelineLabel: labels.timeline,
    methodLabel: labels.method,
    deepLink: mountOptions.deepLink,
  };
  const numbers = sceneNumbers(story);
  const viewById = new Map(views.views.map((view) => [view.id, view]));
  const viewOf = (scene: StoryScene): StoryViewDefinition | undefined => {
    const id = sceneViewId(scene);
    return id ? viewById.get(id) : undefined;
  };
  const reduced = Boolean(
    win?.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const root = doc.createElement("section");
  root.className = "zs-story";
  root.setAttribute("aria-label", options.t.text(story.title));
  const stage = doc.createElement("div");
  stage.className = "zs-stage";
  const veil = doc.createElement("div");
  veil.className = "zs-veil";
  const status = doc.createElement("p");
  status.className = "zs-status";
  status.setAttribute("role", "status");
  const steps = doc.createElement("div");
  steps.className = "zs-steps";
  // The live catalog, once per story: falls back to the bundled one.
  const catalog = loadCatalog().then((loaded) => loaded.catalog);
  const stepEls = story.scenes.map((scene, i) =>
    renderStep(
      doc,
      story,
      scene,
      i,
      numbers.get(scene.id) ?? null,
      options.t,
      hosts,
      {
        label: options.methodLabel,
        href: catalog.then((data) =>
          methodLink(sceneCatalogId(scene, viewById), data),
        ),
      },
    ),
  );
  steps.append(...stepEls);
  // Chapter progress, with the scroll invitation on the first step.
  const progress = mountProgress(doc, {
    names: story.scenes.map((scene) => options.t.text(scene.name)),
    numbers: story.scenes.map((scene) => numbers.get(scene.id) ?? null),
    steps: stepEls,
    line: LINE,
    reduced,
    label: options.t.text(story.title),
    scrollLabel: options.scrollLabel,
    stepLabels: options.stepLabels,
  });
  // Stage widgets take the free side of the sphere while their scene is on.
  const stageWidgets = doc.createElement("div");
  stageWidgets.className = "zs-stage-widgets";
  const stageHosts = story.scenes.map((scene) =>
    sceneWidgets(scene)
      .filter((block) => block.slot === "stage")
      .map((block) => {
        const host = widgetHost(doc, block, hosts);
        host.classList.add("zs-stage-widget");
        // Placed by its own scene's layout, not the story's current one.
        host.dataset.layout = scene.layout;
        stageWidgets.append(host);
        return host;
      }),
  );
  const legends = story.scenes.map(sceneLegend);
  stage.append(veil, stageWidgets, progress.element, status);
  root.append(stage, steps);

  // Attached first: the overlay reads its colors from the computed style.
  // Rejects without WebGL2: the caller then shows the fallback slot.
  host.append(root);
  // A hashed scene opens in place: its step, then its view.
  const ids = story.scenes.map((scene) => scene.id);
  const start =
    options.deepLink && win
      ? Math.max(0, sceneFromHash(win.location.hash, ids))
      : 0;
  if (start > 0) {
    stepEls[start].scrollIntoView({ block: "center" });
  }
  // Opens on the starting scene's view: no morph from a default globe.
  const first = viewOf(story.scenes[start]);
  const opening = first ? parseProjversorView(first) : undefined;
  const projversor = new Projversor(stage, {
    playing: false,
    interactive: false,
    preset: opening?.preset,
    rotate: opening?.rotate,
    zoom: opening?.zoom,
  });
  try {
    await projversor.init();
  } catch (error) {
    // Undo what is already set up: the progress listens to scroll and keys.
    progress.destroy();
    abort.abort();
    root.remove();
    throw error;
  }
  const link =
    options.deepLink && win
      ? mountDeepLink(win, ids, (index) =>
          stepEls[index].scrollIntoView({ block: "center" }),
        )
      : undefined;
  const widgets = mountWidgets(story, hosts, widgetsByName, {
    overlay: root,
    t: mountOptions.t,
    signal: abort.signal,
    contentUrl,
  });
  // Settles with the first view: hosts keep their static fallback until then.
  let settleReady: (error?: unknown) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = (error) => (error === undefined ? resolve() : reject(error));
  });
  let readySettled = false;
  const firstView = (error?: unknown) => {
    if (!readySettled) {
      readySettled = true;
      settleReady(error);
    }
  };
  const adapter = new ProjversorStoryView(projversor, !reduced, (error) =>
    report(error),
  );
  const loading = new LoadingIndicator((visible) => {
    root.classList.toggle("is-loading", visible);
    if (visible) {
      status.textContent = options.loadingLabel;
    } else if (status.textContent === options.loadingLabel) {
      status.textContent = "";
    }
  });
  const report = (error: unknown) => {
    console.error(error);
    loading.hide(true);
    status.textContent = error instanceof Error ? error.message : String(error);
  };

  // The key along the bottom: the field's date, timeline and ramp, the
  // ramps of the layers above it, or a stage widget's swatches.
  const legend = mountLegend(doc, {
    locale: options.t.locale,
    labels: { key: options.keyLabel, timeline: options.timelineLabel },
    onSeek: (ms) => projversor.update({ time: ms }).catch(report),
    onHold: (held) => void projversor.update({ held }),
  });
  stage.append(legend.element);

  // The timeline's series files, once per story; a failed one draws nothing.
  const seriesFiles = new Map<
    string,
    Promise<ReturnType<typeof parseSeriesData> | null>
  >();
  const loadSeries = (path: string) => {
    let file = seriesFiles.get(path);
    if (!file) {
      file = fetch(new URL(path, contentUrl), {
        signal: abort.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`${path}: HTTP ${response.status}`);
          }
          return response.json();
        })
        .then(parseSeriesData)
        .catch((error: unknown) => {
          if (!abort.signal.aborted) {
            console.error(error);
          }
          return null;
        });
      seriesFiles.set(path, file);
    }
    return file;
  };

  let active = -1;
  let generation = 0;
  const inset = (durationMs: number) => {
    const scene = story.scenes[Math.max(0, active)];
    const { width, height } = stage.getBoundingClientRect();
    const header =
      parseFloat(
        win?.getComputedStyle(root).getPropertyValue("--zs-header-h") ?? "",
      ) || 0;
    projversor.view.setInset(
      sceneInset(
        scene.layout,
        width,
        height,
        header,
        sceneWidgets(scene).some((block) => block.slot === "stage"),
      ),
      durationMs,
    );
  };

  // The ramps follow the decoded months. A scene that keeps the layer and
  // month on screen gets no new month event: the last ones are applied
  // again once it is active.
  const months: Record<string, ProjversorMonth> = {};
  const syncKey = () => {
    adapter.layers.forEach((handle, index) => {
      const month = months[handle.id];
      if (month) {
        const scale = monthLegend(month);
        // A view may set its own color domain over the archive's.
        const domain = handle.type === "scalar" ? handle.domain : null;
        legend.setRange(
          index,
          domain ? { ...scale, min: domain[0], max: domain[1] } : scale,
          rampGradient(handle.palette, handle.rampOptions).replace(
            /to top/g,
            "to right",
          ),
        );
      }
    });
    legend.setBounds(adapter.field?.timeBounds ?? null);
  };
  const offMonth = projversor.on("month", ({ id, month }) => {
    months[id] = month;
    syncKey();
  });
  const offFrame = projversor.on("frame", () => {
    const ms = projversor.time;
    // Before a layer's first month decodes the playhead is 0 (1970).
    if (!Number.isFinite(ms) || ms < EARLIEST) {
      return;
    }
    legend.setTime(ms);
    for (const widget of widgets[active] ?? []) {
      widget.time?.(ms);
    }
  });

  // Behind a stage widget at dim 0 the sphere is hidden, and paused.
  let onScreen = false;
  const sphereHidden = () =>
    active >= 0 && stageDim(story.scenes[active]) === 0;
  const syncPlaying = () =>
    void projversor.update({
      playing: onScreen && !doc.hidden && !reduced && !sphereHidden(),
    });

  const activate = async (index: number) => {
    if (index === active) {
      return;
    }
    const scene = story.scenes[index];
    const view = viewOf(scene);
    const current = ++generation;
    const previous = active;
    active = index;
    root.dataset.layout = scene.layout;
    const accent = story.themes[scene.theme]?.accent;
    if (accent) {
      root.style.setProperty("--zs-accent", accent);
    }
    stepEls.forEach((el, i) => el.classList.toggle("is-active", i === index));
    progress.setActive(index);
    link?.set(index);
    stageHosts.forEach((hosts, i) =>
      hosts.forEach((node) => node.classList.toggle("is-active", i === index)),
    );
    const dim = stageDim(scene);
    const showDim = () => {
      root.classList.toggle("has-stage-widget", dim !== null);
      root.style.setProperty("--zs-dim", String(dim ?? 1));
    };
    // A hidden sphere left for another view stays hidden until that view
    // shows: revealed at once, it would flash the previous view's layers.
    const hidden =
      root.classList.contains("has-stage-widget") &&
      root.style.getPropertyValue("--zs-dim") === "0";
    const waitForView =
      Boolean(view) &&
      hidden &&
      dim !== 0 &&
      (previous < 0 ||
        sceneViewId(story.scenes[previous]) !== sceneViewId(scene));
    if (!waitForView) {
      showDim();
    }
    syncPlaying();
    if (previous >= 0) {
      widgets[previous].forEach((widget) => safely(() => widget.leave?.()));
    }
    widgets[index].forEach((widget) => safely(() => widget.enter?.()));
    const key = legends[index];
    const swatches = widgets[index].flatMap((widget) => widget.legend ?? []);
    legend.setKeys(
      key
        ? {
            field: {
              label: options.t.text(key.label),
              stamp: key.stamp ?? true,
              timeStep: key.timeStep,
            },
            layers: key.layers?.map((label) => ({
              label: options.t.text(label),
            })),
          }
        : swatches.length
          ? { swatches }
          : null,
    );
    if (key?.series) {
      const { label } = key.series;
      void loadSeries(key.series.data).then((data) => {
        if (data && current === generation) {
          legend.setSeries({ ...data, label: options.t.text(label) });
        }
      });
    }
    if (!reduced) {
      reveal(stepEls[index]);
    }
    if (!view) {
      // The scene still reads: its text is on screen. Nothing to wait for.
      report(new Error(`Missing view for scene ${scene.id}`));
      firstView();
      return;
    }
    try {
      const { transitionMs } = parseProjversorView(view);
      // The first view opens in place: no eased inset either.
      inset(reduced || previous < 0 ? 0 : (transitionMs ?? 0));
      loading.show();
      await adapter.activate(view);
      if (current !== generation) {
        return;
      }
      if (waitForView) {
        showDim();
      }
      scrub();
      syncKey();
      loading.hide();
      firstView();
      const next = story.scenes[index + 1];
      const nextView = next && viewOf(next);
      if (nextView) {
        adapter.preload(nextView).catch(() => {});
      }
    } catch (error) {
      if (current === generation) {
        if (waitForView) {
          showDim();
        }
        report(error);
        firstView(error);
      }
    }
  };

  // A stage scene comparing as a grid follows the scroll: the grid unfolds
  // as its step runs past the activation line. At once with reduced motion.
  const scrubbed = (index: number) => {
    const scene = story.scenes[index];
    const compare = scene && viewOf(scene)?.config.compare;
    return (
      scene?.layout === "stage" &&
      typeof compare === "object" &&
      compare !== null &&
      (compare as { layout?: unknown }).layout === "grid"
    );
  };
  let scrubFrame = 0;
  const scrub = () => {
    scrubFrame = 0;
    if (active < 0 || !scrubbed(active)) {
      return;
    }
    const { top, height } = stepEls[active].getBoundingClientRect();
    projversor.setCompareProgress(
      reduced ? 1 : stepProgress(top, height, win?.innerHeight ?? 1, LINE),
    );
  };
  const onScroll = () => {
    if (!scrubFrame && win) {
      scrubFrame = win.requestAnimationFrame(scrub);
    }
  };
  win?.addEventListener("scroll", onScroll, { passive: true });

  // Play only while the story is on screen and the tab visible.
  const visibility = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    syncPlaying();
  });
  visibility.observe(root);
  doc.addEventListener("visibilitychange", syncPlaying);
  const resize = new ResizeObserver(() => inset(0));
  resize.observe(stage);

  syncPlaying();
  const scroller = new StoryScroller(stepEls, (index) => void activate(index), {
    line: LINE,
  });
  // Above the first step, show the starting scene: the hashed one, if any,
  // so `ready` reflects the view the visitor asked for.
  if (scroller.active < 0) {
    void activate(start);
  }

  const destroy = () => {
    firstView(new Error("Story unmounted"));
    abort.abort();
    win?.removeEventListener("scroll", onScroll);
    if (scrubFrame) {
      win?.cancelAnimationFrame(scrubFrame);
    }
    offMonth();
    offFrame();
    // One failing widget cleanup must not skip the others, or the rest.
    widgets.flat().forEach((widget) => safely(() => widget.destroy?.()));
    legend.destroy();
    scroller.destroy();
    progress.destroy();
    link?.destroy();
    visibility.disconnect();
    resize.disconnect();
    doc.removeEventListener("visibilitychange", syncPlaying);
    adapter.destroy();
    root.remove();
  };
  // A rejection nobody awaits must not surface as an unhandled one.
  ready.catch(() => {});
  return { ready, destroy };
}

/** No archive starts this early: before it, the playhead is not a date. */
const EARLIEST = Date.UTC(1950, 0, 1);

/**
 * Run the widget blocks of every scene in the hosts made for them, in the
 * steps or the stage: the instances, by scene. A widget that throws is left
 * out; the story goes on without it.
 */
function mountWidgets<T extends StoryText>(
  story: StoryDocument,
  hosts: WidgetHosts,
  registry: Readonly<Record<string, StoryWidget<T>>>,
  shared: Pick<StoryWidgetContext<T>, "t" | "signal" | "contentUrl"> & {
    overlay: HTMLElement;
  },
): StoryWidgetInstance[][] {
  return story.scenes.map((scene) =>
    sceneWidgets(scene).flatMap((block) => {
      const host = hosts.get(block);
      const widget = Object.prototype.hasOwnProperty.call(
        registry,
        block.widget,
      )
        ? registry[block.widget]
        : undefined;
      if (!host || !widget) {
        console.error(new Error(`Unknown widget: ${block.widget}`));
        host?.remove();
        return [];
      }
      try {
        return [
          asInstance(
            widget(host, {
              ...shared,
              doc: host.ownerDocument,
              config: block.config ?? {},
            }),
          ),
        ];
      } catch (error) {
        console.error(error);
        host.remove();
        return [];
      }
    }),
  );
}

/** Runs a widget hook; a throw is logged, and the story goes on. */
function safely(hook: () => void): void {
  try {
    hook();
  } catch (error) {
    console.error(error);
  }
}

/** A folder URL with its trailing slash, so files resolve inside it. */
function asFolder(url: URL): URL {
  if (url.pathname.endsWith("/")) {
    return url;
  }
  const folder = new URL(url.href);
  folder.pathname = `${folder.pathname}/`;
  return folder;
}
