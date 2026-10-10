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
    "The Data actions toggle of Admin → Databases (the `database-enable-actions` database setting): while it is off, data actions on the database can be neither created nor run. Needs an admin. The driver must support writes: `mb db get <id> --full --json` lists `actions` in `features`. Answers the database with its `settings`.",
  skills: [{ skill: "data-action", purpose: "author and run data actions on the database" }],
  requires: ["database.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    id: { type: "positional", description: "Database id", required: true },
    enabled: {
      type: "positional",
      description: "true to enable data actions, false to disable",
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
