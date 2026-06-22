import { ConfigError } from "../../core/errors";
import { TestRunResult, testRunResultView } from "../../domain/transform-test-run";
import { renderSummary } from "../../output/render";
import { readFilePart } from "../../runtime/upload";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId, parseIdList } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export interface InputPair {
  tableId: number;
  path: string;
}

function parseInputPair(pair: string): InputPair {
  const eq = pair.indexOf("=");
  if (eq <= 0 || eq === pair.length - 1) {
    throw new ConfigError(
      `Malformed --input entry '${pair}'. Expected <table-id>=<file> (e.g. 229=orders.csv).`,
    );
  }
  const tableId = parseId(pair.slice(0, eq).trim(), "--input table id");
  return { tableId, path: pair.slice(eq + 1).trim() };
}

export function parseInputPairs(value: string | undefined): InputPair[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map(parseInputPair);
}

export function parseColumnList(value: string | undefined): string[] {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

function summaryLine(target: number, result: TestRunResult): string {
  if (result.status === "passed") {
    return `Transform ${target} test run passed.`;
  }
  return `Transform ${target} test run FAILED — output did not match expected. Re-run with --json to see the diff.`;
}

export default defineMetabaseCommand({
  meta: {
    name: "run",
    description: "Test-run a transform (or sub-graph) against fixture CSVs",
  },
  details:
    "Seeds scratch tables from the --input fixture CSVs (real tables are never touched), runs the sub-graph from the --source transforms up to the target (the positional id) in dependency order, and diffs the target's output against the --expected CSV. Use `transform-test inputs` to discover which tables need fixtures. Omit --source to test the target transform alone. Exits non-zero when the output does not match.",
  // PROVISIONAL: the test-run/subgraph endpoints are unreleased. minVersion mirrors the
  // transforms feature baseline so the command runs against a dev build; bump to the actual
  // release version before this ships.
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
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
    id: { type: "positional", description: "Target transform id", required: true },
  },
  outputSchema: TestRunResult,
  examples: [
    "mb transform-test run 173 --source 172 --input 229=orders.csv,223=people.csv --expected expected.csv",
    "mb transform-test run 42 --input 229=orders.csv --expected out.csv --ignore-columns snapshot_ts",
  ],
  async run({ args, ctx, getClient }) {
    const target = parseId(args.id);
    const sources = parseIdList(args.source, "--source");
    const inputs = parseInputPairs(args.input);
    const expected = args.expected;
    if (expected === undefined || expected.trim() === "") {
      throw new ConfigError("Missing required --expected <csv-path>.");
    }
    const ignoreColumns = parseColumnList(args["ignore-columns"]);

    const form = new FormData();
    for (const { tableId, path } of inputs) {
      const part = await readFilePart(path, `--input ${tableId}`);
      form.append(`input-${tableId}`, part.blob, part.filename);
    }
    const expectedPart = await readFilePart(expected, "--expected");
    form.append("expected", expectedPart.blob, expectedPart.filename);
    if (sources.length > 0) {
      form.append("sources", JSON.stringify(sources));
    }
    if (ignoreColumns.length > 0) {
      form.append("options", JSON.stringify({ ignore_columns: ignoreColumns }));
    }

    const client = await getClient();
    const result = await client.requestParsed(
      TestRunResult,
      `/api/transform/${target}/test-run/subgraph`,
      { method: "POST", body: form },
    );

    renderSummary(result, testRunResultView, () => summaryLine(target, result), ctx);

    if (result.status === "failed") {
      throw new Error(`transform ${target} test run failed: output did not match expected`);
    }
  },
});
