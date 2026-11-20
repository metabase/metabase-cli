import { Pulse, PulseCreateInput, SUBSCRIPTION_FILTERS_GATE } from "@metabase/client/domain/pulse";
import { featureAvailability } from "@metabase/client/version/features";
import { pulseView } from "../../output/views/pulse";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

const FILTERS_FEATURE = SUBSCRIPTION_FILTERS_GATE.feature;

export default defineMetabaseCommand({
  meta: { name: "create", description: "Create a dashboard subscription from JSON" },
  details: [
    "The JSON body needs `name`, `dashboard_id`, `cards` and `channels`. Each card is `{ id, dashboard_card_id, include_csv, include_xls }`: the card's id and its place on the dashboard, both from `mb dashboard cards <dashboard-id>`.",
    'Each channel is `{ channel_type: email|slack|http, schedule_type: hourly|daily|weekly|monthly }` plus what its schedule needs: `daily` needs `schedule_hour` (0-23), `weekly` also `schedule_day` (mon..sun), and `monthly` also `schedule_frame` (first|mid|last). Email recipients are `[{ email: "a@b.com" } | { id: <user-id> }]`; Slack posts to `details: { channel: "#general" }`. A channel is `enabled` unless you say otherwise.',
    `Non-empty \`parameters\` (filter values for this subscription only) need \`${FILTERS_FEATURE}\` (${featureAvailability(FILTERS_FEATURE)}). They're refused (exit 2) on a server without it, which would send the dashboard's own filter values instead.`,
  ].join("\n\n"),
  requires: ["pulse.create"],
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
  async run({ args, ctx, getClient, readBody }) {
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const created = await client.pulse.create(body);
    renderSummary(
      created,
      pulseView,
      `Created subscription ${created.id} on dashboard ${created.dashboard_id}.`,
      ctx,
    );
  },
});
