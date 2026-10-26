import { writeFile } from "node:fs/promises";

import {
  type CiEvent,
  type CiStage,
  type JobState,
  CI_EVENT_VERSION,
  createEmitter,
  runStages,
} from "../../core/ci-events";
import { serializeJson } from "../../output/render";
import { type JobPlan, planJob } from "./job-plan";

interface JobOptions {
  repo: string;
  base: string;
  head: string;
  stages: (plan: JobPlan) => Promise<readonly CiStage[]>;
  job: string;
  now: () => Date;
  write: (event: CiEvent) => void;
  resultsPath: string | null;
}

// A crash ends the stream without `job.end` and writes no results file: the CLI's error on stderr
// is the report, and a consumer reads a stream that stops before `job.end` as a crash.
export async function runJob(options: JobOptions): Promise<JobState> {
  const events: CiEvent[] = [];
  const emit = createEmitter({
    job: options.job,
    now: options.now,
    write: (event) => {
      events.push(event);
      options.write(event);
    },
  });

  const plan = await planJob(options.repo, options.base, options.head);
  emit({
    type: "job.start",
    v: CI_EVENT_VERSION,
    snapshot: plan.snapshot,
    checked: plan.checked,
    warnings: plan.warnings,
  });
  const outcome = await runStages(await options.stages(plan), emit);
  emit({
    type: "job.end",
    state: outcome.state,
    counts: { checks: outcome.checks, warnings: outcome.warnings + plan.warnings.length },
  });

  if (options.resultsPath !== null) {
    await writeFile(options.resultsPath, serializeJson(events, false) + "\n", "utf8");
  }
  return outcome.state;
}
