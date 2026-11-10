import type { LintReport, LintResult, LintSeverity } from "@metabase/client/domain/lint";

import { reportEntity, resultSeverity, resultsByEntity } from "../core/lint-report";
import { pluralize } from "./pluralize";

const RESULT_INDENT = "    ";
const SEVERITY_MARK: Readonly<Record<LintSeverity, string>> = { error: "✗", warning: "!" };

function entityLines(report: LintReport, entityId: string, results: LintResult[]): string[] {
  const entity = reportEntity(report, entityId);
  const hasError = results.some((result) => resultSeverity(report, result) === "error");
  const mark = hasError ? SEVERITY_MARK.error : SEVERITY_MARK.warning;
  const ruleWidth = Math.max(...results.map((result) => result.ruleId.length));
  const head = `${mark} ${entity.type} "${entity.data.name}" ${entityId}`;
  const lines = results.map(
    (result) => `${RESULT_INDENT}${result.ruleId.padEnd(ruleWidth)}  ${result.message}`,
  );
  return [head, ...lines];
}

function footer(report: LintReport): string {
  const { errors, warnings, entities } = report.summary;
  const verdict = report.status === "failed" ? "FAILED" : "PASSED";
  if (errors === 0 && warnings === 0) {
    return `${verdict}  no violations`;
  }
  const counts = [
    ...(errors > 0 ? [pluralize(errors, "error", "errors")] : []),
    ...(warnings > 0 ? [pluralize(warnings, "warning", "warnings")] : []),
  ].join(", ");
  return `${verdict}  ${counts} in ${pluralize(entities, "entity", "entities")}`;
}

export function lintReportLines(report: LintReport): string[] {
  const groups = [...resultsByEntity(report.results)];
  const entities = groups.flatMap(([entityId, results]) => entityLines(report, entityId, results));
  return [...entities, footer(report)];
}
