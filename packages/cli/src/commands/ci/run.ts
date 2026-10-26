import { randomUUID } from "node:crypto";

import { FailedResultError } from "@metabase/client/errors";

import { CiEvent } from "../../core/ci-events";
import { writeJsonLine } from "../../output/render";
import { connectionFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { runJob } from "./job";
import { clientPort, unitStage } from "./unit-stage";

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description: "Check the transforms a branch changed, writing one JSON event per line",
  },
  details:
    "Compares --head with its merge base with --base, finds the transforms whose files or tests changed, and runs their transform tests on the Metabase instance of --profile, which must already hold the branch's content. Only committed content is checked: when --head is the checked-out commit, a content file that is modified or untracked in the working tree is listed in an `uncommitted-content` warning instead. Writes one JSON event per line (`job.start`, then each stage and check, then `job.end`); `job.start.checked` lists the transforms the job covered, and each transform test's result is passed through as the check's `detail`. Exits 1 when the job does not pass; `job.end.state` says whether a check failed (`failed`: fix the transform) or could not run (`errored`: fix the test or the setup). A crash stops the stream before `job.end` and writes no --results file.",
  requires: ["eidTranslation.translate", "transformTest.list", "transformTest.run"],
  args: {
    ...profileFlag,
    ...connectionFlags,
    base: { type: "string", description: "Ref the branch is compared against", required: true },
    head: { type: "string", description: "Ref to check", default: "HEAD" },
    repo: { type: "string", description: "Path to the git repository", default: "." },
    results: { type: "string", description: "Also write every event to this JSON file" },
  },
  outputSchema: CiEvent,
  examples: ["mb ci run --base origin/main", "mb ci run --base origin/main --results results.json"],
  async run({ args, getClient }) {
    const state = await runJob({
      repo: args.repo,
      base: args.base,
      head: args.head,
      // Planning needs no server, so a bad ref or a job with nothing to check never asks for one.
      stages: async (plan) => {
        if (plan.checked.length === 0) {
          return [];
        }
        const client = await getClient();
        return [unitStage(plan.checked, clientPort(client))];
      },
      job: randomUUID(),
      now: () => new Date(),
      write: writeJsonLine,
      resultsPath: args.results ?? null,
    });
    if (state !== "passed") {
      throw new FailedResultError(`ci job ${state}`);
    }
  },
});
