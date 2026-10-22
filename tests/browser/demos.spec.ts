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
  await page.goto(demoUrl("projection"));
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

test("site mounts its story slot", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(demoUrl("site"));
  const story = page.locator(".zs-story");
  await expect(story.locator('[data-projversor="gl"]')).toHaveCount(1, LOAD);
  // Set once the first scene's layer shows.
  await expect(story).toHaveAttribute("data-shown", /.+/, LOAD);
  await expect(story.locator(".zs-status")).toHaveText("");
  expect(errors).toEqual([]);
});
