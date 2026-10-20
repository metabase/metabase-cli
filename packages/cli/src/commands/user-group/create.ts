import { Group, GroupCreateInput } from "@metabase/client/domain/group";
import { renderSummary } from "../../output/render";
import { groupView } from "../../output/views/group";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { nameFlags, readGroupInput } from "./name-flags";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a permission group" },
  details:
    "Pass `--name`, or a JSON body with exactly a `name` key. A body piped on stdin is not read while the flag is given. The name may not be blank. The group starts with no members and no permissions. Admins only.",
  requires: ["group.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...nameFlags,
  },
  inputSchema: GroupCreateInput,
  outputSchema: Group,
  examples: ['mb group create --name "Analysts"', 'mb group create --body \'{"name":"Analysts"}\''],
  async run({ args, ctx, getClient }) {
    const body = await readGroupInput(args);
    const client = await getClient();
    const created = await client.group.create(body);
    renderSummary(created, groupView, `Created group ${created.id} "${created.name}".`, ctx);
  },
});
