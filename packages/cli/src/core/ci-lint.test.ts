import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AbortError } from "@metabase/client/errors";
import { validateSchema } from "@metabase/representations";
import { LINT_RULE_SEVERITY, LINT_RULES } from "@metabase/representations/experimental";

import type { CoverageAssessment } from "./ci-coverage";
import { type CheckOutcome, type CiEventBody, type CiStage, runStages } from "./ci-events";
import { type LintTree, type ValidateTree, lintStage } from "./ci-lint";

const NOTHING_UNTESTED: CoverageAssessment = {
  untestedChanges: [],
  untestableChanges: [],
  untouchedUntested: [],
};

const COVERAGE_SUMMARY: CheckOutcome = {
  check: {
    kind: "coverage",
    id: "untouched",
    label: "Transforms whose logic this change did not touch",
  },
  verdict: "passed",
  warnings: [],
  ms: 0,
  detail: { untested: [] },
};

const LINTED_FILES = 112;

const NO_WARNINGS: CheckOutcome = {
  check: { kind: "lint", id: "lint", label: "Representation lint" },
  verdict: "passed",
  warnings: [],
  ms: 0,
  detail: { files: LINTED_FILES, findings: [] },
};

const DAILY = { model: "Transform", entity_id: "7JwIkkAG-06-nsl4jzsaq", name: "Daily" };

interface FindingSpec {
  rule: string;
  severity: string;
  file: string;
  message: string;
}

function finding(spec: FindingSpec) {
  return { ...spec, entity: DAILY, related: ["transforms/hourly.yaml"] };
}

function linted(findings: readonly unknown[]): LintTree {
  return async () => ({ files: LINTED_FILES, findings });
}

const throwingLint: LintTree = async () => {
  throw new Error("cannot read property 'source' of undefined");
};

const ALL_VALID: ValidateTree = async () => ({ results: [] });

const throwingValidator: ValidateTree = async () => {
  throw new Error("ENOENT: no such file or directory, open 'card.yaml'");
};

async function reports(stage: CiStage): Promise<CheckOutcome[]> {
  const reported: CheckOutcome[] = [];
  await stage.run((check) => {
    reported.push(check);
  });
  return reported;
}

async function lintReports(lintTree: LintTree): Promise<CheckOutcome[]> {
  return reports(lintStage(NOTHING_UNTESTED, lintTree, ALL_VALID));
}

describe("lintStage, errors", () => {
  it("fails a yaml check for a schema error, carrying the finding as detail", async () => {
    const schema = finding({
      rule: "schema",
      severity: "error",
      file: "transforms/daily.yaml",
      message: "unknown key `sorce`",
    });

    expect(await lintReports(linted([schema]))).toEqual([
      COVERAGE_SUMMARY,
      {
        check: { kind: "yaml", id: "schema:transforms/daily.yaml:1", label: "Daily: schema" },
        verdict: "failed",
        warnings: [],
        ms: 0,
        detail: schema,
      },
      NO_WARNINGS,
    ]);
  });

  it("fails a cycles check for a transform cycle", async () => {
    const cycle = finding({
      rule: "transform-cycle",
      severity: "error",
      file: "transforms/daily.yaml",
      message: "Daily reads a table Hourly writes, and Hourly reads one Daily writes",
    });

    expect((await lintReports(linted([cycle])))[1]?.check).toEqual({
      kind: "cycles",
      id: "transform-cycle:transforms/daily.yaml:1",
      label: "Daily: transform-cycle",
    });
  });

  it.each([
    "duplicate-entity-id",
    "dangling-transform-id",
    "wrong-type-transform-id",
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
  ])("fails a broken-refs check for %s", async (rule) => {
    const broken = finding({ rule, severity: "error", file: "tests/daily.yaml", message: "m" });

    expect((await lintReports(linted([broken])))[1]?.check).toEqual({
      kind: "broken-refs",
      id: `${rule}:tests/daily.yaml:1`,
      label: `Daily: ${rule}`,
    });
  });

  it("labels an error with its file when the linter names no entity", async () => {
    const unnamed = {
      rule: "schema",
      severity: "error",
      file: "transforms/broken.yaml",
      entity: { model: null, entity_id: null, name: null },
      message: "missing required key `name`",
      related: [],
    };

    expect((await lintReports(linted([unnamed])))[1]?.check).toEqual({
      kind: "yaml",
      id: "schema:transforms/broken.yaml:1",
      label: "transforms/broken.yaml: schema",
    });
  });

  it("numbers repeats of a rule in one file, so each error has its own check id", async () => {
    const missing = (table: string) =>
      finding({
        rule: "missing-input",
        severity: "error",
        file: "tests/daily.yaml",
        message: `no input for ${table}`,
      });

    const ids = (await lintReports(linted([missing("ORDERS"), missing("PEOPLE")]))).map(
      (check) => check.check.id,
    );

    expect(ids).toEqual([
      "untouched",
      "missing-input:tests/daily.yaml:1",
      "missing-input:tests/daily.yaml:2",
      "lint",
    ]);
  });

  it("reports coverage first, then the errors in the linter's order", async () => {
    const coverage: CoverageAssessment = {
      untestedChanges: [{ entityId: DAILY.entity_id, name: "Daily", change: "new", tests: "none" }],
      untestableChanges: [],
      untouchedUntested: [],
    };
    const findings = [
      finding({ rule: "unused-input", severity: "error", file: "tests/b.yaml", message: "m" }),
      finding({ rule: "schema", severity: "error", file: "transforms/a.yaml", message: "m" }),
    ];

    const ids = (await reports(lintStage(coverage, linted(findings), ALL_VALID))).map(
      (check) => `${check.check.kind}/${check.check.id}`,
    );

    expect(ids).toEqual([
      `coverage/${DAILY.entity_id}`,
      "coverage/untouched",
      "broken-refs/unused-input:tests/b.yaml:1",
      "yaml/schema:transforms/a.yaml:1",
      "lint/lint",
    ]);
  });
});

describe("lintStage, warnings", () => {
  it("collects every warning into one passing check", async () => {
    const unknownTable = finding({
      rule: "unknown-table",
      severity: "warning",
      file: "transforms/daily.yaml",
      message: "reads PUBLIC.ORDERZ, which no table file names",
    });
    const notChecked = finding({
      rule: "reads-not-checked",
      severity: "warning",
      file: "transforms/hourly.yaml",
      message: "the SQL could not be read",
    });

    expect(await lintReports(linted([unknownTable, notChecked]))).toEqual([
      COVERAGE_SUMMARY,
      {
        check: { kind: "lint", id: "lint", label: "Representation lint" },
        verdict: "passed",
        warnings: [
          {
            code: "unknown-table",
            message: "transforms/daily.yaml: reads PUBLIC.ORDERZ, which no table file names",
          },
          {
            code: "reads-not-checked",
            message: "transforms/hourly.yaml: the SQL could not be read",
          },
        ],
        ms: 0,
        detail: { files: LINTED_FILES, findings: [unknownTable, notChecked] },
      },
    ]);
  });

  it("collects a table-qualified column into the warnings check", async () => {
    const undecided = finding({
      rule: "table-qualified-column",
      severity: "warning",
      file: "tests/daily.yaml",
      message: "input ORDERS stands in for PUBLIC.ORDERS only if PUBLIC is the default schema",
    });

    expect((await lintReports(linted([undecided])))[1]).toEqual({
      check: { kind: "lint", id: "lint", label: "Representation lint" },
      verdict: "passed",
      warnings: [
        {
          code: "table-qualified-column",
          message:
            "tests/daily.yaml: input ORDERS stands in for PUBLIC.ORDERS only if PUBLIC is the default schema",
        },
      ],
      ms: 0,
      detail: { files: LINTED_FILES, findings: [undecided] },
    });
  });

  it("still reports the lint check when there are no findings", async () => {
    expect(await lintReports(linted([]))).toEqual([COVERAGE_SUMMARY, NO_WARNINGS]);
  });
});

describe("lintStage, the published linter's rules", () => {
  // Fails when @metabase/representations adds a rule or moves one between severities, so the
  // boundary schema in ci-lint.ts is updated with the dependency rather than erroring each finding.
  it.each(LINT_RULES)("reads a finding of %s at the linter's severity", async (rule) => {
    const severity = LINT_RULE_SEVERITY[rule];
    const verdicts = (
      await lintReports(linted([finding({ rule, severity, file: "f.yaml", message: "m" })]))
    )
      .slice(1)
      .map((outcome) => outcome.verdict);

    expect(verdicts).toEqual(severity === "error" ? ["failed", "passed"] : ["passed"]);
  });
});

// The warning rules as zod lists them when a finding names none of them.
const WARNING_RULES = LINT_RULES.filter((rule) => LINT_RULE_SEVERITY[rule] === "warning")
  .map((rule) => `"${rule}"`)
  .join("|");

describe("lintStage, a broken linter", () => {
  it("lets an interrupt end the job instead of erroring the check", async () => {
    const interrupted: LintTree = async () => {
      throw new AbortError("interrupted while tar extracted abc");
    };

    await expect(lintReports(interrupted)).rejects.toBeInstanceOf(AbortError);
  });

  it("errors the lint check when the linter throws", async () => {
    expect(await lintReports(throwingLint)).toEqual([
      COVERAGE_SUMMARY,
      {
        check: { kind: "lint", id: "lint", label: "Representation lint" },
        verdict: "error",
        warnings: [],
        ms: 0,
        detail: { message: "the linter threw: cannot read property 'source' of undefined" },
      },
    ]);
  });

  it("errors the lint check when a finding's severity contradicts its rule", async () => {
    const contradictory = finding({
      rule: "schema",
      severity: "warning",
      file: "transforms/daily.yaml",
      message: "m",
    });

    expect(await lintReports(linted([contradictory]))).toEqual([
      COVERAGE_SUMMARY,
      {
        check: { kind: "lint", id: "lint", label: "Representation lint" },
        verdict: "error",
        warnings: [],
        ms: 0,
        detail: {
          message: `the linter answered an unreadable result: ✖ Invalid option: expected one of ${WARNING_RULES}\n  → at findings[0].rule`,
        },
      },
    ]);
  });
});

describe("lintStage, gating", () => {
  it("still runs the unit stage after a lint error", async () => {
    const ran: string[] = [];
    const unit: CiStage = {
      name: "unit",
      run: async () => {
        ran.push("unit");
        return null;
      },
    };
    const cycle = finding({
      rule: "transform-cycle",
      severity: "error",
      file: "transforms/daily.yaml",
      message: "m",
    });
    const ends: CiEventBody[] = [];

    const outcome = await runStages(
      [lintStage(NOTHING_UNTESTED, linted([cycle]), ALL_VALID), unit],
      (body) => {
        if (body.type === "stage.end") {
          ends.push(body);
        }
      },
    );

    expect(outcome).toEqual({ state: "failed", checks: 3, warnings: 0 });
    expect(ran).toEqual(["unit"]);
    expect(ends).toEqual([
      { type: "stage.end", stage: "lint", status: "failed", stopped: null },
      { type: "stage.end", stage: "unit", status: "passed", stopped: null },
    ]);
  });
});

const CARD_FILE = "collections/main/cards/orders.yaml";

// A Card with every key its schema requires.
const CARD_YAML = [
  "name: Orders",
  "entity_id: Bb3dEfGhIjKlMnOpQrStu",
  "creator_id: admin@example.com",
  "display: table",
  "visualization_settings: {}",
  "dataset_query:",
  "  lib/type: mbql/query",
  "  database: Sample Database",
  "  stages:",
  "  - lib/type: mbql.stage/native",
  "    native: SELECT 1",
  "serdes/meta:",
  "- model: Card",
  "",
].join("\n");

const CARD_WITHOUT_DISPLAY = CARD_YAML.replace("display: table\n", "");

const MISSING_DISPLAY = {
  file: CARD_FILE,
  model: "Card",
  status: "fail",
  errors: [{ path: "/", message: "must have required property 'display'" }],
  message: "/: must have required property 'display'",
};

function cardSchemaCheck(detail: unknown): CheckOutcome {
  return {
    check: { kind: "yaml", id: `schema:${CARD_FILE}`, label: `${CARD_FILE} (Card): schema` },
    verdict: "failed",
    warnings: [],
    ms: 0,
    detail,
  };
}

describe("lintStage, the schema of every file", () => {
  const folders: string[] = [];

  afterEach(() => {
    for (const folder of folders.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  function validatedTree(files: Readonly<Record<string, string>>): ValidateTree {
    const folder = mkdtempSync(join(tmpdir(), "mb-ci-schema-"));
    folders.push(folder);
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(folder, file)), { recursive: true });
      writeFileSync(join(folder, file), text);
    }
    return async () => validateSchema({ folder });
  }

  async function schemaReports(lintTree: LintTree, validateTree: ValidateTree) {
    return reports(lintStage(NOTHING_UNTESTED, lintTree, validateTree));
  }

  it("fails a yaml check for a Card missing a required key, naming the file and model", async () => {
    const tree = validatedTree({ [CARD_FILE]: CARD_WITHOUT_DISPLAY });

    expect(await schemaReports(linted([]), tree)).toEqual([
      COVERAGE_SUMMARY,
      NO_WARNINGS,
      cardSchemaCheck(MISSING_DISPLAY),
    ]);
  });

  it("adds no check for a tree whose every file matches its schema", async () => {
    const tree = validatedTree({ [CARD_FILE]: CARD_YAML });

    expect(await schemaReports(linted([]), tree)).toEqual([COVERAGE_SUMMARY, NO_WARNINGS]);
  });

  it("adds no check for a file Metabase skips, such as one with no serdes/meta", async () => {
    const tree = validatedTree({ "collections/main/notes.yaml": "name: notes\n" });

    expect(await tree()).toMatchObject({ results: [{ status: "skipped" }] });
    expect(await schemaReports(linted([]), tree)).toEqual([COVERAGE_SUMMARY, NO_WARNINGS]);
  });

  it("shows the first three errors of a file and counts the rest", async () => {
    const tree = validatedTree({
      [CARD_FILE]: "name: Orders\nentity_id: Bb3dEfGhIjKlMnOpQrStu\nserdes/meta:\n- model: Card\n",
    });

    const checks = await schemaReports(linted([]), tree);

    expect(checks[2]?.detail).toEqual({
      file: CARD_FILE,
      model: "Card",
      status: "fail",
      errors: [
        { path: "/", message: "must have required property 'display'" },
        { path: "/", message: "must have required property 'creator_id'" },
        { path: "/", message: "must have required property 'dataset_query'" },
        { path: "/", message: "must have required property 'visualization_settings'" },
      ],
      message:
        "/: must have required property 'display'; /: must have required property 'creator_id'; /: must have required property 'dataset_query'; and 1 more",
    });
  });

  it("reports a file the linter already flagged for its schema once, as the linter's finding", async () => {
    const tree = validatedTree({ [CARD_FILE]: CARD_WITHOUT_DISPLAY });
    const unparsed = {
      rule: "schema",
      severity: "error",
      file: CARD_FILE,
      entity: { model: null, entity_id: null, name: null },
      message: "the file does not parse as YAML",
      related: [],
    };

    const ids = (await schemaReports(linted([unparsed]), tree)).map((check) => check.check.id);

    expect(ids).toEqual(["untouched", `schema:${CARD_FILE}:1`, "lint"]);
  });

  it("still validates the tree when the linter cannot run", async () => {
    const tree = validatedTree({ [CARD_FILE]: CARD_WITHOUT_DISPLAY });

    expect(await schemaReports(throwingLint, tree)).toEqual([
      COVERAGE_SUMMARY,
      {
        check: { kind: "lint", id: "lint", label: "Representation lint" },
        verdict: "error",
        warnings: [],
        ms: 0,
        detail: { message: "the linter threw: cannot read property 'source' of undefined" },
      },
      cardSchemaCheck(MISSING_DISPLAY),
    ]);
  });

  it("errors a schema check of its own when the validator throws, and still lints", async () => {
    expect(await schemaReports(linted([]), throwingValidator)).toEqual([
      COVERAGE_SUMMARY,
      NO_WARNINGS,
      {
        check: { kind: "yaml", id: "schema", label: "Schema validation" },
        verdict: "error",
        warnings: [],
        ms: 0,
        detail: {
          message:
            "the schema validator threw: ENOENT: no such file or directory, open 'card.yaml'",
        },
      },
    ]);
  });

  it("lets an interrupt during validation end the job", async () => {
    const interrupted: ValidateTree = async () => {
      throw new AbortError("interrupted while tar extracted abc");
    };

    await expect(schemaReports(linted([]), interrupted)).rejects.toBeInstanceOf(AbortError);
  });
});
