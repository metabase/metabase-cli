import { z } from "zod";

import { DataAppPermissionWarning } from "@metabase/client/domain/data-app";
import { dataAppPermissionWarningView } from "../../output/views/data-app";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { parseIdCsv } from "../parse-id";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

export const DataAppPermissionWarningEnvelope = listEnvelopeSchema(DataAppPermissionWarning);

export default defineMetabaseCommand({
  meta: {
    name: "permission-warnings",
    description: "Name the users who cannot read every table an app uses",
  },
  details:
    "An app's collection lets its users run the app's cards, but they see data only from tables they can already read. Lists each of the given users who misses a table, with the tables; an empty list means every user sees all of the app's data.",
  requires: ["dataApp.permissionWarnings"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    ...slugArg,
    userIds: {
      type: "string",
      description: "Comma-separated user ids (1–100)",
      alias: "user-ids",
      required: true,
    },
  },
  outputSchema: DataAppPermissionWarningEnvelope,
  examples: ["mb data-app permission-warnings sales-overview --user-ids 4,7 --json"],
  async run({ args, ctx, getClient }) {
    const slug = parseSlug(args.slug);
    const userIds = z.array(z.number()).min(1).max(100).parse(parseIdCsv(args.userIds, "user-ids"));
    const client = await getClient();
    const warnings = await client.dataApp.permissionWarnings(slug, { user_ids: userIds });
    renderList(windowList(warnings, ctx.range, warnings.length), dataAppPermissionWarningView, ctx);
  },
});
