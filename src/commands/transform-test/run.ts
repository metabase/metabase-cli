import { readFile } from "node:fs/promises";

import { ConfigError, errorMessage } from "../../core/errors";
import { TestRunResult } from "../../domain/transform-test-run";
import { collectRepeatedFlag } from "../../runtime/citty";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId, parseIdList } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { type AssertionDef, parseAssertFlags, resolveAssertions } from "./assert";
import {
  parseColumnList,
  parseInputPairs,
  parseTargetType,
  runSubgraph,
  type SubgraphRunArgs,
  targetLabels,
  targetTypeFlag,
} from "./subgraph";
import { parseSuite, type SuiteArgs } from "./suite";

const ASSERT_FLAG = {
  type: "string",
  description:
    "Assertion: a .sql file path or a glob of them (dir/*.sql). Repeatable; comma-separates paths. Name = file basename without .sql. Severity defaults to error. Inline SQL is not supported — write the assertion to a .sql file.",
} as const;

async function loadSuite(path: string): Promise<SuiteArgs> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read --suite file '${path}': ${errorMessage(error)}`);
  }
  return parseSuite(contents, path);
}

// Merge a YAML suite (if any) with ad-hoc flags: scalar/list flags override the suite when
// provided; --assert assertions append to the suite's.
function compose(suite: SuiteArgs | null, flags: FlagArgs): SubgraphRunArgs {
  const targetType = flags.targetType ?? suite?.targetType;
  const target = flags.target ?? suite?.target;
  if (targetType === undefined || target === undefined) {
    throw new ConfigError(
      "Missing target. Provide the positional id (and --target-type) or a --suite that defines target.",
    );
  }
  const sources = flags.sources.length > 0 ? flags.sources : (suite?.sources ?? []);
  const inputs = flags.inputs.length > 0 ? flags.inputs : (suite?.inputs ?? []);
  const ignoreColumns =
    flags.ignoreColumns.length > 0 ? flags.ignoreColumns : (suite?.ignoreColumns ?? []);
  const expected = flags.expected ?? suite?.expected;
  const assertions: AssertionDef[] = [...(suite?.assertions ?? []), ...flags.assertions];

  if (expected === undefined && assertions.length === 0) {
    throw new ConfigError(
      "Provide at least one of --expected <csv> or --assert (or define them in --suite).",
    );
  }

  const args: SubgraphRunArgs = {
    targetType,
    target,
    sources,
    inputs,
    ignoreColumns,
    assertions,
  };
  if (expected !== undefined) {
    args.expected = expected;
  }
  return args;
}

interface FlagArgs {
  targetType?: SubgraphRunArgs["targetType"];
  target?: number;
  sources: number[];
  inputs: SubgraphRunArgs["inputs"];
  expected?: string;
  ignoreColumns: string[];
  assertions: AssertionDef[];
}

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description: "Test-run a transform or card (or sub-graph) against fixture CSVs and assertions",
  },
  details:
    "Seeds scratch tables from the --input fixture CSVs (real tables are never touched), runs the sub-graph from the --source transforms up to the target (the positional id) in dependency order, and checks the target's output against the --expected CSV and/or --assert SQL assertions. At least one of --expected or --assert is required. An assertion is a SQL query written to a `.sql` file that passes iff it returns zero rows; it references the synthetic `test_output` relation (the target's output) and/or input table names. A --suite YAML file can declare the whole run (target, inputs, expected, assertions with per-assertion severity) and is parsed entirely client-side; ad-hoc flags compose with it (scalars override, --assert appends). The positional id is a transform id by default, or a card id when --target-type card is set. Use `transform-test inputs` to discover which tables need fixtures. Exits non-zero when the diff fails or any error-severity assertion fails; warn-severity assertion failures are reported but do not affect the exit code.",
  // Provisional: the test-run/subgraph endpoints are unreleased. minVersion mirrors the
  // transforms feature baseline so the command runs against a dev build; bump to the actual
  // release version before this ships.
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...targetTypeFlag,
    source: {
      type: "string",
      description: "Comma-separated boundary source transform ids (omit to test the target alone)",
    },
    input: {
      type: "string",
      description: "Comma-separated <table-id>=<csv-path> fixtures, one per required input table",
    },
    expected: {
      type: "string",
      description: "Path to the expected-output CSV (optional if --assert is given)",
    },
    "ignore-columns": {
      type: "string",
      description: "Comma-separated output column names to exclude from the diff",
    },
    assert: ASSERT_FLAG,
    suite: {
      type: "string",
      description:
        "Path to a YAML test-suite file (target, inputs, expected, assertions with optional severity); composed with ad-hoc flags",
    },
    // Not required at the citty layer: a --suite can supply the target. `compose` enforces that
    // a target comes from one source or the other.
    id: {
      type: "positional",
      required: false,
      description: "Target transform or card id (optional when --suite defines the target)",
    },
  },
  outputSchema: TestRunResult,
  examples: [
    "mb transform-test run 173 --source 172 --input 229=orders.csv --expected expected.csv",
    "mb transform-test run 173 --source 172 --input 229=orders.csv --assert checks/no_negatives.sql",
    "mb transform-test run 173 --assert checks/no_negatives.sql,checks/has_rows.sql --input 229=orders.csv",
    "mb transform-test run 173 --assert 'checks/*.sql' --input 229=orders.csv",
    "mb transform-test run --suite suites/orders.yaml",
  ],
  async run({ args, rawArgs, ctx, getClient }) {
    const suite = args.suite !== undefined ? await loadSuite(args.suite) : null;

    const idGiven = typeof args.id === "string" && args.id.trim() !== "";
    const targetType = idGiven || suite === null ? parseTargetType(args["target-type"]) : undefined;
    const target = idGiven
      ? parseId(args.id, targetLabels(targetType ?? "transform").positionalLabel)
      : undefined;

    // `--assert` is repeatable: citty collapses repeats to the last value, so read every
    // occurrence from rawArgs. `parseAssertFlags` also comma-splits each value.
    const assertValues = collectRepeatedFlag(rawArgs, "assert", { assert: ASSERT_FLAG });
    const flags: FlagArgs = {
      sources: parseIdList(args.source, "--source"),
      inputs: parseInputPairs(args.input),
      ignoreColumns: parseColumnList(args["ignore-columns"]),
      assertions: await resolveAssertions(parseAssertFlags(assertValues)),
    };
    if (targetType !== undefined && idGiven) {
      flags.targetType = targetType;
    }
    if (target !== undefined) {
      flags.target = target;
    }
    if (args.expected !== undefined && args.expected.trim() !== "") {
      flags.expected = args.expected;
    }

    const runArgs = compose(suite, flags);

    const client = await getClient();
    await runSubgraph(client, runArgs, ctx);
  },
});
