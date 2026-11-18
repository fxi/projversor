import type { LocalizedText } from "@fxi/story";
import type { LegendSwatch } from "./legend";

/**
 * Text of the page language. Sites may pass a richer object (links,
 * external checks): widgets of that site receive it as given.
 */
export interface StoryText {
  locale: string;
  text(value: LocalizedText): string;
}

/** What a widget gets: its config, the text, and where to put overlays. */
export interface StoryWidgetContext<T extends StoryText = StoryText> {
  doc: Document;
  t: T;
  config: Record<string, unknown>;
  /** Aborted when the story unmounts. */
  signal: AbortSignal;
  /** Holds dialogs, out of the scrolling steps. */
  overlay: HTMLElement;
  /** Files named in a config are relative to it: the story folder. */
  contentUrl: URL;
}

/**
 * A mounted widget. `enter` runs each time its scene becomes active,
 * `leave` when it stops being so, `time` with the playhead (epoch ms) while
 * it is. A stage widget's `legend` keys the stage while its scene is on.
 */
export interface StoryWidgetInstance {
  enter?(): void;
  leave?(): void;
  time?(ms: number): void;
  destroy?(): void;
  legend?: LegendSwatch[];
}

/** Fills `host`; returns its instance, its cleanup, or nothing. */
export type StoryWidget<T extends StoryText = StoryText> = (
  host: HTMLElement,
  context: StoryWidgetContext<T>,
) => StoryWidgetInstance | (() => void) | void;

/** A widget's result as an instance. */
export const asInstance = (
  result: ReturnType<StoryWidget>,
): StoryWidgetInstance =>
  typeof result === "function" ? { destroy: result } : (result ?? {});
