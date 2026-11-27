import { DatabaseUpdateInput, DatabaseWithSettings } from "@metabase/client/domain/database";
import { renderSummary } from "../../output/render";
import { databaseView } from "../../output/views/database";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a database's name, connection or settings from JSON",
  },
  details:
    "The body names any of `name`, `details` and `settings`; only those change. Changed `details` are tested before they are saved. `mb db get <id> --full --json` answers the current `details` with secrets redacted, and a secret sent back as that redacted value keeps the stored one, so read the details, change what you need and send them back. Needs an admin or, with advanced permissions, the Manage database permission on it.",
  requires: ["database.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    id: { type: "positional", description: "Database id", required: true },
  },
  inputSchema: DatabaseUpdateInput,
  outputSchema: DatabaseWithSettings,
  examples: [
    'mb db update 2 --body \'{"name":"Warehouse"}\'',
    "mb db update 2 --file details.json",
  ],
  async run({ args, ctx, getClient, readBody }) {
    const id = parseId(args.id);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.database.update(id, body);
    renderSummary(updated, databaseView, `Updated database ${updated.id} "${updated.name}".`, ctx);
  },
});
