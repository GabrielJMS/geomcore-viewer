import { defineConfig } from "@playwright/test";

// The e2e server runs on 8797 (8765 is the default for users, 8799 is kept for manual runs).
const PORT = 8797;

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.e2e.ts",
  workers: 1, // the tests share one server scene
  reporter: process.env.CI ? "list" : "line",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"], // WebGL without a GPU (CI)
      executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined, // optional: a chromium already on disk
    },
  },
  webServer: {
    command: `python3 -m geomcore_viewer serve --dir frontend/dist --port ${PORT} --no-browser`,
    cwd: "..",
    env: { ...process.env, PYTHONPATH: "python" } as Record<string, string>,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 15_000,
  },
});
