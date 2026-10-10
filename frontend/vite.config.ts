import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs: the same build works on GitHub Pages and from the local server.
  base: "./",
  build: { outDir: "dist", emptyOutDir: true },
});
