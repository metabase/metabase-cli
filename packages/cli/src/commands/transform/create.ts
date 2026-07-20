import { Transform, TransformCreateInput, transformView } from "../../domain/transform";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import {
  TRANSFORM_SOURCE_QUERY_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

import { enrichTransformCollectionError } from "./collection-namespace";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a transform from JSON",
  },
  details:
    "The JSON body needs a `name`, a `source` (the query to run — native SQL or MBQL — under `source.query`), and a `target` (the warehouse table to write, with `database`/`schema`/`name`). When `source.query` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb query --print-schema`) before sending; pass --skip-validate to bypass.",
  skills: [{ skill: "mbql", purpose: "MBQL source.query bodies" }],
  capabilities: { minVersion: 59 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  inputSchema: TransformCreateInput,
  outputSchema: Transform,
  examples: [
    "cat transform.json | mb transform create",
    "mb transform create --file transform.json",
    "mb transform create --file transform.json --skip-validate",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformCreateInput);
    if (body.source.type === "query") {
      preflightMbql5Query(body.source.query, TRANSFORM_SOURCE_QUERY_LABELS, {
        skip: args["skip-validate"] === true,
      });
    }
    const client = await getClient();
    const created = await client
      .requestParsed(Transform, "/api/transform", { method: "POST", body })
      .catch((error: unknown) => {
        throw enrichTransformCollectionError(error);
      });
    renderSummary(
      created,
      transformView,
      `Created transform ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
