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

interface EntityGroup {
  entityId: string;
  results: LintResult[];
}

function groupByEntity(results: readonly LintResult[]): EntityGroup[] {
  const groups = new Map<string, EntityGroup>();
  for (const result of results) {
    const group = groups.get(result.entity_id);
    if (group === undefined) {
      groups.set(result.entity_id, { entityId: result.entity_id, results: [result] });
    } else {
      group.results.push(result);
    }
  }
  return [...groups.values()];
}

function entityLines(report: LintReport, group: EntityGroup): string[] {
  const entity = entityOf(report, group.entityId);
  const severities = group.results.map((result) => severityOf(report, result));
  const mark = severities.includes("error") ? SEVERITY_MARK.error : SEVERITY_MARK.warning;
  const ruleWidth = Math.max(...group.results.map((result) => result.ruleId.length));
  const head = `${mark} ${entity.type} "${entity.data.name}" ${group.entityId}`;
  const lines = group.results.map(
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

// The report for a person: each entity with a finding, its results under it, then the verdict.
export function lintReportLines(report: LintReport): string[] {
  const groups = groupByEntity(report.results);
  return [...groups.flatMap((group) => entityLines(report, group)), footer(report)];
}
