import type { LayerStyleInput } from "@fxi/zartigl/catalog";
import { findLayer } from "./layers";
import type { ShareState } from "./share";
import type { ProjversorViewConfig } from "./storyView";

/** A `projversor` entry of a story's views.json. */
export interface ProjversorViewEntry {
  id: string;
  type: "projversor";
  config: Omit<ProjversorViewConfig, "layers">;
}

/** A story.json scene showing one view, its copy left to write. */
export interface StorySceneStub {
  id: string;
  name: Record<string, string>;
  theme: string;
  layout: string;
  durationMs: number;
  blocks: Record<string, unknown>[];
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

const isEmpty = (style: LayerStyleInput | undefined) =>
  !style || Object.keys(style).length === 0;

/**
 * A views.json entry showing the shared state: its layer, view, style and
 * playback. Keys left at the layer's own (its tint, an empty style) are left
 * out, so the view follows later changes of the layer.
 */
export function viewEntry(state: ShareState, id: string): ProjversorViewEntry {
  const layer = findLayer(state.layer);
  const config: ProjversorViewEntry["config"] = {
    layer: layer?.id ?? state.layer,
    preset: state.preset,
    rotate: state.rotate.map((deg) => round(deg, 1)) as [
      number,
      number,
      number,
    ],
    zoom: round(state.zoom, 2),
  };
  if (layer?.kind === "vector" && state.tint !== (layer.tint ?? "")) {
    config.tint = state.tint;
  }
  if (!isEmpty(state.style)) {
    config.style = state.style;
  }
  config.playback = {
    speed: state.speed,
    time: new Date(state.time).toISOString(),
  };
  if (state.timeRange) {
    config.timeRange = state.timeRange;
  }
  return { id, type: "projversor", config };
}

/**
 * A story.json scene for view `viewId`: the view as background, and a copy
 * block with placeholders in `locale`. `theme` must be one of the story's,
 * `layout` one its host renders (projversor's story: `w-e`, `title`…).
 */
export function sceneStub(
  viewId: string,
  label: string,
  { locale = "en", theme = "deep", layout = "w-e" } = {},
): StorySceneStub {
  const text = (value: string) => ({ [locale]: value });
  return {
    id: viewId,
    name: text(label),
    theme,
    layout,
    durationMs: 14000,
    blocks: [
      {
        id: `${viewId}-view`,
        type: "view",
        slot: "stage",
        view: viewId,
        presentation: "background",
      },
      {
        id: `${viewId}-copy`,
        type: "copy",
        slot: "copy",
        showTime: true,
        label: text(label),
        heading: text("Heading"),
        text: text("Text"),
      },
    ],
  };
}

/** A view or scene id from free text: lowercase words joined by dashes. */
export function slugId(text: string): string {
  return (
    text
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "view"
  );
}
