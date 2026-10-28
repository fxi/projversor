import { resolve } from "node:path";
import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";

// Home page prototype: a scroll story framed by a header and a footer, all
// from public/content/home.json. Content stays outside the bundle, so the
// story of the month changes without a rebuild.
const root = import.meta.dirname;

export default defineConfig({
  plugins: [glsl()],
  base: "./",
  root,
  build: {
    outDir: resolve(root, "../../dist-apps/site"),
    emptyOutDir: true,
  },
});
