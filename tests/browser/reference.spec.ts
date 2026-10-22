import { expect, test } from "@playwright/test";
import { SCENES, STAGE } from "./harness/scenes";
import { HARNESS_PORT } from "./playwright.config";

/**
 * Each scene rendered by the harness against its baseline, captured from
 * the historical renderer (zartigl `src/projversor`): see README.md.
 */
for (const scene of SCENES) {
  test(`${scene.id}: ${scene.covers}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });
    await page.goto(`http://localhost:${HARNESS_PORT}/?scene=${scene.id}`);
    // The harness owns requestAnimationFrame: poll on a timer.
    await page.waitForFunction(
      () => document.body.dataset.ready ?? document.body.dataset.error,
      undefined,
      { polling: 100, timeout: 100_000 },
    );
    expect(await page.locator("body").getAttribute("data-error")).toBeNull();
    const stage = page.locator("[data-ref=stage]");
    expect(await stage.boundingBox()).toMatchObject(STAGE);
    await expect(stage).toHaveScreenshot(`${scene.id}.png`);
    expect(errors).toEqual([]);
  });
}
