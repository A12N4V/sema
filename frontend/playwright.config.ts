import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real stack: a real FastAPI process holding a real
 * MNE Raw, a real browser painting real canvases and real matplotlib PNGs.
 *
 * The vitest suite in src/test answers "does the UI break?" in a second with no
 * browser, and that is what you run on every save. This answers the questions
 * jsdom structurally cannot: did the canvas actually paint, did the precompute
 * job finish, does a drag on the topography move the cursor, is anything
 * overflowing at 375px. Slower, so it runs before a commit rather than on save.
 *
 * Both servers are reused if already running, so `./dev.sh` and this can share.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,        // one backend, one session store
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "github" : [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // a mobile *viewport* on chromium, not the iPhone descriptor: that one
    // defaults to WebKit, and the point here is the layout, not the engine
    {
      name: "phone",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
  webServer: [
    {
      command: "./.venv/bin/python -m uvicorn app.main:app --port 8123",
      cwd: "../backend",
      url: "http://localhost:8123/api/health",
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      command: "npm run dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
});
