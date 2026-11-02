import { randomUUID } from "node:crypto";

import { FailedResultError } from "@metabase/client/errors";

import { lint as lintFolder, validateSchema } from "@metabase/representations";

import { CiEvent, type CiStage } from "../../core/ci-events";
import { treeChecks } from "../../core/ci-lint";
import { jsonLineWriter } from "../../output/render";
import { interruptSignal } from "../../runtime/interrupt";
import { formatFlags } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { runJob } from "./job";
import { type JobPlan, TRANSFORM_FILE_PATTERN } from "./job-plan";
import { type LintScopeParams, withLintScope } from "./lint-scope";
import { textEventWriter } from "./run";

const SHOWN_ROWS = 0;

export function scopedLintStage(params: LintScopeParams): CiStage {
  return {
    name: "lint",
    run: async (report) => {
      const checks = await withLintScope(params, (folder) =>
        treeChecks(
          () => lintFolder({ folder }),
          async () => validateSchema({ folder }),
        ),
      );
      for (const check of checks) {
        report(check);
      }
      return null;
    },
  };
}

function lintStages(repo: string, plan: JobPlan, signal: AbortSignal): readonly CiStage[] {
  if (plan.checked.length === 0) {
    return [];
  }
  return [scopedLintStage({ repo, head: plan.snapshot.head, checked: plan.checked, signal })];
}

export default defineMetabaseCommand({
  meta: {
    name: "lint",
    description: "Lint only the transforms a commit range changed, with no tests and no server",
  },
  details: [
    "Compares --head with its merge base with --base and lints the changed transforms in a small folder: each transform, its tests, its collections, the databases, snippets and transform tags. Rules that span every transform, such as cycles and duplicate targets, stay with `mb ci run`.",
    "Writes the same events as `mb ci run`, with one `lint` stage. Exits 0 when the job passes and 1 after `job.end` when it does not: `state` is `failed` when a finding is an error, and `errored` when the linter could not run.",
  ].join("\n\n"),
  requires: [],
  args: {
    ...formatFlags,
    base: { type: "string", description: "Ref the commits are compared against", required: true },
    head: { type: "string", description: "Ref to lint", default: "HEAD" },
    repo: { type: "string", description: "Path inside the git work tree to lint", default: "." },
  },
  outputSchema: CiEvent,
  examples: ["mb ci lint --base HEAD~1", "mb ci lint --base origin/main --format text"],
  async run({ args, ctx }) {
    const write: (event: CiEvent) => void =
      ctx.format === "json" ? jsonLineWriter(process.stdout) : textEventWriter(SHOWN_ROWS);
    const state = await runJob({
      repo: args.repo,
      base: args.base,
      head: args.head,
      stages: async (plan) => lintStages(args.repo, plan, interruptSignal),
      job: randomUUID(),
      now: () => new Date(),
      write,
      resultsPath: null,
      signal: interruptSignal,
      unchangedPattern: TRANSFORM_FILE_PATTERN,
    });
    if (state !== "passed") {
      throw new FailedResultError(`ci lint ${state}`);
    }
  },
});
