import { Notification } from "@metabase/client/domain/notification";
import { notificationView } from "../../output/views/notification";
import { renderItem } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "get", description: "Get a question alert by id" },
  details:
    "`--full` includes the hydrated card the alert watches, alongside its schedules and handlers.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Alert id", required: true },
  },
  outputSchema: Notification,
  examples: ["mb alert get 9", "mb alert get 9 --full --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const alert = await client.notification.get(id);
    renderItem(alert, notificationView, ctx);
  },
});
