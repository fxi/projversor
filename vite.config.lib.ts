import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";
import dts from "vite-plugin-dts";

// One ES module per public entry; dependencies stay external so consumers
// resolve a single copy.
export default defineConfig({
  plugins: [glsl(), dts({ include: ["src"], rollupTypes: true })],
  publicDir: false,
  build: {
    lib: {
      entry: {
        projversor: "src/index.ts",
        rendering: "src/rendering/index.ts",
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: [/^d3-/],
    },
    outDir: "dist",
    emptyOutDir: true,
  },
});
