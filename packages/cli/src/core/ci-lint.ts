import { z } from "zod";

import { AbortError, errorMessage } from "@metabase/client/errors";

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
  "duplicate-target",
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

// The answer of `validateSchema({ folder })` from `@metabase/representations`, which checks every
// file Metabase imports against its model's schema, where the linter checks only a few models.
const SchemaError = z.object({ path: z.string(), message: z.string() });

const SchemaPass = z.object({ file: z.string(), model: z.string(), status: z.literal("ok") });

const SchemaFailure = z.object({
  file: z.string(),
  model: z.string().optional(),
  status: z.literal("fail"),
  errors: z.array(SchemaError),
});
type SchemaFailure = z.infer<typeof SchemaFailure>;

const SchemaResult = z.object({
  results: z.array(z.discriminatedUnion("status", [SchemaPass, SchemaFailure])),
});
type SchemaResult = z.infer<typeof SchemaResult>;

type CheckKind = CheckOutcome["check"]["kind"];

const ERROR_CHECK_KIND: Record<LintError["rule"], CheckKind> = {
  schema: "yaml",
  "transform-cycle": "cycles",
  "duplicate-entity-id": "broken-refs",
  "dangling-transform-id": "broken-refs",
  "wrong-type-transform-id": "broken-refs",
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

// The check for the schema validation as a whole, reported only when it crashed.
const SCHEMA_RUN_CHECK = { kind: "yaml", id: "schema", label: "Schema validation" } as const;

// A failed schema check shows this many of its file's errors; its detail keeps them all.
const SHOWN_SCHEMA_ERRORS = 3;

// Lints the committed tree and answers the linter's raw output.
export type LintTree = () => Promise<unknown>;

// Validates the committed tree against the schemas and answers the validator's raw output.
export type ValidateTree = () => Promise<unknown>;

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

function crashedCheck(check: CheckOutcome["check"], message: string): CheckOutcome {
  return { check, verdict: "error", warnings: [], ms: 0, detail: { message } };
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

function schemaErrorsMessage(errors: readonly z.infer<typeof SchemaError>[]): string {
  const shown = errors
    .slice(0, SHOWN_SCHEMA_ERRORS)
    .map((error) => `${error.path}: ${error.message}`);
  const rest = errors.length - shown.length;
  return rest === 0 ? shown.join("; ") : `${shown.join("; ")}; and ${rest} more`;
}

function schemaFailedCheck(failure: SchemaFailure): CheckOutcome {
  const label = failure.model === undefined ? failure.file : `${failure.file} (${failure.model})`;
  return {
    check: { kind: "yaml", id: `schema:${failure.file}`, label: `${label}: schema` },
    verdict: "failed",
    warnings: [],
    ms: 0,
    detail: { ...failure, message: schemaErrorsMessage(failure.errors) },
  };
}

// Each file that fails its schema fails a check of its own, whatever the change touched, unless
// the linter already reported a schema error for that file.
function schemaChecks(result: SchemaResult, lintedFiles: ReadonlySet<string>): CheckOutcome[] {
  return result.results.flatMap((file) =>
    file.status === "fail" && !lintedFiles.has(file.file) ? [schemaFailedCheck(file)] : [],
  );
}

function lintSchemaFiles(result: LintResult): Set<string> {
  return new Set(
    result.findings.filter((finding) => finding.rule === "schema").map((finding) => finding.file),
  );
}

interface Answered<T> {
  kind: "answered";
  value: T;
}

interface Crashed {
  kind: "crashed";
  message: string;
}

// A tool that throws or answers something unreadable cannot judge the change: its check errors,
// and the change is not blamed. That covers a linter setup error, such as a table name without a
// schema in a database whose default schema the repo does not declare; the linter's message names it.
async function answerOf<T>(
  tool: string,
  run: () => Promise<unknown>,
  schema: z.ZodType<T>,
): Promise<Answered<T> | Crashed> {
  let output: unknown;
  try {
    output = await run();
  } catch (error) {
    // An interrupt ends the job, not the check.
    if (error instanceof AbortError) {
      throw error;
    }
    return { kind: "crashed", message: `${tool} threw: ${errorMessage(error)}` };
  }
  const parsed = schema.safeParse(output);
  if (!parsed.success) {
    return {
      kind: "crashed",
      message: `${tool} answered an unreadable result: ${z.prettifyError(parsed.error)}`,
    };
  }
  return { kind: "answered", value: parsed.data };
}

// The schema validation runs first and apart from the linter, so a linter setup error does not
// stop it.
async function treeChecks(lintTree: LintTree, validateTree: ValidateTree): Promise<CheckOutcome[]> {
  const validated = await answerOf("the schema validator", validateTree, SchemaResult);
  const linted = await answerOf("the linter", lintTree, LintResult);
  const lintOutcomes =
    linted.kind === "answered"
      ? lintChecks(linted.value)
      : [crashedCheck(LINT_RUN_CHECK, linted.message)];
  const lintedFiles =
    linted.kind === "answered" ? lintSchemaFiles(linted.value) : new Set<string>();
  const schemaOutcomes =
    validated.kind === "answered"
      ? schemaChecks(validated.value, lintedFiles)
      : [crashedCheck(SCHEMA_RUN_CHECK, validated.message)];
  return [...lintOutcomes, ...schemaOutcomes];
}

export function lintStage(
  coverage: CoverageAssessment,
  lintTree: LintTree,
  validateTree: ValidateTree,
): CiStage {
  const coverageChecks = coverageStage(coverage);
  return {
    name: "lint",
    run: async (report) => {
      const stopped = await coverageChecks.run(report);
      if (stopped !== null) {
        return stopped;
      }
      for (const check of await treeChecks(lintTree, validateTree)) {
        report(check);
      }
      return null;
    },
  };
}
