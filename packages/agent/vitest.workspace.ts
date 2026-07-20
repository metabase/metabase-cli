import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["src/**/*.test.ts"],
    },
  },
  {
    test: {
      name: "smoke",
      include: ["tests/smoke/**/*.smoke.test.ts"],
      testTimeout: 180_000,
      hookTimeout: 60_000,
      poolOptions: {
        forks: { singleFork: true },
      },
    },
  },
]);
