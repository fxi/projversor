// @fxi/projversor/story: the globe adapter of @fxi/story. A scroll story with
// one sticky projversor sphere behind the text. Content widgets register
// through `MountStoryOptions.widgets`. Styles: `@fxi/projversor/story.css`.
export {
  STORY_LAYOUTS,
  loadStory,
  methodLink,
  mountStory,
  parseStory,
  sceneCatalogId,
  sceneContinues,
  sceneInset,
  sceneLegend,
  type MountStoryOptions,
  type MountedStory,
  type StorySnapshotOptions,
  type StoryDocuments,
  type StoryLabels,
  type StoryLayout,
} from "./mount";
export {
  asInstance,
  type StoryText,
  type StoryWidget,
  type StoryWidgetContext,
  type StoryWidgetInstance,
} from "./widgets";
export {
  parseLegendConfig,
  parseSeriesData,
  type LegendConfig,
  type LegendSwatch,
} from "./legend";
export type { StepLabels } from "./progress";
export { isContentPath } from "./contentPath";
export { paragraphs } from "./paragraphs";
export { authoringGuide } from "./guide";
