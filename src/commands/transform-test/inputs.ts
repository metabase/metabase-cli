import { z } from "zod";

import {
  TestRunInput,
  TestRunInputCompact,
  testRunInputView,
} from "../../domain/transform-test-run";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId, parseIdList } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const TestRunInputListEnvelope = listEnvelopeSchema(TestRunInputCompact);

export default defineMetabaseCommand({
  meta: {
    name: "inputs",
    description: "List the input tables a transform test run requires fixtures for",
  },
  details:
    "Resolves the sub-graph from the selected --source transforms up to the target (the positional id) and returns its boundary leaf tables — one CSV fixture is required per table for `transform-test run`. Omit --source to test the target transform alone. Each row carries the table id (use it in `--input <table-id>=<file>`) and the exact column headers the fixture CSV must contain.",
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
    id: { type: "positional", description: "Target transform id", required: true },
  },
  outputSchema: TestRunInputListEnvelope,
  examples: [
    "mb transform-test inputs 173 --source 172",
    "mb transform-test inputs 173 --source 172 --json",
    "mb transform-test inputs 42",
  ],
  async run({ args, ctx, getClient }) {
    const target = parseId(args.id);
    const sources = parseIdList(args.source, "--source");
    const client = await getClient();
    const items = await client.requestParsed(
      z.array(TestRunInput),
      `/api/transform/${target}/test-run/subgraph-inputs`,
      { query: { sources } },
    );
    renderList(wrapList(items), testRunInputView, ctx);
  },
});
