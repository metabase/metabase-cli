import { DashboardDetail, dashboardView } from "../../domain/dashboard";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a dashboard by id" },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Dashboard id", required: true },
  },
  outputSchema: DashboardDetail,
  examples: ["mb dashboard get 1", "mb dashboard get 1 --json", "mb dashboard get 1 --json --full"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const dashboard = await client.requestParsed(DashboardDetail, `/api/dashboard/${id}`);
    renderItem(dashboard, dashboardView, ctx);
  },
});
