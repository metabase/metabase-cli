import { Workspace } from "@metabase/client/domain/workspace";
import { renderItem } from "../../output/render";
import { workspaceView } from "../../output/views/workspace";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a workspace by id" },
  requires: ["workspaceManager.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Workspace id", required: true },
  },
  outputSchema: Workspace,
  examples: ["mb workspace get 1", "mb workspace get 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const workspace = await client.workspaceManager.get(id);
    renderItem(workspace, workspaceView, ctx);
  },
});
