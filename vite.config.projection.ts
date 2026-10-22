import glsl from "vite-plugin-glsl";
import { defineConfig } from "vite";

// Standalone projection demo: GeoVideo currents on a reprojectable sphere.
export default defineConfig({
  plugins: [glsl()],
  base: "/projversor/",
  root: "demos/projection",
  publicDir: false,
  build: {
    outDir: "../../dist-projection",
    emptyOutDir: true,
  },
});
