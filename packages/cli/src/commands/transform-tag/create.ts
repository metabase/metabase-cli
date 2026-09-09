import { TransformTag, TransformTagCreateInput } from "@metabase/client/domain/transform-tag";
import { transformTagView } from "../../output/views/transform-tag";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag, worktreeFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { scopeBody, WORKTREE_SCOPE_DETAIL } from "../worktree-scope";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a transform tag" },
  capabilities: { minVersion: 59 },
  worktree: "scoped",
  details: WORKTREE_SCOPE_DETAIL,
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...worktreeFlag,
    ...bodyInputFlags,
  },
  inputSchema: TransformTagCreateInput,
  outputSchema: TransformTag,
  examples: [
    'mb transform-tag create --body \'{"name":"nightly"}\'',
    "mb transform-tag create --file tag.json",
    'echo \'{"name":"nightly"}\' | mb transform-tag create',
    'mb transform-tag create --body \'{"name":"nightly"}\' --worktree feat/transforms',
  ],
  async run({ args, ctx, getClient, getWorktree }) {
    const body = await readBody({ flag: args.body, file: args.file }, TransformTagCreateInput);
    const client = await getClient();
    const scope = await getWorktree();
    const created = await client.transformTag.create(scopeBody(body, scope));
    renderSummary(
      created,
      transformTagView,
      `Created transform tag ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
