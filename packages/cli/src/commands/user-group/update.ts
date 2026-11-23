import {
  PermissionGroupUpdateInput,
  SavedPermissionGroup,
} from "@metabase/client/domain/permission";
import { renderSummary } from "../../output/render";
import { savedPermissionGroupView } from "../../output/views/permission";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { nameFlags, readGroupInput } from "./name-flags";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Rename a permission group" },
  details:
    "Pass `--name`, or a JSON body with exactly a `name` key. A built-in group, one with a `magic_group_type`, cannot be renamed. Needs an admin or, with advanced permissions, a manager of the group.",
  requires: ["group.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...nameFlags,
    id: { type: "positional", description: "Group id", required: true },
  },
  inputSchema: PermissionGroupUpdateInput,
  outputSchema: SavedPermissionGroup,
  examples: ['mb group update 3 --name "Data analysts"', "mb group update 3 --file group.json"],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readGroupInput(args, readBody);
    const client = await getClient();
    const updated = await client.group.update(id, body);
    renderSummary(
      updated,
      savedPermissionGroupView,
      `Renamed group ${updated.id} to "${updated.name}".`,
      ctx,
    );
  },
});
