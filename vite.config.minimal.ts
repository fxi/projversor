import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";

// Minimal demo: one scalar layer and a GeoJSON, nothing else.
export default defineConfig({
  plugins: [glsl()],
  base: "/projversor/minimal/",
  root: "demos/minimal",
  publicDir: false,
  build: {
    outDir: "../../dist-minimal",
    emptyOutDir: true,
  },
});
