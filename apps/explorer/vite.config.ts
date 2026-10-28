import { resolve } from "node:path";
import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";

// Projversor explorer: every GeoVideo archive on a reprojectable sphere.
export default defineConfig({
  plugins: [glsl()],
  base: "/projversor/",
  root: import.meta.dirname,
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, "../../dist-apps/explorer"),
    emptyOutDir: true,
  },
});
