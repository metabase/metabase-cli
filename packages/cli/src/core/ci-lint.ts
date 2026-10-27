import { z } from "zod";

import { errorMessage } from "@metabase/client/errors";

import { type CoverageAssessment, coverageStage } from "./ci-coverage";
import type { CheckOutcome, CiStage, CiWarning } from "./ci-events";

// The findings `lint({ folder })` from `@metabase/representations` returns. Its output is parsed
// here rather than trusted, and the severity is tied to the rule, so a finding cannot claim an
// error rule with a warning's severity.
const LINT_ERROR_RULES = [
  "schema",
  "duplicate-entity-id",
  "dangling-transform-id",
  "wrong-type-transform-id",
  "duplicate-target",
  "transform-cycle",
  "missing-input",
  "unused-input",
] as const;
const LINT_WARNING_RULES = ["unknown-table", "reads-not-checked"] as const;

const LintEntity = z.object({ model: z.string(), entity_id: z.string(), name: z.string() });

const LintFindingFields = z.object({
  file: z.string(),
  entity: LintEntity,
  message: z.string(),
  related: z.array(z.string()),
});

const LintError = LintFindingFields.extend({
  rule: z.enum(LINT_ERROR_RULES),
  severity: z.literal("error"),
});
type LintError = z.infer<typeof LintError>;

const LintWarning = LintFindingFields.extend({
  rule: z.enum(LINT_WARNING_RULES),
  severity: z.literal("warning"),
});
type LintWarning = z.infer<typeof LintWarning>;

const LintResult = z.object({
  findings: z.array(z.discriminatedUnion("severity", [LintError, LintWarning])),
});
type LintResult = z.infer<typeof LintResult>;

type CheckKind = CheckOutcome["check"]["kind"];

const ERROR_CHECK_KIND: Record<LintError["rule"], CheckKind> = {
  schema: "yaml",
  "transform-cycle": "cycles",
  "duplicate-entity-id": "broken-refs",
  "dangling-transform-id": "broken-refs",
  "wrong-type-transform-id": "broken-refs",
  "duplicate-target": "broken-refs",
  "missing-input": "broken-refs",
  "unused-input": "broken-refs",
};

// The check for the lint run as a whole: its warnings when it ran, its crash when it did not.
const LINT_RUN_CHECK = { kind: "lint", id: "lint", label: "Representation lint" } as const;

// Lints the committed tree and answers the linter's raw output.
export type LintTree = () => Promise<unknown>;

function failedCheck(finding: LintError): CheckOutcome {
  return {
    check: {
      kind: ERROR_CHECK_KIND[finding.rule],
      id: `${finding.rule}:${finding.file}`,
      label: `${finding.entity.name}: ${finding.rule}`,
    },
    verdict: "failed",
    warnings: [],
    ms: 0,
    detail: finding,
  };
}

function lintWarning(finding: LintWarning): CiWarning {
  return { code: finding.rule, message: `${finding.file}: ${finding.message}` };
}

function warningsCheck(findings: readonly LintWarning[]): CheckOutcome {
  return {
    check: LINT_RUN_CHECK,
    verdict: "passed",
    warnings: findings.map(lintWarning),
    ms: 0,
    detail: { findings },
  };
}

function crashedCheck(message: string): CheckOutcome {
  return { check: LINT_RUN_CHECK, verdict: "error", warnings: [], ms: 0, detail: { message } };
}

// Each error fails a check of its own, in the linter's order; the warnings share one passing
// check, which is reported even when there are none, so the stream shows the linter ran.
function lintChecks(result: LintResult): CheckOutcome[] {
  const failed: CheckOutcome[] = [];
  const warnings: LintWarning[] = [];
  for (const finding of result.findings) {
    if (finding.severity === "error") {
      failed.push(failedCheck(finding));
    } else {
      warnings.push(finding);
    }
  }
  return [...failed, warningsCheck(warnings)];
}

// A linter that throws or answers something unreadable has a bug: the check errors, and the
// change is not blamed.
async function runLint(lintTree: LintTree): Promise<CheckOutcome[]> {
  let output: unknown;
  try {
    output = await lintTree();
  } catch (error) {
    return [crashedCheck(`the linter threw: ${errorMessage(error)}`)];
  }
  const parsed = LintResult.safeParse(output);
  if (!parsed.success) {
    return [
      crashedCheck(`the linter answered an unreadable result: ${z.prettifyError(parsed.error)}`),
    ];
  }
  return lintChecks(parsed.data);
}

export function lintStage(coverage: CoverageAssessment, lintTree: LintTree): CiStage {
  const coverageChecks = coverageStage(coverage);
  return {
    name: "lint",
    run: async (report) => {
      await coverageChecks.run(report);
      for (const check of await runLint(lintTree)) {
        report(check);
      }
    },
  };
}
