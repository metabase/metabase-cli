import { ConfigError } from "../../core/errors";
import {
  Dashcard,
  DashboardDetail,
  DashcardPatchInput,
  dashcardView,
} from "../../domain/dashboard";
import { renderItem } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "update-dashcard",
    description: "Patch a single dashcard's layout or settings on a dashboard",
  },
  capabilities: { minVersion: 58, edition: "oss" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    "dashboard-id": { type: "positional", description: "Dashboard id", required: true },
    "dashcard-id": { type: "positional", description: "Dashcard id", required: true },
  },
  outputSchema: Dashcard,
  examples: [
    'mb dashboard update-dashcard 1 5 --body \'{"row":2,"col":0}\'',
    'mb dashboard update-dashcard 1 5 --body \'{"size_x":12,"size_y":4}\'',
    "cat patch.json | mb dashboard update-dashcard 1 5",
  ],
  async run({ args, ctx, getClient }) {
    const dashboardId = parseId(args["dashboard-id"], "dashboard-id");
    const dashcardId = parseId(args["dashcard-id"], "dashcard-id");
    const patch = await readBody({ flag: args.body, file: args.file }, DashcardPatchInput);
    const client = await getClient();

    const dashboard = await client.requestParsed(DashboardDetail, `/api/dashboard/${dashboardId}`);
    const target = dashboard.dashcards.find((dashcard) => dashcard.id === dashcardId);
    if (target === undefined) {
      throw new ConfigError(`dashcard ${dashcardId} not found on dashboard ${dashboardId}`);
    }
    const patched = Dashcard.parse({ ...target, ...patch });
    const updatedDashcards = dashboard.dashcards.map((dashcard) =>
      stripEntityId(dashcard.id === dashcardId ? patched : dashcard),
    );

    const result = await client.requestParsed(DashboardDetail, `/api/dashboard/${dashboardId}`, {
      method: "PUT",
      body: { dashcards: updatedDashcards },
    });
    const refreshed = result.dashcards.find((dashcard) => dashcard.id === dashcardId);
    if (refreshed === undefined) {
      throw new Error(
        `PUT /api/dashboard/${dashboardId}: dashcard ${dashcardId} missing from response`,
      );
    }
    renderItem(refreshed, dashcardView, ctx);
  },
});

function stripEntityId(dashcard: Dashcard): Omit<Dashcard, "entity_id"> {
  const { entity_id: _entity_id, ...rest } = dashcard;
  return rest;
}
