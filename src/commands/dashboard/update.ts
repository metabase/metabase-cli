import { DashboardDetail, DashboardUpdateInput, dashboardView } from "../../domain/dashboard";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { preflightDashcardCardReferences } from "./preflight";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a dashboard (and optionally its dashcards/tabs) by id",
  },
  details:
    "Any positive card_id referenced from dashcards is pre-flight-validated (exists and readable, not archived) before the PUT.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Dashboard id", required: true },
  },
  outputSchema: DashboardDetail,
  examples: [
    "cat patch.json | mb dashboard update 1",
    "mb dashboard update 1 --file patch.json",
    'mb dashboard update 1 --body \'{"name":"renamed"}\'',
    'mb dashboard update 1 --body \'{"dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}\'',
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, DashboardUpdateInput);
    const client = await getClient();
    await preflightDashcardCardReferences(client, body.dashcards);
    const updated = await client.requestParsed(DashboardDetail, `/api/dashboard/${id}`, {
      method: "PUT",
      body,
    });
    renderSummary(
      updated,
      dashboardView,
      `Updated dashboard ${updated.id} "${updated.name}".`,
      ctx,
    );
  },
});
