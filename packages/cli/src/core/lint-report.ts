import type {
  LintEntity,
  LintReport,
  LintResult,
  LintSeverity,
} from "@metabase/client/domain/lint";
import { InternalError } from "@metabase/client/errors";

// The server's verdict counts only the rules the report describes, so a result under any other
// rule cannot have failed it.
export function resultSeverity(report: LintReport, result: LintResult): LintSeverity {
  return report.rules[result.ruleId]?.severity ?? "warning";
}

export function reportEntity(report: LintReport, entityId: string): LintEntity {
  const entity = report.entities[entityId];
  if (entity === undefined) {
    throw new InternalError(
      `lint result names entity ${entityId}, which the report does not carry`,
    );
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
