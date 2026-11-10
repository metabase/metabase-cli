import { LintReport } from "@metabase/client/domain/lint";
import { ConfigError, FailedResultError } from "@metabase/client/errors";

import { lintReportLines } from "../output/lint";
import { renderSummaryWithinMaxBytes } from "../output/render";
import { lintReportView } from "../output/views/lint";
import { interruptSignal } from "../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

export default defineMetabaseCommand({
  meta: {
    name: "lint",
    description: "Check every saved query on the instance and fail on any that is broken",
  },
  details: [
    "Reads the instance's lint report: every card, transform and segment whose query analysis found an error, as one `result` per error naming the rule it breaks (`ruleId`), the entity by its serialization `entity_id` (described in `entities`), and the entity that caused it (`cause`) when the analysis traced one, such as the table whose column the query reads. The server finishes the analysis it still owes before answering, so `passed` means nothing is broken, and the request can take a while right after a large import. Requires an admin credential; the `dependencies` feature must be enabled.",
    "With --format json, the default when stdout is not a terminal, writes the report as the server sent it; --fields narrows it, for example to `status,summary`. With --format text, the default on a terminal, writes each entity with a finding, its results under it, and the verdict. A report over --max-bytes is not printed: the error says so, and a failed report still exits 1. Exits 0 when the report passed, 1 when it failed (an `error` result exists; a `warning` alone does not fail it), and 2 on a usage or config error, including a server without the lint endpoint.",
  ].join("\n\n"),
  requires: ["lint.report"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: LintReport,
  examples: ["mb lint", "mb lint --json", "mb lint --json --fields status,summary"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const report = await client.lint.report({ signal: interruptSignal });
    const text = () => lintReportLines(report).join("\n");
    const oversize = renderSummaryWithinMaxBytes(report, lintReportView, text, ctx);
    if (report.status === "passed") {
      if (oversize !== null) {
        throw new ConfigError(oversize);
      }
      return;
    }
    // The analysis has already run, so a report too big to print still owes the caller its verdict.
    const failure = `lint failed: ${report.summary.errors} error(s)`;
    throw new FailedResultError(oversize === null ? failure : `${failure}; its ${oversize}`);
  },
});
