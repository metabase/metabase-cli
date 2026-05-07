import { DashboardDetail, DashcardCompact, dashcardView } from "../../domain/dashboard";
import { renderList } from "../../output/render";
import { listEnvelopeSchema, wrapList } from "../../output/types";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const DashcardListEnvelope = listEnvelopeSchema(DashcardCompact);

export default defineMetabaseCommand({
  meta: { name: "cards", description: "List dashcards on a dashboard" },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Dashboard id", required: true },
  },
  outputSchema: DashcardListEnvelope,
  examples: ["metabase dashboard cards 1", "metabase dashboard cards 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const dashboard = await client.requestParsed(DashboardDetail, `/api/dashboard/${id}`);
    renderList(wrapList(dashboard.dashcards), dashcardView, ctx);
  },
});
