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
  "untestable-transform",
  "duplicate-input",
  "expectation-reads-other-table",
  "row-columns-mismatch",
  "duplicate-expectation-name",
  "transform-collection",
  "missing-incremental-table-tag",
  "missing-target-schema",
] as const;
const LINT_WARNING_RULES = [
  "unknown-table",
  "reads-not-checked",
  "no-expectations",
  "unsupported-transform-engine",
  "untestable-engine",
  "upstream-column-mismatch",
  "input-missing-read-column",
  "table-qualified-column",
  "live-sql-input",
] as const;

const LintEntity = z.object({
  model: z.string().nullable(),
  entity_id: z.string().nullable(),
  name: z.string().nullable(),
});

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
  files: z.number().int().nonnegative(),
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
  "untestable-transform": "broken-refs",
  "duplicate-input": "broken-refs",
  "expectation-reads-other-table": "broken-refs",
  "row-columns-mismatch": "broken-refs",
  "duplicate-expectation-name": "broken-refs",
  "transform-collection": "broken-refs",
  "missing-incremental-table-tag": "broken-refs",
  "missing-target-schema": "broken-refs",
};

// The check for the lint run as a whole: its warnings when it ran, its crash when it did not.
const LINT_RUN_CHECK = { kind: "lint", id: "lint", label: "Representation lint" } as const;

// Lints the committed tree and answers the linter's raw output.
export type LintTree = () => Promise<unknown>;

// A finding the linter could not tie to a named entity, such as a file that fails the schema, is
// labelled by its file.
function failedLabel(finding: LintError): string {
  if (finding.entity.name === null) {
    return `${finding.file}: ${finding.rule}`;
  }
  return `${finding.entity.name}: ${finding.rule}`;
}

// `occurrence` counts from 1 among the findings with the same rule and file, since one file can
// break a rule more than once (a missing input per table).
function failedCheck(finding: LintError, occurrence: number): CheckOutcome {
  return {
    check: {
      kind: ERROR_CHECK_KIND[finding.rule],
      id: `${finding.rule}:${finding.file}:${occurrence}`,
      label: failedLabel(finding),
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

function warningsCheck(files: number, findings: readonly LintWarning[]): CheckOutcome {
  return {
    check: LINT_RUN_CHECK,
    verdict: "passed",
    warnings: findings.map(lintWarning),
    ms: 0,
    detail: { files, findings },
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
  const occurrences = new Map<string, number>();
  for (const finding of result.findings) {
    if (finding.severity === "error") {
      const key = `${finding.rule}:${finding.file}`;
      const previous = occurrences.get(key);
      const occurrence = previous === undefined ? 1 : previous + 1;
      occurrences.set(key, occurrence);
      failed.push(failedCheck(finding, occurrence));
    } else {
      warnings.push(finding);
    }
  }
  return [...failed, warningsCheck(result.files, warnings)];
}

// A linter that throws or answers something unreadable cannot judge the change: the check errors,
// and the change is not blamed. That covers a setup error, such as a table name without a schema
// in a database whose default schema the repo does not declare; the linter's message names it.
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
      const stopped = await coverageChecks.run(report);
      if (stopped !== null) {
        return stopped;
      }
      for (const check of await runLint(lintTree)) {
        report(check);
      }
      return null;
    },
  };
}
