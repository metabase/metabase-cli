import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["src/**/*.test.ts", "tests/structure.test.ts"],
    },
  },
  {
    test: {
      name: "e2e",
      include: ["tests/e2e/**/*.e2e.test.ts"],
      testTimeout: 120_000,
      hookTimeout: 120_000,
      poolOptions: {
        forks: { singleFork: true },
      },
      globalSetup: ["tests/e2e/setup/global-setup.ts"],
      setupFiles: ["tests/e2e/setup/restore-each.ts"],
    },
  },
]);
