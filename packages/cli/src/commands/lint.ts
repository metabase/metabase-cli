import { LintReport } from "@metabase/client/domain/lint";

import { pluralize } from "../output/pluralize";
import { lintReportLines } from "../output/lint";
import { renderVerdict, type VerdictFailure } from "../output/render";
import { lintReportView } from "../output/views/lint";
import { interruptSignal } from "../runtime/interrupt";
import { connectionFlags, outputFlags, profileFlag } from "./flags";
import { defineMetabaseCommand } from "./runtime";

export default defineMetabaseCommand({
  meta: {
    name: "lint",
    description: "Check the instance's content against the lint rules",
  },
  details:
    "Reports one entry of `results` per violation of a lint rule: the rule (`ruleId`, described in `rules`), the entity by its serialization `entity_id` (its type and numeric `id` are in `entities`), a message, and the `cause` when one was traced. Exits 1 when the report's `status` is `failed`, also when that report is over --max-bytes and is not printed; a passed report exits 0, or 2 when it is over --max-bytes. A refused key, a server error or a timeout also exits 1, with no report. Requires an admin credential. Can take minutes right after a large import; gives up after 30 minutes with a timeout.",
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
    const failed = `lint failed: ${pluralize(report.summary.errors, "error", "errors")}`;
    const failure: VerdictFailure = (oversize) =>
      oversize === null ? failed : `${failed}. The report was not printed: ${oversize}`;
    renderVerdict(
      {
        item: report,
        view: lintReportView,
        summaryText: text,
        failure: report.status === "passed" ? null : failure,
      },
      ctx,
    );
  },
});
