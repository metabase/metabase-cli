import { z } from "zod";

import { Dashboard, DashboardCompact, dashboardView } from "../../domain/dashboard";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const DashboardApiList = z.array(Dashboard);

const DashboardListFilter = z.enum(["all", "mine", "archived"]);

export const DashboardListEnvelope = listEnvelopeSchema(DashboardCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List dashboards" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    filter: {
      type: "string",
      description: `Filter preset: ${DashboardListFilter.options.join("|")}`,
      default: "all",
    },
  },
  outputSchema: DashboardListEnvelope,
  examples: [
    "mb dashboard list",
    "mb dashboard list --json",
    "mb dashboard list --filter archived --json",
  ],
  async run({ args, ctx, getClient }) {
    const filter = DashboardListFilter.parse(args.filter);
    const client = await getClient();
    const items = await client.requestParsed(DashboardApiList, "/api/dashboard", {
      query: { f: filter },
    });
    renderList(wrapList(items), dashboardView, ctx);
  },
});
