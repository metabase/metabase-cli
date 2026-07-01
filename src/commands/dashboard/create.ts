import {
  Dashboard,
  DashboardCreateInput,
  DashboardDetail,
  dashboardView,
} from "../../domain/dashboard";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { preflightDashcardCardReferences, wrapChainedDashboardWriteError } from "./preflight";

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a dashboard from JSON",
  },
  details:
    "Any positive card_id referenced from dashcards is pre-flight-validated (exists and readable, not archived) before the dashboard is created.",
  skills: [
    { skill: "visualization", purpose: "dashcard visualization_settings and the 24-column grid" },
  ],
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  outputSchema: Dashboard,
  examples: [
    "cat dashboard.json | mb dashboard create",
    "mb dashboard create --file dashboard.json",
    'mb dashboard create --body \'{"name":"My Dashboard","collection_id":4}\'',
    'mb dashboard create --body \'{"name":"D","dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}\'',
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, DashboardCreateInput);
    const { dashcards, tabs, ...createOnly } = body;
    const client = await getClient();
    await preflightDashcardCardReferences(client, dashcards);
    const created = await client.requestParsed(Dashboard, "/api/dashboard", {
      method: "POST",
      body: createOnly,
    });
    if (dashcards === undefined && tabs === undefined) {
      renderSummary(
        created,
        dashboardView,
        `Created dashboard ${created.id} "${created.name}".`,
        ctx,
      );
      return;
    }
    try {
      const updated = await client.requestParsed(DashboardDetail, `/api/dashboard/${created.id}`, {
        method: "PUT",
        body: { dashcards, tabs },
      });
      renderSummary(
        updated,
        dashboardView,
        `Created dashboard ${updated.id} "${updated.name}".`,
        ctx,
      );
    } catch (error) {
      throw wrapChainedDashboardWriteError(error, created.id);
    }
  },
});
