import { Dashboard, dashboardView } from "../../domain/dashboard";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "archive", description: "Archive (soft-delete) a dashboard by id" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Dashboard id", required: true },
  },
  outputSchema: Dashboard,
  examples: ["mb dashboard archive 1", "mb dashboard archive 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const updated = await client.requestParsed(Dashboard, `/api/dashboard/${id}`, {
      method: "PUT",
      body: { archived: true },
    });
    renderItem(updated, dashboardView, ctx);
  },
});
