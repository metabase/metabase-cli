import { Pulse } from "@metabase/client/domain/pulse";
import { pulseView } from "../../output/views/pulse";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a dashboard subscription by id" },
  details:
    "The compact view holds `id`, `name`, `dashboard_id`, `collection_id`, `archived`, `skip_if_empty`, the pinned `cards`, and the `channels` with their schedules and recipients. `--full` adds the rest, such as the hydrated `creator` and the entity ids.",
  requires: ["pulse.get"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Subscription id", required: true },
  },
  outputSchema: Pulse,
  examples: ["mb subscription get 1", "mb subscription get 1 --full --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const subscription = await client.pulse.get(id);
    renderItem(subscription, pulseView, ctx);
  },
});
