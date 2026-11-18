import { resolve } from "node:path";
import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";

// The story adapter (@fxi/projversor/story) on a two-scene story.
export default defineConfig({
  plugins: [glsl()],
  base: "/projversor/scroll/",
  root: import.meta.dirname,
  publicDir: false,
  build: {
    outDir: resolve(import.meta.dirname, "../../dist-apps/scroll"),
    emptyOutDir: true,
  },
});
