import { errorMessage } from "@metabase/client/errors";

import { evidenceDir } from "./app";
import { startClip, type RecordedClip } from "./recorder";
import { runScenario } from "./scenario";
import { pickScenario } from "./scenarios/registry";

const MIN_SECONDS = 30;

async function main(): Promise<void> {
  const scenario = pickScenario(process.argv[2]);
  const dir = await evidenceDir(process.env);
  const clip = startClip(dir, `${scenario.unit}-${scenario.name}`);
  let recorded: RecordedClip;
  try {
    await runScenario(scenario, dir, `bun scripts/record.ts ${scenario.name}`);
  } finally {
    recorded = await clip.stop();
  }
  process.stdout.write(`record ok: ${recorded.path} (${recorded.seconds.toFixed(1)} s)\n`);
  if (recorded.seconds < MIN_SECONDS) {
    process.stdout.write(
      `the review gate asks for ${String(MIN_SECONDS)} s or more and this clip is shorter\n`,
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`record failed: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
