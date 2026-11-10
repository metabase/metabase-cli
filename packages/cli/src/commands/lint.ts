import { LintReport } from "@metabase/client/domain/lint";

import { countNoun } from "../output/count-noun";
import { lintReportLines } from "../output/lint";
import { renderVerdict, type VerdictFailure } from "../output/render";
import { lintReportView } from "../output/views/lint";
import { interruptSignal } from "../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

export default defineMetabaseCommand({
  meta: {
    name: "lint",
    description: "Check every saved query on the instance and fail on any that is broken",
  },
  details:
    "Reads the instance's lint report: one `result` per error the query analysis found in a card, transform or segment, naming the rule it breaks (`ruleId`), the entity by its serialization `entity_id` (described in `entities`), and the entity that caused it (`cause`) when the analysis traced one, such as the table whose column the query reads. The server finishes the analysis it still owes before answering, so `passed` means nothing is broken, and the request can take a while right after a large import. Requires an admin credential and the `dependencies` feature. --format text writes each entity with a finding, its results under it, and the verdict. A report with an `error` result exits 1, also when it is over --max-bytes and is not printed; a `warning` alone does not fail it.",
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
    const failed = `lint failed: ${countNoun(report.summary.errors, "error", "errors")}`;
    const failure: VerdictFailure = (oversize) =>
      oversize === null ? failed : `${failed}; its ${oversize}`;
    const passed = report.status === "passed";
    renderVerdict(report, lintReportView, text, ctx, passed ? null : failure);
  },
});
