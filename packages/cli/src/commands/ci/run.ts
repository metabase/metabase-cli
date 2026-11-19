import { randomUUID } from "node:crypto";

import { FailedResultError } from "@metabase/client/errors";

import { CiEvent } from "../../core/ci-events";
import { DEFAULT_MAX_ROWS, ciEventLines } from "../../output/ci-run";
import { jsonLineWriter, lineWriter } from "../../output/render";
import { interruptSignal } from "../../runtime/interrupt";
import { connectionFlags, formatFlags, profileFlag } from "../flags";
import { parseInteger } from "../parse-integer";
import { defineMetabaseCommand } from "../runtime";
import { runJob } from "./job";
import { lintPort, lintStage } from "./lint-stage";
import { clientPort, unitStage } from "./unit-stage";

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description:
      "Lint the Metabase instance and test the transforms a branch changed, reporting each check as it finishes",
  },
  details: [
    "Compares --head with its merge base with --base and finds the transforms whose files or tests changed, listed in `job.start.checked`. Every job runs `lint`; a job whose `checked` is not empty then runs `unit`, even when `lint` fails, so one job reports both stages' findings. Both stages use the Metabase instance that --url, MB_URL or --profile names, tried in that order, which must already hold the branch's content.",
    "`lint` reads the instance's lint report, which covers every card, transform and segment on the instance that is not archived or managed by Metabase, whatever the change touched; an entity that is already broken fails every job. Each entity with a finding gets one `broken-refs` check: `failed` when a finding is an error, with `detail` `{entity, errors}`, and with its warning findings as the check's `warnings`. An instance with no finding gets one passed check, `id` `instance`, whose `detail` is the report's summary and whose `ms` is how long the report took. The server answers after it runs the analysis it still owes, which can take many minutes; `lint` waits up to 30 minutes, writing nothing meanwhile. A server without the report skips `lint`, which passes, with the reason in `stage.end.skipped`. `lint` ends early, `errored`, with the reason in `stage.end.stopped`, when no credential is configured (`ci.no-credential`), when the credential is not an admin's (`ci.lint-forbidden`), and when the report request fails: Metabase rejects the credential (`ci.unauthorized`), the request times out (`ci.timeout`), gets an HTTP error (`ci.http-error`) or cannot connect (`ci.network-error`), or the answer cannot be read (`ci.unreadable-answer`).",
    "`unit` runs the instance's tests of each checked transform. The branch tests a transform when a TransformTest file at --head names it in `transform_id` and has a non-empty `expectations` list. A checked transform the branch tests but the instance lists no test for is `refused` with `detail.error_code` `ci.no-tests-on-instance`; one that neither the branch nor the instance tests gets no check, and fails nothing.",
    "Content files are the `.yaml` files Metabase's import reads: not dotfiles, under a top-level serialization folder such as `transforms/` or `collections/`. Only committed content is read: when --head is the checked-out commit, a content file with uncommitted changes is listed in an `uncommitted-content` warning, and its committed version is read.",
    "With --format json, the default when stdout is not a terminal, writes one JSON event per line (`job.start`, then each stage and check, then `job.end`); a `no-content-changes` warning says when the change touches no content file, so no transform test ran; an `unread-content` warning lists the content files at --head that the change did not touch and that could not be read, so a test in them does not count as the branch testing its transform; each transform test's result is passed through as the check's `detail`, with every row the server sent. With --format text, the default on a terminal, writes the same events as lines for a person: each failed expectation with up to --max-rows lines of its missing and extra rows, keyed by the first column, then a count of the rest. The --results file is JSON whatever the format, and holds every row the server sent. Unless --no-run-log is set, every run also appends each event, as one JSON line, to `.scratch/ci-runs/<started-at>-<job>.jsonl` under the repository root as it happens, whatever the format and whether or not --results is set, so a UI can show every run; the folder holds a `.gitignore` that ignores it, and a run that crashes or is interrupted keeps its log, which stops before `job.end`. A usage or config error found before `job.start`, such as a --base git cannot resolve, leaves no log.",
    "Exits 0 when the job passes. Exits 1 after `job.end` when it does not: `state` is `failed` when a check failed (fix what it names), and `errored` when no check failed but one could not judge the change (fix the test or the setup); a failure outranks errors, since it is a finding about the change. Exits 2 on a usage or config error: a bad flag, a --repo, --base or --head that git cannot resolve or relate, or, found after `job.start` when a stage connects, a configuration it cannot use, such as a browser-login profile bound to another URL; a missing credential is not one, since it ends each stage instead.",
    "A test run that times out, loses its connection or gets an HTTP error is an `error` check whose `detail.error_code` starts with `ci.`, and the next test runs. A failure every later request would repeat ends the unit stage early, `errored` unless a check failed, with the reason in `stage.end.stopped`: no Metabase credential is configured (`ci.no-credential`, before any request), Metabase rejects the credential, the server has no transform testing, the entity-id lookup fails, or Metabase cannot be reached before a test runs. Exits 1 on a crash, such as a content file the change touched that does not parse at --head, and 130 on an interrupt: the stream stops before `job.end`, the error is on stderr, and no --results file is left, not even an earlier run's. When the reader closes stdout early, the job still runs to the end, writes --results and exits by its state.",
  ].join("\n\n"),
  requires: [
    "eidTranslation.translate",
    "lint.report",
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
    "run-log": {
      type: "boolean",
      description:
        "Append every event to a log under .scratch/ci-runs, so a UI can show the run (default: true; pass --no-run-log to skip it)",
      default: true,
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
      // Planning needs no server, so a bad ref never asks for one.
      stages: async (plan) => {
        const lint = lintStage(async () => lintPort(await getClient()));
        if (plan.checked.length === 0) {
          return [lint];
        }
        return [
          lint,
          unitStage(plan.checked, plan.untested, async () => clientPort(await getClient())),
        ];
      },
      job: randomUUID(),
      now: () => new Date(),
      write: ctx.format === "json" ? jsonLineWriter(process.stdout) : textEventWriter(maxRows),
      resultsPath: args.results ?? null,
      runLog: args["run-log"],
      signal: interruptSignal,
    });
    if (state !== "passed") {
      throw new FailedResultError(`ci job ${state}`);
    }
  },
});

function textEventWriter(maxRows: number): (event: CiEvent) => void {
  const writeLine = lineWriter(process.stdout);
  return (event) => {
    for (const line of ciEventLines(event, maxRows)) {
      writeLine(line);
    }
  };
}
