import { resolve } from "node:path";
import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";

/**
 * Browser test harness, served by Playwright only. `@under-test` is the
 * projversor entry rendered by the harness: this repository's `src`, or
 * another copy given by PROJVERSOR_UNDER_TEST, such as zartigl's historical
 * `src/projversor/index.ts`, to capture the reference baselines.
 */
const underTest =
  process.env.PROJVERSOR_UNDER_TEST ??
  resolve(import.meta.dirname, "../../src/index.ts");

export default defineConfig({
  plugins: [glsl()],
  root: resolve(import.meta.dirname, "harness"),
  publicDir: false,
  resolve: { alias: { "@under-test": underTest } },
  // The entry under test may live outside this repository.
  server: { fs: { strict: false } },
});
