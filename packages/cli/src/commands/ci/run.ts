import { randomUUID } from "node:crypto";

import { FailedResultError } from "@metabase/client/errors";

import { lint as lintFolder } from "@metabase/representations";

import { untestedTransforms } from "../../core/ci-coverage";
import { lintStage } from "../../core/ci-lint";
import { CiEvent } from "../../core/ci-events";
import {
  DEFAULT_MAX_ROWS,
  NO_FAILED_CHECKS,
  ciEventLines,
  failedChecksAfter,
} from "../../output/ci-run";
import { jsonLineWriter, lineWriter } from "../../output/render";
import { withCommittedTree } from "../../runtime/git";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, formatFlags, profileFlag } from "../flags";
import { parseInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";
import { runJob } from "./job";
import { clientPort, unitStage } from "./unit-stage";

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description: "Check the transforms a branch changed, reporting each check as it finishes",
  },
  details: [
    "Compares --head with its merge base with --base and finds the transforms whose files or tests changed. Two stages check them: `lint` fails each transform the branch adds or whose logic (source or target) it edits that has no transform test, fails each transform the branch leaves at head without the last of its transform tests, and warns about untested transforms whose logic the branch did not change. It then runs the representation linter of `@metabase/representations` over every file committed at --head: each error finding fails a check of its own, with the finding as `detail`, and the warnings share one passing `lint` check, whose `detail` holds `files` and `findings`. A linter that cannot run, such as one missing a database's default schema (declare it in `.metabase-lint.json`), errors that check. A transform whose source type is not `query`, such as a Python transform, cannot have transform tests, so `lint` does not fail it: an `untestable-transform` warning lists each such transform the branch adds, edits or strips of its tests. A change to the transform's query text, whitespace included, is an edit; a change to the YAML layout alone is not. A transform test is a TransformTest file at --head whose `transform_id` names the transform and whose `expectations` list is not empty; a test without expectations checks nothing, so it does not count. `unit` runs the instance's tests of the transforms in `job.start.checked`, on the Metabase instance that --url, MB_URL or --profile names, in that order, which must already hold the branch's content; it is absent when `checked` is empty, so a job with nothing to test never connects to Metabase, and it runs even when `lint` fails, so one job reports both stages' findings. A checked transform the branch tests but the instance lists no test for is `refused` with `detail.error_code` `ci.no-tests-on-instance`. Content files are the `.yaml` files Metabase's import reads: not dotfiles, under a top-level serialization folder such as `transforms/` or `collections/`. Only committed content is checked: when --head is the checked-out commit, a content file with uncommitted changes is listed in an `uncommitted-content` warning, and its committed version is checked.",
    "With --format json, the default when stdout is not a terminal, writes one JSON event per line (`job.start`, then each stage and check, then `job.end`); `job.start.checked` lists the transforms the job covered, and a `no-content-changes` warning says when the change touches no content file, so no transform test ran; an `unread-content` warning lists the content files at --head that the change did not touch and this check cannot read, which coverage skips; each transform test's result is passed through as the check's `detail`, with every row the server sent. With --format text, the default on a terminal, writes the same events as lines for a person: each failed expectation with up to --max-rows lines of its missing and extra rows, keyed by the first column, then a count of the rest. The --results file is JSON whatever the format, and holds every row the server sent.",
    "Exits 0 when the job passes. Exits 1 after `job.end` when it does not: `state` is `failed` when a check failed (fix the transform), and `errored` when no check failed but one could not judge the change (fix the test or the setup); a failure outranks errors, since it is a finding about the change. Exits 2 on a usage or config error: a bad flag, a --repo, --base or --head that git cannot resolve or relate, or, found after `job.start` when the unit stage connects, a configuration it cannot use, such as a browser-login profile bound to another URL; a missing credential is not one, since it ends the unit stage instead.",
    "A test run that times out, loses its connection or gets an HTTP error is an `error` check whose `detail.error_code` starts with `ci.`, and the next test runs. A failure every later request would repeat ends the unit stage early, `errored` unless a check failed, with the reason in `stage.end.stopped`: no Metabase credential is configured (`ci.no-credential`, before any request), Metabase rejects the credential, the server has no transform testing, the entity-id lookup fails, or Metabase cannot be reached before a test runs. Exits 1 on a crash, such as a content file the change touched that does not parse at --head, and 130 on an interrupt: the stream stops before `job.end`, the error is on stderr, and no --results file is left, not even an earlier run's. When the reader closes stdout early, the job still runs to the end, writes --results and exits by its state.",
  ].join("\n\n"),
  requires: [
    "eidTranslation.translate",
    "transform.get",
    "transformTest.list",
    "transformTest.run",
  ],
  args: {
    ...formatFlags,
    ...profileFlag,
    ...connectionFlags,
    base: { type: "string", description: "Ref the branch is compared against", required: true },
    head: { type: "string", description: "Ref to check", default: "HEAD" },
    repo: { type: "string", description: "Path inside the git work tree to check", default: "." },
    results: {
      type: "string",
      description:
        "Also write every event to this file, as one JSON array, with every row the server sent",
    },
    "max-rows": {
      type: "string",
      description:
        "Row lines each failed expectation shows under --format text; 0 shows only counts. JSON output and the --results file keep every row",
      default: String(DEFAULT_MAX_ROWS),
    },
  },
  outputSchema: CiEvent,
  examples: [
    "mb ci run --base origin/main",
    "mb ci run --base origin/main --format text --results results.json",
  ],
  async run({ args, ctx, getClient }) {
    const maxRows = parseInteger(args["max-rows"], { name: "--max-rows", min: 0 });
    const state = await runJob({
      repo: args.repo,
      base: args.base,
      head: args.head,
      // Planning and coverage need no server, so a bad ref or a job with nothing to test never asks for one.
      stages: async (plan) => {
        const lint = lintStage(plan.coverage, () =>
          withCommittedTree(args.repo, plan.snapshot.head, interruptSignal, (folder) =>
            lintFolder({ folder }),
          ),
        );
        if (plan.checked.length === 0) {
          return [lint];
        }
        const connect = async () => clientPort(await getClient());
        return [lint, unitStage(plan.checked, untestedTransforms(plan.coverage), connect)];
      },
      job: randomUUID(),
      now: () => new Date(),
      write: ctx.format === "json" ? jsonLineWriter(process.stdout) : textEventWriter(maxRows),
      resultsPath: args.results ?? null,
      signal: interruptSignal,
    });
    if (state !== "passed") {
      throw new FailedResultError(`ci job ${state}`);
    }
  },
});

function textEventWriter(maxRows: number): (event: CiEvent) => void {
  const writeLine = lineWriter(process.stdout);
  let failed = NO_FAILED_CHECKS;
  return (event) => {
    for (const line of ciEventLines(event, maxRows, failed)) {
      writeLine(line);
    }
    failed = failedChecksAfter(failed, event);
  };
}
