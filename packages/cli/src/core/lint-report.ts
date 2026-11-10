import type {
  LintEntity,
  LintReport,
  LintResult,
  LintSeverity,
} from "@metabase/client/domain/lint";
import { InternalError } from "@metabase/client/errors";

export function resultSeverity(report: LintReport, result: LintResult): LintSeverity {
  const rule = report.rules[result.ruleId];
  if (rule === undefined) {
    throw new InternalError(`Lint report from Metabase is missing rule ${result.ruleId}.`);
  }
  return rule.severity;
}

export function reportEntity(report: LintReport, entityId: string): LintEntity {
  const entity = report.entities[entityId];
  if (entity === undefined) {
    throw new InternalError(`Lint report from Metabase is missing entity ${entityId}.`);
  }
  return entity;
}

export function resultsByEntity(results: readonly LintResult[]): Map<string, LintResult[]> {
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
