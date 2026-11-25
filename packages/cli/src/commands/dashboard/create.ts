import {
  Dashboard,
  DashboardCreateInput,
  DashboardLayoutInput,
} from "@metabase/client/domain/dashboard";
import { dashboardView } from "../../output/views/dashboard";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { preflightDashcardCardReferences, wrapChainedDashboardWriteError } from "./preflight";

const DashboardCreateBody = DashboardCreateInput.extend(DashboardLayoutInput.shape);

export default defineMetabaseCommand({
  meta: {
    name: "create",
    description: "Create a dashboard from JSON",
  },
  details: [
    "Every dashcard needs a `card_id` (a card ID, or `null` for a virtual card), and a negative dashcard `id` creates a new dashcard. Before anything is sent, each positive `card_id` must name a card you can read that isn't archived. With `dashcards` or `tabs` in the body, a follow-up update applies them, and the command prints the dashboard as that update left it.",
    "If that follow-up update fails, the error reads `dashboard <id> created but the follow-up update to dashboard <id> failed: <reason>; dashcards not applied`. The dashboard exists: send the layout again with `mb dashboard update <id> --body '{\"dashcards\":[…]}'`, or archive it with [`mb dashboard archive`](#mb-dashboard-archive).",
  ].join("\n\n"),
  skills: [
    { skill: "dashboard", purpose: "wiring filters, cross-filtering, click behavior, tabs" },
    { skill: "visualization", purpose: "dashcard visualization_settings and the 24-column grid" },
  ],
  requires: ["dashboard.create", "dashboard.update", "dashboard.checkCardReferences"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: DashboardCreateBody,
  outputSchema: Dashboard,
  examples: [
    "cat dashboard.json | mb dashboard create",
    "mb dashboard create --file dashboard.json",
    'mb dashboard create --body \'{"name":"My Dashboard","collection_id":4}\'',
    'mb dashboard create --body \'{"name":"D","dashcards":[{"id":-1,"card_id":42,"row":0,"col":0,"size_x":12,"size_y":6}]}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const { dashcards, tabs, ...createOnly } = body;
    const client = await getClient();
    await preflightDashcardCardReferences(client, dashcards);
    const created = await client.dashboard.create(createOnly);
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
      const updated = await client.dashboard.update(created.id, { dashcards, tabs });
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
