import { Notification, notificationView } from "../../domain/notification";
import { renderSummary } from "../../output/render";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

import { patchAlert } from "./patch";
import { describeAlert } from "./summary";

export default defineMetabaseCommand({
  meta: {
    name: "archive",
    description: "Archive a question alert by id, stopping all deliveries",
  },
  details:
    "Deactivates the alert and drops its scheduled trigger. `mb alert list --include-inactive` still shows it, and `mb alert update <id> --body '{\"active\":true}'` brings it back.",
  capabilities: { minVersion: 58 },
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Alert id", required: true },
  },
  outputSchema: Notification,
  examples: ["mb alert archive 9", "mb alert archive 9 --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const client = await getClient();
    const archived = await patchAlert(client, id, { active: false });
    renderSummary(archived, notificationView, describeAlert("Archived", archived), ctx);
  },
});
