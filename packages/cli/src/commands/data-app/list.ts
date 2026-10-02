import { DataAppCompact } from "@metabase/client/domain/data-app";
import { dataAppView } from "../../output/views/data-app";
import { renderList } from "../../output/render";
import { listEnvelopeSchema } from "../../output/types";
import { windowList } from "../../output/window";
import { connectionFlags, listFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";

export const DataAppListEnvelope = listEnvelopeSchema(DataAppCompact);

export default defineMetabaseCommand({
  meta: { name: "list", description: "List data apps" },
  details:
    "Admins see every app, with drafts, disabled and outdated apps badged; other users see only the slug and name of the apps they can open.",
  requires: ["dataApp.list"],
  args: {
    ...outputFlags,
    ...listFlags,
    ...profileFlag,
    ...connectionFlags,
    available: { type: "boolean", description: "Only enabled, published, current apps" },
  },
  outputSchema: DataAppListEnvelope,
  examples: ["mb data-app list", "mb data-app list --available --json"],
  async run({ args, ctx, getClient }) {
    const client = await getClient();
    const { data, total } = await client.dataApp.list({ available: args.available || undefined });
    renderList(windowList(data, ctx.range, total), dataAppView, ctx);
  },
});
