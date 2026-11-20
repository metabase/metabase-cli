import { Pulse, PulseUpdateInput, SUBSCRIPTION_FILTERS_GATE } from "@metabase/client/domain/pulse";
import { pulseView } from "../../output/views/pulse";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: { name: "update", description: "Update a dashboard subscription by id" },
  details: [
    "Patches only the fields you send: `name`, `cards`, `channels`, `skip_if_empty`, `parameters` and `archived`. `cards` and `channels` replace the whole list, so send every card and channel you want to keep (`mb subscription get <id> --full` prints them). `dashboard_id` and `collection_id` can't change after creation.",
    `The update reads the subscription first and keeps its \`archived\` and \`skip_if_empty\` when the patch leaves them out, since the server would reset them to \`false\`. Non-empty \`parameters\` need \`${SUBSCRIPTION_FILTERS_GATE.feature}\` and are refused without it, as on \`mb subscription create\`.`,
  ].join("\n\n"),
  requires: ["pulse.update"],
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
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.pulse.update(id, body);
    renderSummary(updated, pulseView, `Updated subscription ${updated.id}.`, ctx);
  },
});
