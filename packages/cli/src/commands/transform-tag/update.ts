import { TransformTag, TransformTagUpdateInput } from "@metabase/client/domain/transform-tag";
import { transformTagView } from "../../output/views/transform-tag";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

import { assertTagInWorktree } from "./scope";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a transform tag by id" },
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    ...bodyInputFlags,
    id: { type: "positional", description: "Transform tag id", required: true },
  },
  inputSchema: TransformTagUpdateInput,
  outputSchema: TransformTag,
  examples: [
    'mb transform-tag update 5 --body \'{"name":"renamed"}\'',
    "mb transform-tag update 5 --file tag.json",
    'echo \'{"name":"renamed"}\' | mb transform-tag update 5',
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, TransformTagUpdateInput);
    const client = await getClient();
    await assertTagInWorktree(client, id, await getWorktree());
    const updated = await client.transformTag.update(id, body);
    renderSummary(
      updated,
      transformTagView,
      `Updated transform tag ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});
