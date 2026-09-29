import { defineConfig } from "vite";

export default defineConfig({
  // Repository name, so asset URLs work under GitHub Pages.
  base: "/geomcore-viewer/",
  build: { outDir: "dist", emptyOutDir: true },
});
