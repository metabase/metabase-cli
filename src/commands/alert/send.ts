import { z } from "zod";

import type { ResourceView } from "../../domain/view";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { fetchAlert } from "./patch";

export const AlertSendResult = z.object({
  id: z.number().int(),
  sent: z.boolean(),
});
export type AlertSendResultJson = z.infer<typeof AlertSendResult>;

const alertSendResultView: ResourceView<AlertSendResultJson> = {
  compactPick: AlertSendResult,
  tableColumns: [
    { key: "id", label: "ID" },
    { key: "sent", label: "Sent" },
  ],
};

export default defineMetabaseCommand({
  meta: { name: "send", description: "Send a question alert now, off-schedule" },
  details:
    "Delivers to every handler on the alert, ignoring its send condition and schedule. Requires the channel to be configured on the server (email needs SMTP set up).",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Alert id", required: true },
  },
  outputSchema: AlertSendResult,
  examples: ["mb alert send 9", "mb alert send 9 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    await fetchAlert(client, id);
    await client.requestRaw(`/api/notification/${id}/send`, {
      method: "POST",
      expectContentType: "binary",
    });
    renderSummary({ id, sent: true }, alertSendResultView, `Sent alert ${id}.`, ctx);
  },
});
