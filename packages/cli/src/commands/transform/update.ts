import { Transform, TransformUpdateInput } from "@metabase/client/domain/transform";
import { transformView } from "../../output/views/transform";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { assertInWorktree, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";
import {
  TRANSFORM_SOURCE_QUERY_LABELS,
  preflightMbql5Query,
  skipValidateFlag,
} from "../validate-query";

import { enrichTransformCollectionError } from "./collection-namespace";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a transform by id (partial)",
  },
  details:
    "Patches only the fields you send (any of `name`, `source`, `target`, `tag_ids`, …). When a new `source.query` is an MBQL 5 query it is checked against a bundled JSON Schema (print it with `mb query --print-schema`) before sending; pass --skip-validate to bypass. " +
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
    id: { type: "positional", description: "Transform id", required: true },
    ...skipValidateFlag,
  },
  inputSchema: TransformUpdateInput,
  outputSchema: Transform,
  examples: [
    "cat patch.json | mb transform update 1",
    "mb transform update 1 --file patch.json",
    'mb transform update 1 --body \'{"name":"renamed"}\'',
    "mb transform update 1 --file patch.json --skip-validate",
    'mb transform update 1 --body \'{"name":"renamed"}\' --worktree feat/transforms',
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformUpdateInput);
    if (body.source !== undefined && body.source.type === "query") {
      preflightMbql5Query(body.source.query, TRANSFORM_SOURCE_QUERY_LABELS, {
        skip: args["skip-validate"] === true,
      });
    }
    const client = await getClient();
    const scope = await getWorktree();
    if (scope !== null) {
      const existing = await client.transform.get(id);
      assertInWorktree("transform", id, existing.worktree_id, scope);
    }
    const updated = await client.transform.update(id, body).catch((error: unknown) => {
      throw enrichTransformCollectionError(error);
    });
    renderSummary(
      updated,
      transformView,
      `Updated transform ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});
