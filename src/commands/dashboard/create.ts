import { Dashboard, DashboardCreateInput, dashboardView } from "../../domain/dashboard";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a dashboard from a JSON spec" },
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags },
  outputSchema: Dashboard,
  examples: [
    "cat dashboard.json | metabase dashboard create",
    "metabase dashboard create --file dashboard.json",
    'metabase dashboard create --body \'{"name":"My Dashboard","collection_id":4}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, DashboardCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Dashboard, "/api/dashboard", {
      method: "POST",
      body,
    });
    renderItem(created, dashboardView, ctx);
  },
});
