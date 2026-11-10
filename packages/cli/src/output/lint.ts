import type {
  LintEntity,
  LintReport,
  LintResult,
  LintSeverity,
} from "@metabase/client/domain/lint";
import { InternalError } from "@metabase/client/errors";

import { countNoun } from "./count-noun";

const RESULT_INDENT = "    ";
const SEVERITY_MARK: Readonly<Record<LintSeverity, string>> = { error: "✗", warning: "!" };

// The server's verdict counts only the rules the report describes, so a result under any other
// rule cannot have failed it.
function severityOf(report: LintReport, result: LintResult): LintSeverity {
  return report.rules[result.ruleId]?.severity ?? "warning";
}

function entityOf(report: LintReport, entityId: string): LintEntity {
  const entity = report.entities[entityId];
  if (entity === undefined) {
    throw new InternalError(
      `lint result names entity ${entityId}, which the report does not carry`,
    );
  }
  return entity;
}

function groupByEntity(results: readonly LintResult[]): Map<string, LintResult[]> {
  const groups = new Map<string, LintResult[]>();
  for (const result of results) {
    const group = groups.get(result.entity_id);
    if (group === undefined) {
      groups.set(result.entity_id, [result]);
    } else {
      group.push(result);
    }
  }
  return groups;
}

function entityLines(report: LintReport, entityId: string, results: LintResult[]): string[] {
  const entity = entityOf(report, entityId);
  const hasError = results.some((result) => severityOf(report, result) === "error");
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
    return `${verdict}  no broken queries`;
  }
  const counts = [
    ...(errors > 0 ? [countNoun(errors, "error", "errors")] : []),
    ...(warnings > 0 ? [countNoun(warnings, "warning", "warnings")] : []),
  ].join(", ");
  return `${verdict}  ${counts} in ${countNoun(entities, "entity", "entities")}`;
}

export function lintReportLines(report: LintReport): string[] {
  const groups = [...groupByEntity(report.results)];
  const entities = groups.flatMap(([entityId, results]) => entityLines(report, entityId, results));
  return [...entities, footer(report)];
}
