import { randomUUID } from "node:crypto";

import { FailedResultError } from "@metabase/client/errors";

import { type CiStage, CiEvent } from "../../core/ci-events";
import { writeJsonLine } from "../../output/render";
import { defineMetabaseCommand } from "../runtime";
import { runJob } from "./job";

const STAGES: readonly CiStage[] = [];

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description: "Check the transforms a branch changed, writing one JSON event per line",
  },
  details:
    "Compares --head with its merge base with --base, finds the transforms whose files or tests changed, and checks them. Only committed content is checked: when --head is the checked-out commit, a content file that is modified or untracked in the working tree is listed in an `uncommitted-content` warning instead. Writes one JSON event per line (`job.start`, then each stage and check, then `job.end`); `job.start.checked` lists the transforms the job covered. Exits 0 when the job passes, and 2 on a usage error: a bad flag, or a --repo, --base or --head that git cannot resolve or relate. Otherwise exits 1, either after `job.end`, whose `state` says whether a check failed (`failed`: fix the transform) or could not run (`errored`: fix the test or the setup), or after a crash, such as a changed content file that does not parse: the stream stops before `job.end`, the error is on stderr, and no --results file is written.",
  requires: null,
  args: {
    base: { type: "string", description: "Ref the branch is compared against", required: true },
    head: { type: "string", description: "Ref to check", default: "HEAD" },
    repo: { type: "string", description: "Path inside the git work tree to check", default: "." },
    results: {
      type: "string",
      description: "Also write every event to this file, as one JSON array",
    },
  },
  outputSchema: CiEvent,
  examples: ["mb ci run --base origin/main", "mb ci run --base origin/main --results results.json"],
  async run({ args }) {
    const state = await runJob({
      repo: args.repo,
      base: args.base,
      head: args.head,
      stages: STAGES,
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
