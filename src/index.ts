/**
 * projversor: GeoVideo archives on a sphere that morphs between world
 * projections, independent of MapLibre. Published as `@fxi/projversor`.
 */
export {
  FieldLayerHandle,
  GeoJSONLayerHandle,
  ImageLayerHandle,
  Projversor,
} from "./Projversor";
export type {
  FieldLayerConfig,
  FieldLayerType,
  GeoJSONLayerConfig,
  ImageLayerConfig,
  ImageStyle,
  ProjversorEvents,
  ProjversorLayerHandle,
  ProjversorLayerType,
  ProjversorOptions,
  ProjversorState,
  ProjversorView,
} from "./Projversor";
export type { GeoJSONStyle } from "./geojson";
export type { OverlayColors } from "./Overlay";
export { TRANSITION_MS, VIEW_MS, clampZoom } from "./Camera";
export type { ProjversorViewTarget } from "./Camera";
export { SPEEDS } from "./Clock";
export type { ProjversorMonth } from "./FieldLayer";
export { PRESETS, findPreset } from "./presets";
export type { Preset } from "./presets";
export { PROJECTIONS } from "./projections";
export type { ProjectionId } from "./projections";
export { NO_INSET, viewArea } from "./view";
export type { Inset } from "./view";
export {
  PROJVERSOR_LAYERS,
  TINT_LAYERS,
  findLayer,
  isTintEntry,
  layerPalettes,
  preloadLayer,
} from "./layers";
export type { ProjversorLayer } from "./layers";
export { decodeShare, encodeShare } from "./share";
export type { ShareState } from "./share";
export {
  chunkLabel,
  formatUnit,
  legendTicks,
  legendLabels,
  linearTicks,
  monthLegend,
  playheadLabel,
  rampGradient,
  rampPosition,
  timeTicks,
} from "./scales";
export type { LegendScale, TimeTick } from "./scales";
export { normalizeBearing, pointerBearing, screenNorth } from "./bearing";
export type { ScreenProjection } from "./bearing";
export type { GeoVideoField } from "./GeoVideoField";
export {
  ProjversorStoryView,
  parseProjversorView,
  projversorState,
} from "./storyView";
export type {
  ProjversorViewConfig,
  ProjversorViewDefinition,
} from "./storyView";
