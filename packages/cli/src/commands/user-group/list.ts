import { PermissionGroupCompact } from "@metabase/client/domain/permission";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { permissionGroupView } from "../../output/views/permission";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const PermissionGroupListEnvelope = listEnvelopeSchema(PermissionGroupCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List permission groups" },
  details:
    "Lists every group with its member count. A built-in group, such as All Users or Administrators, has a `magic_group_type`. Needs an admin, the settings application permission, or a group manager, who sees only the groups they manage. A group's id is the key it is listed under in the data permissions graph.",
  requires: ["permission.groups"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: PermissionGroupListEnvelope,
  examples: ["mb group list", "mb group list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.permission.groups();
    renderList(windowList(data, ctx.range, total), permissionGroupView, ctx);
  },
});
