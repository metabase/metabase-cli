import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

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
  signal: AbortSignal;
}

// Written beside the path and renamed over it, so the path never holds half a file, and a symlink
// at the path is replaced rather than written through.
async function writeResults(path: string, events: readonly CiEvent[]): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, serializeJson(events, false) + "\n", { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

// A crash ends the stream without `job.end` and leaves no results file: the CLI's error on stderr
// is the report, and a consumer reads a stream that stops before `job.end` as a crash. So an
// earlier run's file is deleted first, and `job.end` reaches the stream only once the results file
// is written.
export async function runJob(options: JobOptions): Promise<JobState> {
  if (options.resultsPath !== null) {
    await rm(options.resultsPath, { force: true });
  }
  const events: CiEvent[] = [];
  const emit = createEmitter({
    job: options.job,
    now: options.now,
    write: (event) => {
      events.push(event);
      if (event.type !== "job.end") {
        options.write(event);
      }
    },
  });

  const plan = await planJob(options.repo, options.base, options.head, options.signal);
  emit({ type: "job.start", v: CI_EVENT_VERSION, ...plan });
  const outcome = await runStages(await options.stages(plan), emit);
  const end = emit({
    type: "job.end",
    state: outcome.state,
    counts: { checks: outcome.checks, warnings: outcome.warnings + plan.warnings.length },
  });

  if (options.resultsPath !== null) {
    await writeResults(options.resultsPath, events);
  }
  options.write(end);
  return outcome.state;
}
