import { Notification, NotificationUpdateInput, notificationView } from "../../domain/notification";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { patchAlert } from "./patch";
import { describeAlert } from "./summary";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a question alert by id" },
  details: [
    "Patches only the top-level fields you send: `payload`, `subscriptions`, `handlers`, `active`.",
    'Fields inside `payload` merge over the current ones, so `{"payload":{"send_condition":"goal_above"}}` keeps the card.',
    "`subscriptions` and `handlers` replace the whole list, so send every schedule and recipient you want to keep —",
    "`mb alert get <id>` prints the current ones. An alert's card cannot be moved to a different card.",
  ].join(" "),
  capabilities: { minVersion: 58 },
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
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, NotificationUpdateInput);
    const client = await getClient();
    const updated = await patchAlert(client, id, body);
    renderSummary(updated, notificationView, describeAlert("Updated", updated), ctx);
  },
});
