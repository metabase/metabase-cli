import { ConfigError } from "../../core/errors";
import { TestRunResult } from "../../domain/transform-test-run";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId, parseIdList } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import {
  parseColumnList,
  parseInputPairs,
  parseTargetType,
  runSubgraph,
  targetLabels,
  targetTypeFlag,
} from "./subgraph";

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description: "Test-run a transform or card (or sub-graph) against fixture CSVs",
  },
  details:
    "Seeds scratch tables from the --input fixture CSVs (real tables are never touched), runs the sub-graph from the --source transforms up to the target (the positional id) in dependency order, and diffs the target's output against the --expected CSV. The positional id is a transform id by default, or a card id when --target-type card is set (a card target uses no --source). Use `transform-test inputs` to discover which tables need fixtures. Omit --source to test the target alone. Exits non-zero when the output does not match.",
  // PROVISIONAL: the test-run/subgraph endpoints are unreleased. minVersion mirrors the
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
    expected: { type: "string", description: "Path to the expected-output CSV" },
    "ignore-columns": {
      type: "string",
      description: "Comma-separated output column names to exclude from the diff",
    },
    id: { type: "positional", description: "Target transform or card id", required: true },
  },
  outputSchema: TestRunResult,
  examples: [
    "mb transform-test run 173 --source 172 --input 229=orders.csv,223=people.csv --expected expected.csv",
    "mb transform-test run 42 --input 229=orders.csv --expected out.csv --ignore-columns snapshot_ts",
    "mb transform-test run 88 --target-type card --input 229=orders.csv --expected out.csv",
  ],
  async run({ args, ctx, getClient }) {
    const targetType = parseTargetType(args["target-type"]);
    const target = parseId(args.id, targetLabels(targetType).positionalLabel);
    const sources = parseIdList(args.source, "--source");
    const inputs = parseInputPairs(args.input);
    const expected = args.expected;
    if (expected === undefined || expected.trim() === "") {
      throw new ConfigError("Missing required --expected <csv-path>.");
    }
    const ignoreColumns = parseColumnList(args["ignore-columns"]);

    const client = await getClient();
    await runSubgraph(
      client,
      { targetType, target, sources, inputs, expected, ignoreColumns },
      ctx,
    );
  },
});
