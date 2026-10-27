import { randomUUID } from "node:crypto";

import { FailedResultError } from "@metabase/client/errors";

import { CiEvent } from "../../core/ci-events";
import { jsonLineWriter } from "../../output/render";
import { interruptSignal } from "../../runtime/interrupt";
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
    "Compares --head with its merge base with --base, finds the transforms whose files or tests changed, and runs their transform tests on the Metabase instance of --profile, which must already hold the branch's content. Content files are the `.yaml` files Metabase's import reads: not dotfiles, under a top-level serialization folder such as `transforms/` or `collections/`. Only committed content is checked: when --head is the checked-out commit, a content file with uncommitted changes is listed in an `uncommitted-content` warning, and its committed version is checked. Writes one JSON event per line (`job.start`, then each stage and check, then `job.end`); `job.start.checked` lists the transforms the job covered, and a `no-content-changes` warning says when the change touches no content file, so nothing was checked; each transform test's result is passed through as the check's `detail`. Exits 0 when the job passes, and 2 on a usage error: a bad flag, or a --repo, --base or --head that git cannot resolve or relate. Otherwise exits 1, either after `job.end`, whose `state` says whether a check failed (`failed`: fix the transform) or could not run (`errored`: fix the test or the setup), or after a crash, such as a changed content file that does not parse: the stream stops before `job.end`, the error is on stderr, and no --results file is left, not even an earlier run's. When the reader closes stdout early, the job still runs to the end, writes --results and exits by its state.",
  requires: ["eidTranslation.translate", "transformTest.list", "transformTest.run"],
  args: {
    ...profileFlag,
    ...connectionFlags,
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
      write: jsonLineWriter(process.stdout),
      resultsPath: args.results ?? null,
      signal: interruptSignal,
    });
    if (state !== "passed") {
      throw new FailedResultError(`ci job ${state}`);
    }
  },
});
