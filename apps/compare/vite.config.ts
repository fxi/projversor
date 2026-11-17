import { resolve } from "node:path";
import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";

// Compare page: one scalar layer at several years, as a swipe or a grid.
export default defineConfig({
  plugins: [glsl()],
  base: "/projversor/compare/",
  root: import.meta.dirname,
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, "../../dist-apps/compare"),
    emptyOutDir: true,
  },
});
