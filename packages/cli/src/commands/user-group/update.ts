import { Group, GroupUpdateInput } from "@metabase/client/domain/group";
import { renderSummary } from "../../output/render";
import { groupView } from "../../output/views/group";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { nameFlags, readGroupInput } from "./name-flags";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Rename a permission group" },
  details:
    "Pass `--name`, or a JSON body with exactly a `name` key. The built-in All Users and Administrators groups cannot be renamed. Admins only.",
  requires: ["group.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...nameFlags,
    id: { type: "positional", description: "Group id", required: true },
  },
  inputSchema: GroupUpdateInput,
  outputSchema: Group,
  examples: ['mb group update 3 --name "Data analysts"', "mb group update 3 --file group.json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readGroupInput(args);
    const client = await getClient();
    const updated = await client.group.update(id, body);
    renderSummary(updated, groupView, `Renamed group ${updated.id} to "${updated.name}".`, ctx);
  },
});
