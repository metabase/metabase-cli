import { z } from "zod";

import { LintEntity, type LintReport, LintResult } from "@metabase/client/domain/lint";
import { HttpError } from "@metabase/client/http/errors";

import type { CheckOutcome, StageStop } from "./ci-events";
import { lookupStop } from "./ci-unit";
import { NotAuthenticatedError } from "./config";
import { reportEntity, resultSeverity, resultsByEntity } from "./lint-report";

// The check that stands for the whole report when no entity has a finding to carry one.
const INSTANCE_CHECK = {
  kind: "broken-refs",
  id: "instance",
  label: "Saved queries on the instance",
} as const;

export const BrokenRefsDetail = z.object({ entity: LintEntity, errors: z.array(LintResult) });
export type BrokenRefsDetail = z.infer<typeof BrokenRefsDetail>;

function entityCheck(report: LintReport, entityId: string, results: LintResult[]): CheckOutcome {
  const entity = reportEntity(report, entityId);
  const isError = (result: LintResult): boolean => resultSeverity(report, result) === "error";
  const errors = results.filter(isError);
  const warnings = results
    .filter((result) => !isError(result))
    .map((result) => ({ code: result.ruleId, message: result.message }));
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
  if (error instanceof NotAuthenticatedError) {
    return {
      code: "ci.no-credential",
      message: `no Metabase credential, so the saved queries were not checked: ${error.message}`,
    };
  }
  if (error instanceof HttpError && error.kind === "forbidden") {
    return {
      code: "ci.lint-forbidden",
      message: "only an admin can read the instance's lint report, and the CI identity is not one",
    };
  }
  return lookupStop(error);
}
