import type { LintReport, LintResult, LintSeverity } from "@metabase/client/domain/lint";

import { reportEntity, resultSeverity, resultsByEntity } from "../core/lint-report";
import { pluralize } from "./pluralize";
import { keyValueLines } from "./render";
import { printable } from "./table";

const RESULT_INDENT = "    ";
const SEVERITY_MARK: Readonly<Record<LintSeverity, string>> = { error: "✗", warning: "!" };

function entityLines(report: LintReport, entityId: string, results: LintResult[]): string[] {
  const entity = reportEntity(report, entityId);
  const hasError = results.some((result) => resultSeverity(report, result) === "error");
  const severity: LintSeverity = hasError ? "error" : "warning";
  const head = `${SEVERITY_MARK[severity]} ${entity.type} "${printable(entity.data.name)}" ${entityId}`;
  return [head, ...lintResultLines(results, RESULT_INDENT)];
}

export function lintResultLines(results: readonly LintResult[], indent: string): string[] {
  const pairs = results.map((result) => [result.ruleId, printable(result.message)] as const);
  return keyValueLines(pairs).map((line) => `${indent}${line}`);
}

function footer(report: LintReport): string {
  const { errors, warnings, entities } = report.summary;
  const verdict = report.status === "failed" ? "FAILED" : "PASSED";
  const counts = [
    errors > 0 ? pluralize(errors, "error", "errors") : null,
    warnings > 0 ? pluralize(warnings, "warning", "warnings") : null,
  ].filter((count) => count !== null);
  if (counts.length === 0) {
    return `${verdict}  no violations`;
  }
  return `${verdict}  ${counts.join(", ")} in ${pluralize(entities, "entity", "entities")}`;
}

export function lintReportLines(report: LintReport): string[] {
  const groups = [...resultsByEntity(report.results)];
  const entities = groups.flatMap(([entityId, results]) => entityLines(report, entityId, results));
  return [...entities, footer(report)];
}
