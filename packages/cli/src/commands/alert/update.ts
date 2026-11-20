import { Notification, NotificationUpdateInput } from "@metabase/client/domain/notification";
import { notificationView } from "../../output/views/notification";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { describeAlert } from "./summary";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a question alert by id" },
  details: [
    'Patches only the top-level fields you send: `payload`, `subscriptions`, `handlers` and `active`. Fields inside `payload` merge over the current ones, so `{"payload":{"send_condition":"goal_above"}}` keeps the card, which can\'t change. `subscriptions` and `handlers` replace the whole list, so send every schedule and recipient you want to keep (`mb alert get <id>` prints them).',
    "The update merges the patch over the alert it reads first, so the alert and its payload keep their IDs. Don't send an `id`: the server reads the body as the alert's whole new state, and a different `id` deletes the alert and inserts a new one.",
  ].join("\n\n"),
  requires: ["notification.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Alert id", required: true },
  },
  inputSchema: NotificationUpdateInput,
  outputSchema: Notification,
  examples: [
    'mb alert update 9 --body \'{"payload":{"send_condition":"goal_above"}}\'',
    'mb alert update 9 --body \'{"subscriptions":[{"cron_schedule":"0 0 9 * * ? *"}]}\'',
    "mb alert update 9 --body '{\"active\":true}'",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.notification.update(id, body);
    renderSummary(updated, notificationView, describeAlert("Updated", updated), ctx);
  },
});
