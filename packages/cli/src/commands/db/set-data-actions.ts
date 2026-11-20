import { z } from "zod";

import { DatabaseWithSettings } from "@metabase/client/domain/database";

import { renderSummary } from "../../output/render";
import { databaseDataActionsView } from "../../output/views/database";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const EnabledWord = z.enum(["true", "false"]);

export default defineMetabaseCommand({
  meta: {
    name: "set-data-actions",
    description: "Enable or disable data actions for a database",
  },
  details:
    "Sets the **Data actions** toggle in **Admin** > **Databases** (the `database-enable-actions` setting). While it's off, data actions on the database can't be created or run. Needs an admin and a driver that supports writes (`mb db get <id> --full --json` lists `actions` in `features`). Returns the database with its `settings`.",
  skills: [{ skill: "data-action", purpose: "author and run data actions on the database" }],
  requires: ["database.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
    enabled: {
      type: "positional",
      description:
        "`true` turns on data actions, `false` turns them off. Any other value exits 2 before a request is sent",
      required: true,
    },
  },
  outputSchema: DatabaseWithSettings,
  examples: ["mb db set-data-actions 2 true", "mb db set-data-actions 2 false --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const enabled = parseEnumFlag(args.enabled, EnabledWord, "enabled") === "true";
    const client = await getClient();
    const database = await client.database.update(id, {
      settings: { "database-enable-actions": enabled },
    });
    renderSummary(
      database,
      databaseDataActionsView,
      `${enabled ? "Enabled" : "Disabled"} data actions for database ${database.id} "${database.name}".`,
      ctx,
    );
  },
});
