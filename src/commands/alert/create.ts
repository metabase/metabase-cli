import { Notification, NotificationCreateInput, notificationView } from "../../domain/notification";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

import { describeAlert } from "./summary";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a question alert from JSON" },
  details: [
    "The JSON body needs `payload`, `subscriptions`, and `handlers`.",
    "`payload` is `{card_id, send_condition, send_once}` — `send_condition` is has_result (the card returns any row), goal_above, or goal_below (both need a goal set on the card's visualization).",
    "`subscriptions` is a list of `{cron_schedule}` in Quartz 7-field form (`0 0 8 * * ? *` = daily at 08:00 in the instance's report timezone).",
    "`handlers` is a list of `{channel_type: channel/email|channel/slack|channel/http, recipients}`;",
    'each recipient is `{type: "notification-recipient/user", user_id}` or `{type: "notification-recipient/raw-value", details: {value: "a@b.com"}}`.',
  ].join(" "),
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: NotificationCreateInput,
  outputSchema: Notification,
  examples: [
    'mb alert create --body \'{"payload":{"card_id":94,"send_condition":"has_result"},"subscriptions":[{"cron_schedule":"0 0 8 * * ? *"}],"handlers":[{"channel_type":"channel/email","recipients":[{"type":"notification-recipient/raw-value","details":{"value":"team@example.com"}}]}]}\'',
    "cat alert.json | mb alert create",
    "mb alert create --file alert.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, NotificationCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Notification, "/api/notification", {
      method: "POST",
      body,
    });
    renderSummary(created, notificationView, describeAlert("Created", created), ctx);
  },
});
