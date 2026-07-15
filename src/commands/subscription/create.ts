import { Pulse, PulseCreateInput, pulseView } from "../../domain/pulse";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a dashboard subscription from JSON" },
  details: [
    "The JSON body needs `name`, `dashboard_id`, `cards`, and `channels`.",
    "Each card is `{id, dashboard_card_id, include_csv, include_xls}` — get both ids from `mb dashboard cards <dashboard-id>`.",
    "Each channel is `{channel_type: email|slack|http, schedule_type: hourly|daily|weekly|monthly}` plus the fields its schedule needs:",
    "`daily` needs `schedule_hour` (0-23); `weekly` also needs `schedule_day` (mon..sun); `monthly` also needs `schedule_frame` (first|mid|last).",
    'Email recipients are `[{email: "a@b.com"} | {id: <user-id>}]`; Slack targets a channel via `details: {channel: "#general"}`.',
  ].join(" "),
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
  },
  inputSchema: PulseCreateInput,
  outputSchema: Pulse,
  examples: [
    'mb subscription create --body \'{"name":"Weekly orders","dashboard_id":10,"cards":[{"id":94,"dashboard_card_id":87,"include_csv":false,"include_xls":false}],"channels":[{"channel_type":"email","schedule_type":"daily","schedule_hour":8,"recipients":[{"email":"team@example.com"}]}]}\'',
    "cat subscription.json | mb subscription create",
    "mb subscription create --file subscription.json",
  ],
  async run({ args, ctx, getClient }) {
    const body = await readBody({ flag: args.body, file: args.file }, PulseCreateInput);
    const client = await getClient();
    const created = await client.requestParsed(Pulse, "/api/pulse", {
      method: "POST",
      body,
    });
    renderSummary(
      created,
      pulseView,
      `Created subscription ${created.id} on dashboard ${created.dashboard_id}.`,
      ctx,
    );
  },
});
