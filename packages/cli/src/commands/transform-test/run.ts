import { TransformTestRunResult } from "@metabase/client/domain/transform-test";

import { renderSummary } from "../../output/render";
import type { ResourceView } from "../../output/view";
import { outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const transformTestRunResultView: ResourceView<TransformTestRunResult> = {
  compactPick: TransformTestRunResult,
  tableColumns: [{ key: "status", label: "Status" }],
};

function runSummary(id: number, result: TransformTestRunResult): string {
  const failed = result.expectations.filter((expectation) => expectation.status !== "passed");
  if (failed.length === 0) {
    return `Transform test ${id} passed (${result.expectations.length} expectation(s)).`;
  }
  const names = failed.map((expectation) => `${expectation.name} (${expectation.status})`);
  return `Transform test ${id} ${result.status}: ${names.join(", ")}.`;
}

export default defineMetabaseCommand({
  meta: { name: "run", description: "Run a transform test by id and report each expectation" },
  details:
    "Runs the transform's SQL over the test's inputs in a scratch schema and checks every expectation. `status` is `passed` or `failed`; an expectation that could not be evaluated reports its own `error`. A refusal (an input the SQL never reads, a column it lacks) is an HTTP error whose code starts with `transform-test.` and means nothing ran.",
  requires: ["transformTest.run"],
  args: {
    ...outputFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Transform test id", required: true },
  },
  outputSchema: TransformTestRunResult,
  examples: ["mb transform-test run 5", "mb transform-test run 5 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const result = await client.transformTest.run(id);
    renderSummary(result, transformTestRunResultView, runSummary(id, result), ctx);
  },
});
