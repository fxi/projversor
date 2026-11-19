import { PROJVERSOR_LAYERS } from "../layers";
import { PRESETS } from "../presets";
import { STORY_LAYOUTS } from "./mount";

/**
 * The globe's part of a story archive's README (`packStory`'s `guide`):
 * layouts, presets, layers and view keys, from what this version renders.
 * Markdown, for people and assistants composing a story.
 */
export function authoringGuide(): string {
  const layers = PROJVERSOR_LAYERS.filter(
    // One line per layer: tinted pairings share their base id.
    (layer, index, all) => all.findIndex((l) => l.id === layer.id) === index,
  );
  return [
    '## projversor views (`type: "projversor"`)',
    "",
    "One globe behind the text; each scene's view morphs it.",
    "",
    `**Layouts** (scene \`layout\`): ${STORY_LAYOUTS.map((id) => `\`${id}\``).join(", ")}.`,
    "`intro` opens a story, `left` and `right` put the text on that side,",
    "`stage` gives the globe the whole screen.",
    "",
    `**Presets** (\`preset\`, required): ${PRESETS.map((p) => `\`${p.id}\` (${p.label})`).join(", ")}.`,
    "",
    "**Config keys**:",
    "",
    "- `preset`; `rotate` `[λ, φ, γ]` degrees; `zoom` (> 0).",
    "- `layer`, or `layers` (a stack, bottom first, at most one vector",
    "  layer): ids below. No layer at all shows the bare globe: graticule,",
    "  coastlines and `geojson`.",
    '- `tint` (vector layers: a scalar layer id coloring the particles, `""`',
    "  for none), `style` (`palette`, `particles`, `raster`).",
    "- `playback`: `speed`, `time` (ISO date); `timeRange`: `{ start, end }`",
    '  or `{ trailing: "P1Y" }`.',
    "- `transitionMs` (morph from the previous scene), `wrap` (text follows",
    "  the limb), `coastlines` (default true), `geojson`, `compare`.",
    "",
    "Example:",
    "",
    "```json",
    '{ "id": "winds", "type": "projversor",',
    '  "config": { "preset": "globe", "layer": "surface-wind", "transitionMs": 3000 } }',
    "```",
    "",
    "**Layers** (`layer`):",
    "",
    "| id | kind | what | category |",
    "| --- | --- | --- | --- |",
    ...layers.map(
      (layer) =>
        `| \`${layer.id}\` | ${layer.kind === "vector" ? "particles" : "raster"} | ${layer.label} | ${layer.category} |`,
    ),
    "",
    "**Widgets**: `legend` (the key of the scene's layers) is built in;",
    "others are the site's.",
  ].join("\n");
}
