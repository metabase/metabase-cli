import { DashcardDetail, DashcardPatchInput } from "@metabase/client/domain/dashboard";
import { dashcardView } from "../../output/views/dashboard";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "update-dashcard",
    description: "Patch a single dashcard's layout or settings on a dashboard",
  },
  details:
    "Metabase has no endpoint for one dashcard, so the command reads the dashboard, merges the patch into the dashcard, and writes every dashcard back, the others unchanged and the tabs as they stand. The patch takes `row`, `col`, `size_x`, `size_y`, `dashboard_tab_id`, `parameter_mappings`, `inline_parameters`, `visualization_settings` and `series`; an empty patch or any other key is refused before a request is sent. Prints the dashcard as the update left it.",
  requires: ["dashboard.updateDashcard"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    "dashboard-id": { type: "positional", description: "Dashboard id", required: true },
    "dashcard-id": { type: "positional", description: "Dashcard id", required: true },
  },
  inputSchema: DashcardPatchInput,
  outputSchema: DashcardDetail,
  examples: [
    'mb dashboard update-dashcard 1 5 --body \'{"row":2,"col":0}\'',
    'mb dashboard update-dashcard 1 5 --body \'{"size_x":12,"size_y":4}\'',
    "cat patch.json | mb dashboard update-dashcard 1 5",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const dashboardId = parseId(args["dashboard-id"], "dashboard-id");
    const dashcardId = parseId(args["dashcard-id"], "dashcard-id");
    const patch = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const refreshed = await client.dashboard.updateDashcard(dashboardId, dashcardId, patch);
    renderSummary(
      refreshed,
      dashcardView,
      `Updated dashcard ${dashcardId} on dashboard ${dashboardId} (row ${refreshed.row}, col ${refreshed.col}, ${refreshed.size_x}x${refreshed.size_y}).`,
      ctx,
    );
  },
});
