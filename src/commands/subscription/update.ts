import { Pulse, PulseUpdateInput, pulseView } from "../../domain/pulse";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { patchSubscription } from "./patch";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a dashboard subscription by id" },
  details: [
    "Patches only the fields you send: `name`, `cards`, `channels`, `skip_if_empty`, `parameters`, `archived`.",
    "`cards` and `channels` replace the whole list, so send every card and channel you want to keep —",
    "`mb subscription get <id> --full` prints the current ones.",
    "A subscription's `dashboard_id` and `collection_id` are fixed at creation and cannot be changed.",
  ].join(" "),
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Subscription id", required: true },
  },
  inputSchema: PulseUpdateInput,
  outputSchema: Pulse,
  examples: [
    'mb subscription update 1 --body \'{"name":"Daily orders"}\'',
    'mb subscription update 1 --body \'{"channels":[{"channel_type":"email","schedule_type":"weekly","schedule_hour":8,"schedule_day":"mon","recipients":[{"email":"team@example.com"}]}]}\'',
    "mb subscription update 1 --file patch.json",
  ],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file }, PulseUpdateInput);
    const client = await getClient();
    const updated = await patchSubscription(client, id, body);
    renderSummary(updated, pulseView, `Updated subscription ${updated.id}.`, ctx);
  },
});
