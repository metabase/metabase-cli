import { z } from "zod";

import { DatabaseWithSettings } from "@metabase/client/domain/database";

import { renderSummary } from "../../output/render";
import { databaseDataActionsView } from "../../output/views/database";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { parseEnumFlag } from "../parse-enum";
import { parseId } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";

const DataActionsState = z.enum(["on", "off"]);

export default defineMetabaseCommand({
  meta: {
    name: "set-data-actions",
    description: "Turn data actions on or off for a database",
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
    state: {
      type: "positional",
      description: `Data actions state (${DataActionsState.options.join(" | ")})`,
      required: true,
    },
  },
  outputSchema: DatabaseWithSettings,
  examples: ["mb db set-data-actions 2 on", "mb db set-data-actions 2 off --json"],
  async run({ args, ctx, getClient }) {
    const id = parseId(args.id);
    const enabled = parseEnumFlag(args.state, DataActionsState, "state") === "on";
    const client = await getClient();
    const database = await client.database.update(id, {
      settings: { "database-enable-actions": enabled },
    });
    const state = enabled ? "on" : "off";
    renderSummary(
      database,
      databaseDataActionsView,
      `Turned data actions ${state} for database ${database.id} "${database.name}".`,
      ctx,
    );
  },
});
