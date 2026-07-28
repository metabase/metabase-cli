import { DashboardCompact, DashboardListFilter } from "@metabase/client/domain/dashboard";
import { dashboardView } from "../../output/views/dashboard";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { defineMetabaseCommand } from "../runtime";

export const DashboardListEnvelope = listEnvelopeSchema(DashboardCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List dashboards" },
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...listFlags,
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
    const filter = parseEnumFlag(args.filter, DashboardListFilter, "filter");
    const client = await getClient();
    const { data, total } = await client.dashboard.list({ f: filter });
    renderList(windowList(data, ctx.range, total), dashboardView, ctx);
  },
});
