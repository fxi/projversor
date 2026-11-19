import { expect, test, type Page } from "@playwright/test";
import { demoUrl } from "./playwright.config";

/**
 * Smoke tests of the demos on their live clocks and archives: each opens
 * its first layer through the public API and decodes a month, with no
 * console or page error. Not captured: their playback is not deterministic.
 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push(message.text());
    }
  });
  return errors;
}

const LOAD = { timeout: 60_000 };

test("projection explorer opens a layer", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(demoUrl("explorer"));
  await expect(page.locator('[data-projversor="gl"]')).toHaveCount(1);
  // The month picker fills once the layer shows.
  await expect(page.locator('[data-ref="month"] option').first()).toBeAttached(
    LOAD,
  );
  await expect(page.locator('[data-ref="status"]')).toHaveText("", LOAD);
  expect(errors).toEqual([]);
});

test("story opens its first scene", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(demoUrl("story"));
  await expect(page.locator('[data-projversor="gl"]')).toHaveCount(1);
  // The legend shows once a month is decoded.
  await expect(page.locator('[data-ref="legend"]')).toBeVisible(LOAD);
  expect(errors).toEqual([]);
});

test("story adapter mounts a scroll story", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(demoUrl("scroll"));
  const story = page.locator(".zs-story");
  await expect(story.locator('[data-projversor="gl"]')).toHaveCount(1, LOAD);
  // `ready` settled: the first view shows.
  await expect(page.locator("body")).toHaveAttribute(
    "data-ready",
    "true",
    LOAD,
  );
  await expect(story.locator(".zs-status")).toHaveText("");
  // The prelude has no number; the next scene is 01.
  await expect(story.locator('[data-scene="intro"] .zs-index')).toHaveCount(0);
  await expect(story.locator('[data-scene="pacific"] .zs-index')).toHaveText(
    "01",
  );
  expect(errors).toEqual([]);
});

test("a scroll story is edited in place", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(demoUrl("scroll"));
  const story = page.locator(".zs-story");
  await expect(page.locator("body")).toHaveAttribute(
    "data-ready",
    "true",
    LOAD,
  );
  // Marks on the sphere and the untouched step: kept nodes keep them.
  const before = await page.evaluate(() => {
    const marked = (selector: string) =>
      Object.assign(document.querySelector(selector)!, { kept: true });
    marked('[data-projversor="gl"]');
    marked('[data-scene="pacific"]');
    return window.scrollY;
  });
  type Hook = {
    story: { update(documents: unknown): Promise<void> };
    parseStory(story: unknown, views: unknown): unknown;
    storyJson: { scenes: { blocks: { heading: { en: string } }[] }[] };
    viewsJson: unknown;
  };
  const edit = (change: string) =>
    page.evaluate(
      async ({ change }) => {
        const hook = (window as unknown as { scrollStory: Hook }).scrollStory;
        const { story, parseStory, viewsJson } = hook;
        const storyJson = structuredClone(hook.storyJson);
        if (change === "heading") {
          storyJson.scenes[0].blocks[1].heading.en = "Edited currents";
        } else {
          storyJson.scenes.splice(1, 1);
        }
        await story.update(parseStory(storyJson, viewsJson));
      },
      { change },
    );
  const kept = (selector: string) =>
    page.evaluate(
      (selector) =>
        (document.querySelector(selector) as { kept?: boolean } | null)
          ?.kept === true,
      selector,
    );

  await edit("heading");
  await expect(story.locator('[data-scene="intro"] h1')).toHaveAttribute(
    "aria-label",
    "Edited currents",
  );
  expect(await kept('[data-projversor="gl"]')).toBe(true);
  expect(await kept('[data-scene="pacific"]')).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  await expect(story.locator(".zs-status")).toHaveText("");

  // A scene dropped: its step goes, the sphere stays.
  await edit("drop");
  await expect(story.locator('[data-scene="pacific"]')).toHaveCount(0);
  expect(await kept('[data-projversor="gl"]')).toBe(true);
  await expect(story.locator(".zs-status")).toHaveText("");
  expect(errors).toEqual([]);
});

test("minimal demo shows its field and regions", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(demoUrl("minimal"));
  await expect(page.locator('[data-projversor="gl"]')).toHaveCount(1);
  await expect(page.locator("body")).toHaveAttribute(
    "data-ready",
    "true",
    LOAD,
  );
  await expect(page.locator("#status")).toHaveText("");
  expect(errors).toEqual([]);
});

test("compare demo swipes, then morphs into a grid", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(demoUrl("compare"));
  await expect(page.locator("body")).toHaveAttribute(
    "data-ready",
    "true",
    LOAD,
  );
  const handle = page.locator('[data-projversor="compare-handle"]');
  await expect(handle).toBeVisible(LOAD);
  await handle.focus();
  await page.keyboard.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "0");
  await page.locator('[data-layout="grid"]').click();
  await expect(handle).toBeHidden(LOAD);
  await expect(
    page.locator('[data-projversor="compare-label"]', { hasText: "1997" }),
  ).toBeVisible(LOAD);
  await expect(page.locator("#status")).toHaveText("", LOAD);
  expect(errors).toEqual([]);
});
