import type {
  LintEntity,
  LintReport,
  LintResult,
  LintSeverity,
} from "@metabase/client/domain/lint";
import { InternalError } from "@metabase/client/errors";

import { pluralize } from "./pluralize";
import { keyValueLines } from "./render";
import { printable } from "./table";

const RESULT_INDENT = "    ";
const SEVERITY_MARK: Readonly<Record<LintSeverity, string>> = { error: "✗", warning: "!" };

function severityOf(report: LintReport, result: LintResult): LintSeverity {
  const rule = report.rules[result.ruleId];
  if (rule === undefined) {
    throw new InternalError(`Lint report from Metabase is missing rule ${result.ruleId}.`);
  }
  return rule.severity;
}

function entityOf(report: LintReport, entityId: string): LintEntity {
  const entity = report.entities[entityId];
  if (entity === undefined) {
    throw new InternalError(`Lint report from Metabase is missing entity ${entityId}.`);
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
  const severity: LintSeverity = hasError ? "error" : "warning";
  const head = `${SEVERITY_MARK[severity]} ${entity.type} "${printable(entity.data.name)}" ${entityId}`;
  const pairs = results.map((result) => [result.ruleId, printable(result.message)] as const);
  return [head, ...keyValueLines(pairs).map((line) => `${RESULT_INDENT}${line}`)];
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
  const groups = [...groupByEntity(report.results)];
  const entities = groups.flatMap(([entityId, results]) => entityLines(report, entityId, results));
  return [...entities, footer(report)];
}
