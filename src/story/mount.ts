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

/**
 * Validate story documents against the layouts this mount renders, and
 * each view's config against the projversor layers and presets: a view
 * this mount would refuse fails here, not once its scene shows.
 */
export function parseStory(story: unknown, views: unknown): StoryDocuments {
  const documents = parseStoryDocuments(story, views, {
    layouts: STORY_LAYOUTS,
  });
  for (const view of documents.views.views) {
    parseProjversorView(view);
  }
  return documents;
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

/**
 * Whether a stage scene's view leaves a column beside it: for a stage
 * widget, or for its copy (heading and copy widgets).
 */
export function sceneAside(scene: StoryScene): boolean {
  return (
    Boolean(sceneCopy(scene)) ||
    sceneWidgets(scene).some((block) => block.slot === "stage")
  );
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
  const config = viewById.get(id)?.config;
  const stack = config?.layers;
  // A bare view (no layer) shows no dataset: no methodology to link.
  if (
    config &&
    (Array.isArray(stack) ? stack.length === 0 : config.layer === undefined)
  ) {
    return null;
  }
  const layer = Array.isArray(stack)
    ? (stack[0] as { layer?: unknown } | undefined)?.layer
    : config?.layer;
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
  // A prelude scene (`role: "prelude"`) has no kicker and no number.
  const kicker = (number: number) => {
    const el = doc.createElement("p");
    el.className = "zs-kicker";
    const index = doc.createElement("span");
    index.className = "zs-index";
    index.textContent = pad(number);
    const rule = doc.createElement("span");
    rule.className = "zs-rule";
    el.append(index, rule);
    if (copy?.label) {
      el.append(t.text(copy.label));
    }
    return el;
  };
  if (scene.layout === "stage") {
    if (copy) {
      // The view is the scene: its heading, short, and its copy widgets
      // beside it, in the column the view leaves.
      if (displayNumber !== null) {
        text.append(kicker(displayNumber));
      }
      text.append(headline(doc, "h2", t.text(copy.heading)));
      for (const block of sceneWidgets(scene)) {
        if (block.slot === "copy") {
          text.append(widgetHost(doc, block, hosts));
        }
      }
    } else {
      // No text on screen: its name, for screen readers.
      const name = doc.createElement("h2");
      name.className = "zs-sr";
      name.textContent = t.text(scene.name);
      text.append(name);
    }
    const theme = story.themes[scene.theme];
    if (theme) {
      step.style.setProperty("--zs-accent", theme.accent);
    }
    step.append(text);
    return step;
  }

  if (displayNumber !== null) {
    text.append(kicker(displayNumber));
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

/** How long a snapshot waits for its scene's view to show. */
const SNAPSHOT_SHOW_MS = 30_000;

export interface StorySnapshotOptions {
  /** Image type for `canvas.toBlob`, e.g. `image/webp`; PNG by default. */
  type?: string;
  quality?: number;
  /** Scene to take: scrolled to, then taken once its view shows. */
  scene?: string;
}

export interface MountedStory {
  /** Settles once the first view shows; rejects if it cannot. */
  ready: Promise<void>;
  /**
   * The sphere as an image (PNG by default), without the text: a scene's
   * fallback image, taken from the live story. With `scene`, that scene is
   * scrolled to and taken once its view shows (layers loaded, camera at
   * rest); it rejects if the view fails or another scene takes over.
   * Optional so stories mounted by other means still fit this type.
   */
  snapshot?(options?: StorySnapshotOptions): Promise<Blob>;
  /**
   * Edit the story in place, e.g. from an editor's live preview: the
   * sphere, its layers and the scroll stay, and only the scenes that
   * changed render again. Settles once the active scene's view shows;
   * rejects if it cannot. Labels and locale stay the mount's: mount again
   * to change them. Optional so stories mounted by other means still fit.
   */
  update?(documents: StoryDocuments): Promise<void>;
  destroy(): void;
}

/** One scene of a mount: its step, its stage hosts and widgets. */
interface SceneParts {
  id: string;
  /** What the scene renders from: equal, its elements are kept. */
  print: string;
  step: HTMLElement;
  stage: HTMLElement[];
  hosts: WidgetHosts;
  /** Mounted once the sphere runs; undefined until then. */
  widgets?: StoryWidgetInstance[];
  /** Aborts the widgets' work once the scene is dropped. */
  controller: AbortController;
}

/** What a mount renders from its documents, rendered again by `update`. */
interface StoryContent {
  story: StoryDocument;
  viewById: ReadonlyMap<string, StoryViewDefinition>;
  numbers: ReadonlyMap<string, number | null>;
  scenes: SceneParts[];
  stepEls: HTMLElement[];
  legends: (LegendConfig | null)[];
  ids: string[];
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
  // Stage widgets take the free side of the sphere while their scene is on.
  const stageWidgets = doc.createElement("div");
  stageWidgets.className = "zs-stage-widgets";

  /**
   * The part of the mount the documents make: their scenes' steps, stage
   * hosts and widgets. `update` renders it again, scene by scene: a scene
   * that renders the same keeps its elements and widgets.
   */
  const render = (
    documents: StoryDocuments,
    previous?: StoryContent,
  ): { content: StoryContent; dropped: SceneParts[] } => {
    const { story, views } = documents;
    const viewById = new Map(views.views.map((view) => [view.id, view]));
    const numbers = sceneNumbers(story);
    const kept = new Map(
      (previous?.scenes ?? []).map((part) => [part.id, part]),
    );
    const scenes = story.scenes.map((scene, i): SceneParts => {
      const number = numbers.get(scene.id) ?? null;
      const catalogId = sceneCatalogId(scene, viewById);
      // All a step and its widgets are made of, besides the mount options.
      const print = JSON.stringify({
        scene,
        number,
        first: i === 0,
        continues: sceneContinues(story.scenes[i - 1], scene, options.t.text),
        accent: story.themes[scene.theme]?.accent ?? null,
        catalogId,
      });
      const old = kept.get(scene.id);
      if (old?.print === print) {
        kept.delete(scene.id);
        return old;
      }
      const hosts: WidgetHosts = new Map();
      const step = renderStep(doc, story, scene, i, number, options.t, hosts, {
        label: options.methodLabel,
        href: catalog.then((data) => methodLink(catalogId, data)),
      });
      const stageHosts = sceneWidgets(scene)
        .filter((block) => block.slot === "stage")
        .map((block) => {
          const node = widgetHost(doc, block, hosts);
          node.classList.add("zs-stage-widget");
          // Placed by its own scene's layout, not the story's current one.
          node.dataset.layout = scene.layout;
          return node;
        });
      return {
        id: scene.id,
        print,
        step,
        stage: stageHosts,
        hosts,
        controller: new AbortController(),
      };
    });
    return {
      content: {
        story,
        viewById,
        numbers,
        scenes,
        stepEls: scenes.map((part) => part.step),
        legends: story.scenes.map(sceneLegend),
        ids: story.scenes.map((scene) => scene.id),
      },
      dropped: [...kept.values()],
    };
  };
  let content = render({ story, views }).content;
  const viewOf = (scene: StoryScene): StoryViewDefinition | undefined => {
    const id = sceneViewId(scene);
    return id ? content.viewById.get(id) : undefined;
  };
  /** The widget instances of a scene, once mounted. */
  const widgetsAt = (index: number): StoryWidgetInstance[] =>
    content.scenes[index]?.widgets ?? [];
  // Chapter progress, with the scroll invitation on the first step.
  const progressOf = ({ story, numbers, stepEls }: StoryContent) =>
    mountProgress(doc, {
      names: story.scenes.map((scene) => options.t.text(scene.name)),
      numbers: story.scenes.map((scene) => numbers.get(scene.id) ?? null),
      steps: stepEls,
      line: LINE,
      reduced,
      label: options.t.text(story.title),
      scrollLabel: options.scrollLabel,
      stepLabels: options.stepLabels,
    });
  steps.append(...content.stepEls);
  stageWidgets.append(...content.scenes.flatMap((part) => part.stage));
  let progress = progressOf(content);
  stage.append(veil, stageWidgets, progress.element, status);
  root.append(stage, steps);

  // Attached first: the overlay reads its colors from the computed style.
  // Rejects without WebGL2: the caller then shows the fallback slot.
  host.append(root);
  // A hashed scene opens in place: its step, then its view.
  const start =
    options.deepLink && win
      ? Math.max(0, sceneFromHash(win.location.hash, content.ids))
      : 0;
  if (start > 0) {
    content.stepEls[start].scrollIntoView({ block: "center" });
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
  const linkOf = ({ ids, stepEls }: StoryContent) =>
    options.deepLink && win
      ? mountDeepLink(win, ids, (index) =>
          stepEls[index].scrollIntoView({ block: "center" }),
        )
      : undefined;
  let link = linkOf(content);
  /** Run the widgets of the scenes rendered anew; kept ones run on. */
  const mountWidgets = ({ story, scenes }: StoryContent) =>
    scenes.forEach((part, i) => {
      part.widgets ??= mountSceneWidgets(
        story.scenes[i],
        part.hosts,
        widgetsByName,
        {
          overlay: root,
          t: mountOptions.t,
          signal: AbortSignal.any([abort.signal, part.controller.signal]),
          contentUrl,
        },
      );
    });
  /** A scene gone from the story, or rendered anew: its widgets stop. */
  const discard = (part: SceneParts) => {
    part.controller.abort();
    part.widgets?.forEach((widget) => safely(() => widget.destroy?.()));
  };
  mountWidgets(content);
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
  // Each activation, and how it ended: a scene snapshot waits on the one
  // showing its scene. A settled promise keeps its outcome, so a snapshot
  // asked after the view showed (or failed) still gets it.
  interface Activation {
    index: number;
    shown: Promise<void>;
    settle: (error?: unknown) => void;
  }
  let activation: Activation | undefined;
  const begun = new Set<(next: Activation) => void>();
  const beginActivation = (index: number): Activation => {
    // A view still loading is superseded: its waiters learn it.
    activation?.settle(new Error("Another scene took over"));
    let settled = false;
    let settle: (error?: unknown) => void = () => {};
    const shown = new Promise<void>((resolve, reject) => {
      settle = (error) => {
        if (!settled) {
          settled = true;
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        }
      };
    });
    shown.catch(() => {});
    const next = { index, shown, settle };
    activation = next;
    for (const listener of [...begun]) {
      listener(next);
    }
    return next;
  };
  /** The activation showing `index`: the current one, or the next one. */
  const activationOf = (index: number, signal: AbortSignal) =>
    activation?.index === index
      ? Promise.resolve(activation)
      : new Promise<Activation>((resolve, reject) => {
          const listener = (next: Activation) => {
            if (next.index === index) {
              begun.delete(listener);
              resolve(next);
            }
          };
          begun.add(listener);
          signal.addEventListener("abort", () => {
            begun.delete(listener);
            reject(signal.reason);
          });
        });
  const inset = (durationMs: number) => {
    const scene = content.story.scenes[Math.max(0, active)];
    const { width, height } = stage.getBoundingClientRect();
    const header =
      parseFloat(
        win?.getComputedStyle(root).getPropertyValue("--zs-header-h") ?? "",
      ) || 0;
    projversor.view.setInset(
      sceneInset(scene.layout, width, height, header, sceneAside(scene)),
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
    for (const widget of widgetsAt(active)) {
      widget.time?.(ms);
    }
  });

  // Behind a stage widget at dim 0 the sphere is hidden, and paused.
  let onScreen = false;
  const sphereHidden = () =>
    active >= 0 && stageDim(content.story.scenes[active]) === 0;
  const syncPlaying = () =>
    void projversor.update({
      playing: onScreen && !doc.hidden && !reduced && !sphereHidden(),
    });

  /**
   * Show the scene at `index`. `quiet`: the story was edited in place, so
   * no reveal and no progress flourish; a view that changed still morphs.
   */
  const activate = async (index: number, quiet = false) => {
    if (index === active) {
      return;
    }
    const { story, stepEls, scenes, legends } = content;
    const scene = story.scenes[index];
    const view = viewOf(scene);
    const current = ++generation;
    const previous = active;
    active = index;
    const shown = beginActivation(index);
    root.dataset.layout = scene.layout;
    const accent = story.themes[scene.theme]?.accent;
    if (accent) {
      root.style.setProperty("--zs-accent", accent);
    }
    stepEls.forEach((el, i) => el.classList.toggle("is-active", i === index));
    progress.setActive(index, quiet);
    link?.set(index);
    scenes.forEach((part, i) =>
      part.stage.forEach((node) =>
        node.classList.toggle("is-active", i === index),
      ),
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
      widgetsAt(previous).forEach((widget) => safely(() => widget.leave?.()));
    }
    widgetsAt(index).forEach((widget) => safely(() => widget.enter?.()));
    const key = legends[index];
    const swatches = widgetsAt(index).flatMap((widget) => widget.legend ?? []);
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
    if (!reduced && !quiet) {
      reveal(stepEls[index]);
    }
    if (!view) {
      // The scene still reads: its text is on screen. Nothing to wait for.
      const missing = new Error(`Missing view for scene ${scene.id}`);
      report(missing);
      firstView();
      // Text only: no globe of its own to snapshot.
      shown.settle(missing);
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
      shown.settle();
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
        shown.settle(error);
      }
    }
  };

  // A stage scene comparing as a grid follows the scroll: the grid unfolds
  // as its step runs past the activation line. At once with reduced motion.
  const scrubbed = (index: number) => {
    const scene = content.story.scenes[index];
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
    const { top, height } = content.stepEls[active].getBoundingClientRect();
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
  const scrollerOf = ({ stepEls }: StoryContent) =>
    new StoryScroller(stepEls, (index) => void activate(index), {
      line: LINE,
    });
  let scroller = scrollerOf(content);
  // Above the first step, show the starting scene: the hashed one, if any,
  // so `ready` reflects the view the visitor asked for.
  if (scroller.active < 0) {
    void activate(start);
  }

  /**
   * Edit in place: the sphere, its loaded layers, the key and the scroll
   * stay; scenes that render the same keep their elements and widgets. The
   * active scene stays where it is on screen, and its view is applied
   * again (a changed view morphs to the new one).
   */
  const update = async (documents: StoryDocuments): Promise<void> => {
    if (abort.signal.aborted) {
      throw new Error("Story unmounted");
    }
    const before = content;
    const was = active;
    const activeId = was >= 0 ? before.ids[was] : undefined;
    const anchor =
      was >= 0 ? before.stepEls[was].getBoundingClientRect().top : undefined;
    scroller.destroy();
    link?.destroy();
    widgetsAt(was).forEach((widget) => safely(() => widget.leave?.()));
    const { content: next, dropped } = render(documents, before);
    content = next;
    dropped.forEach(discard);
    steps.replaceChildren(...next.stepEls);
    stageWidgets.replaceChildren(...next.scenes.flatMap((part) => part.stage));
    root.setAttribute("aria-label", options.t.text(next.story.title));
    const nextProgress = progressOf(next);
    progress.element.replaceWith(nextProgress.element);
    progress.destroy();
    progress = nextProgress;
    mountWidgets(next);
    // The error of the previous draft goes; this one reports its own.
    status.textContent = "";
    // The same scene if it is still there, else the one now in its place.
    let index = activeId === undefined ? -1 : next.ids.indexOf(activeId);
    if (index < 0) {
      index = Math.min(Math.max(was, 0), next.ids.length - 1);
    }
    if (anchor !== undefined && win) {
      win.scrollBy(0, next.stepEls[index].getBoundingClientRect().top - anchor);
    }
    link = linkOf(next);
    active = -1;
    void activate(index, true);
    const showing = activation;
    // Created after: its first call finds the scene already active.
    scroller = scrollerOf(next);
    try {
      await showing?.shown;
    } catch (error) {
      // Superseded (scrolled on, edited again) is no failure of this draft;
      // a missing view is reported in the status, as on mount.
      if (activation === showing && viewOf(next.story.scenes[index])) {
        throw error;
      }
    }
  };

  const destroy = () => {
    firstView(new Error("Story unmounted"));
    activation?.settle(new Error("The story was destroyed"));
    abort.abort();
    win?.removeEventListener("scroll", onScroll);
    if (scrubFrame) {
      win?.cancelAnimationFrame(scrubFrame);
    }
    offMonth();
    offFrame();
    // One failing widget cleanup must not skip the others, or the rest.
    content.scenes.forEach(discard);
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
  return {
    ready,
    snapshot: async ({ scene, ...image }: StorySnapshotOptions = {}) => {
      if (scene === undefined) {
        return projversor.snapshot(image);
      }
      const index = content.ids.indexOf(scene);
      if (index < 0) {
        throw new Error(`No scene ${scene} in this story`);
      }
      const timeout = AbortSignal.any([
        abort.signal,
        AbortSignal.timeout(SNAPSHOT_SHOW_MS),
      ]);
      content.stepEls[index].scrollIntoView({ block: "center" });
      const showing = await activationOf(index, timeout);
      await Promise.race([
        showing.shown,
        new Promise<never>((_, reject) =>
          timeout.addEventListener("abort", () =>
            reject(new Error(`Scene ${scene} did not show`)),
          ),
        ),
      ]);
      // The frame with the camera at rest (morph and inset eased in).
      const blob = await projversor.snapshot({ ...image, settled: true });
      if (activation !== showing) {
        throw new Error(`Scene ${scene} is no longer shown`);
      }
      return blob;
    },
    update,
    destroy,
  };
}

/** No archive starts this early: before it, the playhead is not a date. */
const EARLIEST = Date.UTC(1950, 0, 1);

/**
 * Run the widget blocks of a scene in the hosts made for them, in its step
 * or the stage: its instances. A widget that throws is left out; the story
 * goes on without it.
 */
function mountSceneWidgets<T extends StoryText>(
  scene: StoryScene,
  hosts: WidgetHosts,
  registry: Readonly<Record<string, StoryWidget<T>>>,
  shared: Pick<StoryWidgetContext<T>, "t" | "signal" | "contentUrl"> & {
    overlay: HTMLElement;
  },
): StoryWidgetInstance[] {
  return sceneWidgets(scene).flatMap((block) => {
    const host = hosts.get(block);
    const widget = Object.prototype.hasOwnProperty.call(registry, block.widget)
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
  });
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
