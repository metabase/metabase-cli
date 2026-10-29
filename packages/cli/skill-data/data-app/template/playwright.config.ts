import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5174/";
const PORT = Number(new URL(BASE_URL).port);

export default defineConfig({
  testDir: "e2e",
  use: { ...devices["Desktop Chrome"], baseURL: BASE_URL },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: true,
  },
});
