import { Transform, TransformCreateInput } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeBody, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";
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
    "The JSON body needs a `name`, a `source` (the query to run — native SQL or MBQL — under `source.query`), and a `target` (the warehouse table to write, with `database`/`schema`/`name`). When `source.query` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb query --print-schema`) before sending; pass --skip-validate to bypass. " +
    WORKTREE_SCOPE_DETAIL,
  skills: [{ skill: "mbql", purpose: "MBQL source.query bodies" }],
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    ...bodyInputFlags,
    ...skipValidateFlag,
  },
  inputSchema: TransformCreateInput,
  outputSchema: Transform,
  examples: [
    "cat transform.json | mb transform create",
    "mb transform create --file transform.json",
    "mb transform create --file transform.json --skip-validate",
    "mb transform create --file transform.json --worktree feat/transforms",
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformCreateInput);
    if (body.source.type === "query") {
      preflightMbql5Query(body.source.query, TRANSFORM_SOURCE_QUERY_LABELS, {
        skip: args["skip-validate"] === true,
      });
    }
    const client = await getClient();
    const scope = await getWorktree();
    const created = await client.transform
      .create(scopeBody(body, scope))
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
