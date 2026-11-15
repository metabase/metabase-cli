import { z } from "zod";

import { LintEntity, type LintReport, LintResult } from "@metabase/client/domain/lint";
import { HttpError } from "@metabase/client/http/errors";

import type { CheckOutcome, CiWarning, StageStop } from "./ci-events";
import { connectStop, lookupStop } from "./ci-unit";
import { reportEntity, resultSeverity, resultsByEntity } from "./lint-report";

// The check that stands for the whole report when no entity has a finding to carry one.
const INSTANCE_CHECK = {
  kind: "broken-refs",
  id: "instance",
  label: "Entities on the instance",
} as const;

export const BrokenRefsDetail = z.object({ entity: LintEntity, errors: z.array(LintResult) });
export type BrokenRefsDetail = z.infer<typeof BrokenRefsDetail>;

function entityCheck(report: LintReport, entityId: string, results: LintResult[]): CheckOutcome {
  const entity = reportEntity(report, entityId);
  const errors: LintResult[] = [];
  const warnings: CiWarning[] = [];
  for (const result of results) {
    if (resultSeverity(report, result) === "error") {
      errors.push(result);
    } else {
      warnings.push({ code: result.ruleId, message: result.message });
    }
  }
  const detail: BrokenRefsDetail = { entity, errors };
  return {
    check: { kind: "broken-refs", id: entityId, label: `${entity.type} "${entity.data.name}"` },
    verdict: errors.length > 0 ? "failed" : "passed",
    warnings,
    ms: 0,
    detail,
  };
}

// One check per entity with a finding, or one passed check for an instance with none. `ms` is how
// long the report took, which only the instance's own check can carry.
export function brokenRefChecks(report: LintReport, ms: number): CheckOutcome[] {
  if (report.results.length === 0) {
    return [{ check: INSTANCE_CHECK, verdict: "passed", warnings: [], ms, detail: report.summary }];
  }
  return [...resultsByEntity(report.results)].map(([entityId, results]) =>
    entityCheck(report, entityId, results),
  );
}

// Why the report could not be read, which ends the stage, or null for a bug or an interrupt, which
// the caller rethrows. Only an admin can read the report, so any other identity is a setup to fix.
export function reportStop(error: unknown): StageStop | null {
  const connect = connectStop(error, "the lint report was not read");
  if (connect !== null) {
    return connect;
  }
  if (error instanceof HttpError && error.kind === "forbidden") {
    return {
      code: "ci.lint-forbidden",
      message: "only an admin can read the instance's lint report, and the CI identity is not one",
    };
  }
  return lookupStop(error);
}
