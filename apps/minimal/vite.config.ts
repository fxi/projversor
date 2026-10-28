import { resolve } from "node:path";
import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";

// Minimal page: one scalar layer and a GeoJSON, nothing else.
export default defineConfig({
  plugins: [glsl()],
  base: "/projversor/minimal/",
  root: import.meta.dirname,
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, "../../dist-apps/minimal"),
    emptyOutDir: true,
  },
});
