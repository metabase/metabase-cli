import { describe, it } from "vitest";

import { evidenceDir } from "./app";
import { runScenario } from "./scenario";
import { SCENARIOS } from "./scenarios/registry";

// A scenario holds a model turn, a sync or a packaged launch; the budget is the slowest of them
// with room, so a stuck step fails on its own timeout and names itself instead of on this one.
const SCENARIO_TIMEOUT_MS = 900_000;

describe("desktop scenarios under xvfb-run", () => {
  for (const scenario of SCENARIOS) {
    const lane = `desktop › ${scenario.name}`;
    const skipReason = scenario.gate === null ? null : scenario.gate(lane);
    it.skipIf(skipReason !== null)(
      scenario.name,
      async () => {
        const dir = await evidenceDir(process.env);
        await runScenario(scenario, dir, `vitest run --project desktop-e2e -t ${scenario.name}`);
      },
      SCENARIO_TIMEOUT_MS,
    );
  }
});
