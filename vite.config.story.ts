import { resolve } from "node:path";
import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";

// Projversor story: scenes morphing one projversor sphere, plus its layout
// contact sheet (sheet.html).
const root = resolve(import.meta.dirname, "demos/story");

export default defineConfig({
  plugins: [glsl()],
  base: "/projversor/story/",
  root,
  publicDir: false,
  build: {
    outDir: "../../dist-story",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(root, "index.html"),
        sheet: resolve(root, "sheet.html"),
      },
    },
  },
});
