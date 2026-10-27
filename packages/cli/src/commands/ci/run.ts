import { randomUUID } from "node:crypto";

import { FailedResultError } from "@metabase/client/errors";

import { coverageStage } from "../../core/ci-coverage";
import { CiEvent } from "../../core/ci-events";
import { ciEventLines } from "../../output/ci-run";
import { jsonLineWriter, lineWriter } from "../../output/render";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, formatFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { runJob } from "./job";
import { clientPort, unitStage } from "./unit-stage";

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description: "Check the transforms a branch changed, reporting each check as it finishes",
  },
  details:
    "Compares --head with its merge base with --base and finds the transforms whose files or tests changed. Two stages check them: `lint` fails each transform the branch adds or whose logic (source or target) it edits that has no transform test, and warns about untested transforms the branch did not touch; `unit` runs the changed transforms' tests on the Metabase instance of --profile, which must already hold the branch's content, and is skipped when no transform changed. Content files are the `.yaml` files Metabase's import reads: not dotfiles, under a top-level serialization folder such as `transforms/` or `collections/`. Only committed content is checked: when --head is the checked-out commit, a content file with uncommitted changes is listed in an `uncommitted-content` warning, and its committed version is checked. With --format json, the default when stdout is not a terminal, writes one JSON event per line (`job.start`, then each stage and check, then `job.end`); `job.start.checked` lists the transforms the job covered, and a `no-content-changes` warning says when the change touches no content file, so nothing was checked; each transform test's result is passed through as the check's `detail`. With --format text, the default on a terminal, writes the same events as lines for a person: each failed expectation with its missing and extra rows, keyed by the first column. The --results file is JSON whatever the format. Exits 0 when the job passes, and 2 on a usage error: a bad flag, or a --repo, --base or --head that git cannot resolve or relate. Otherwise exits 1, either after `job.end`, whose `state` says whether a check failed (`failed`: fix the transform) or could not run (`errored`: fix the test or the setup), or after a crash, such as a changed content file that does not parse: the stream stops before `job.end`, the error is on stderr, and no --results file is left, not even an earlier run's. When the reader closes stdout early, the job still runs to the end, writes --results and exits by its state.",
  requires: ["eidTranslation.translate", "transformTest.list", "transformTest.run"],
  args: {
    ...formatFlags,
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
  examples: [
    "mb ci run --base origin/main",
    "mb ci run --base origin/main --format text --results results.json",
  ],
  async run({ args, ctx, getClient }) {
    const state = await runJob({
      repo: args.repo,
      base: args.base,
      head: args.head,
      // Planning and coverage need no server, so a bad ref or a job with nothing to test never asks for one.
      stages: async (plan) => {
        const lint = coverageStage(plan.coverage);
        if (plan.checked.length === 0) {
          return [lint];
        }
        return [lint, unitStage(plan.checked, async () => clientPort(await getClient()))];
      },
      job: randomUUID(),
      now: () => new Date(),
      write: ctx.format === "json" ? jsonLineWriter(process.stdout) : textEventWriter(),
      resultsPath: args.results ?? null,
      signal: interruptSignal,
    });
    if (state !== "passed") {
      throw new FailedResultError(`ci job ${state}`);
    }
  },
});

function textEventWriter(): (event: CiEvent) => void {
  const writeLine = lineWriter(process.stdout);
  return (event) => {
    for (const line of ciEventLines(event)) {
      writeLine(line);
    }
  };
}
