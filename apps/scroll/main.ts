/**
 * The story adapter, smallest form: `@fxi/projversor/story` mounting a
 * two-scene story (a prelude, then scene 01). `?lang=fr` for French.
 */
import "../../src/story/story.css";
import { mountStory, parseStory } from "../../src/story";
import { resolveLocalizedText, type LocalizedText } from "@fxi/story";
import storyJson from "./story.json";
import viewsJson from "./views.json";

const locale =
  new URLSearchParams(location.search).get("lang") === "fr" ? "fr" : "en";
document.documentElement.lang = locale;
const documents = parseStory(storyJson, viewsJson);

mountStory(document.getElementById("story")!, {
  source: documents,
  t: {
    locale,
    text: (value: LocalizedText) => resolveLocalizedText(value, locale, "en"),
  },
  labels: {
    loading: "Loading…",
    scroll: "Scroll",
    steps: { first: "First", previous: "Previous", next: "Next", last: "Last" },
    key: "Key",
    timeline: "Timeline",
    method: "Methodology & sources",
  },
  deepLink: true,
})
  .then(async (story) => {
    // Hooks for tests: the mounted story, to edit it in place.
    Object.assign(window, {
      scrollStory: { story, parseStory, storyJson, viewsJson },
    });
    await story.ready;
    // The first view shows: a hook for tests.
    document.body.dataset.ready = "true";
  })
  .catch((error: unknown) => {
    console.error(error);
    document.getElementById("status")!.textContent = String(error);
  });
