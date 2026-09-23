import { DashcardCompact } from "@metabase/client/domain/dashboard";
import { dashcardView } from "../../output/views/dashboard";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { listFlags, outputFlags, preflightFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export const DashcardListEnvelope = listEnvelopeSchema(DashcardCompact);

export default defineMetabaseCommand({
  meta: { name: "cards", description: "List dashcards on a dashboard" },
  requires: ["dashboard.get"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...preflightFlag,
    id: { type: "positional", description: "Dashboard id", required: true },
  },
  outputSchema: DashcardListEnvelope,
  examples: ["mb dashboard cards 1", "mb dashboard cards 1 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const dashboard = await client.dashboard.get(id);
    renderList(windowList(dashboard.dashcards, ctx.range), dashcardView, ctx);
  },
});
