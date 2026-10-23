import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";
import dts from "vite-plugin-dts";
import pkg from "./package.json" with { type: "json" };

// Dependencies stay imports, so a page that also uses zartigl loads it once.
const dependencies = Object.keys(pkg.dependencies);
const external = (id: string) =>
  dependencies.some((name) => id === name || id.startsWith(`${name}/`));

export default defineConfig({
  plugins: [
    glsl(),
    dts({
      include: ["src"],
      exclude: ["src/**/*.test.ts"],
      entryRoot: "src",
      rollupTypes: true,
    }),
  ],
  publicDir: false,
  build: {
    lib: {
      // "index", not "projversor": Projversor.d.ts would clash on macOS.
      entry: { index: "src/index.ts" },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: { external },
    outDir: "dist",
    emptyOutDir: true,
  },
});
