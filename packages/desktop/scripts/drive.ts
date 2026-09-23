import { errorMessage } from "@metabase/client/errors";

import { DriverFailure, evidenceDir } from "./app";
import { runScenario } from "./scenario";
import { pickScenario } from "./scenarios/registry";

async function main(): Promise<void> {
  const scenario = pickScenario(process.argv[2]);
  const refusal = scenario.gate === null ? null : scenario.gate(`drive ${scenario.name}`);
  if (refusal !== null) {
    throw new DriverFailure(`${scenario.name} cannot run here: ${refusal}`);
  }
  const dir = await evidenceDir(process.env);
  const artifact = await runScenario(scenario, dir, `bun scripts/drive.ts ${scenario.name}`);
  process.stdout.write(`drive ok: ${scenario.name} -> ${artifact}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`drive failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
