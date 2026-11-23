import {
  PermissionGroupCreateInput,
  SavedPermissionGroup,
} from "@metabase/client/domain/permission";
import { renderSummary } from "../../output/render";
import { savedPermissionGroupView } from "../../output/views/permission";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { nameFlags, readGroupInput } from "./name-flags";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a permission group" },
  details:
    "Pass `--name`, or a JSON body with exactly a `name` key. A body piped on stdin is not read while the flag is given. The name may not be blank. The group starts with no members, and on each database with data permissions based on the All Users group's. Admins only.",
  requires: ["group.create"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...nameFlags,
  },
  inputSchema: PermissionGroupCreateInput,
  outputSchema: SavedPermissionGroup,
  examples: ['mb group create --name "Analysts"', 'mb group create --body \'{"name":"Analysts"}\''],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readGroupInput(args, readBody);
    const client = await getClient();
    const created = await client.group.create(body);
    renderSummary(
      created,
      savedPermissionGroupView,
      `Created group ${created.id} "${created.name}".`,
      ctx,
    );
  },
});
