import { DataApp, DataAppUpdateInput } from "@metabase/client/domain/data-app";
import { dataAppView } from "../../output/views/data-app";
import { renderSummary } from "../../output/render";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { parseSlug, slugArg } from "./slug";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a data app's fields, or enable or disable it",
  },
  details:
    "The JSON body carries only the fields to change: `display_name`, `description`, `allowed_hosts`, `enabled`, `bundle_path`, `version`. A disabled app opens only in Data Studio (Data apps → the app → Overview).",
  requires: ["dataApp.update"],
  args: { ...outputFlags, ...profileFlag, ...connectionFlags, ...bodyInputFlags, ...slugArg },
  inputSchema: DataAppUpdateInput,
  outputSchema: DataApp,
  examples: [
    'mb data-app update sales-overview --body \'{"display_name":"Sales overview"}\'',
    'mb data-app update sales-overview --body \'{"allowed_hosts":["https://api.example.com"]}\'',
  ],
  async run({ args, ctx, getClient, readBody }) {
    const slug = parseSlug(args.slug);
    const body = await readBody({ flag: args.body, file: args.file });
    const client = await getClient();
    const updated = await client.dataApp.update(slug, body);
    renderSummary(updated, dataAppView, `Updated data app ${updated.name}.`, ctx);
  },
});
