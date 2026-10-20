import { GroupCompact } from "@metabase/client/domain/group";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { groupView } from "../../output/views/group";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const GroupListEnvelope = listEnvelopeSchema(GroupCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List permission groups" },
  details:
    "Lists every group, including the built-in All Users and Administrators, with its member count. Admins only. A group's id is the key it is listed under in the data permissions graph.",
  requires: ["group.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
  },
  outputSchema: GroupListEnvelope,
  examples: ["mb group list", "mb group list --json"],
  async run({ ctx, getClient }) {
    const client = await getClient();
    const { data } = await client.group.list();
    renderList(windowList(data, ctx.range), groupView, ctx);
  },
});
