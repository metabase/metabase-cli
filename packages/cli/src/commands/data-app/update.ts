import { DataApp, DataAppUpdateInput } from "@metabase/client/domain/data-app";
import { dataAppView } from "../../output/views/data-app";
import { renderSummary } from "../../output/render";
import { readBody } from "../../runtime/body";
import { bodyInputFlags } from "../body-flags";
import { connectionFlags, outputFlags, profileFlag } from "../flags";
import { defineMetabaseCommand } from "../runtime";
import { bundleFlag, withBundle } from "./files";
import { parseSlug, slugArg } from "./slug";

export default defineMetabaseCommand({
  meta: {
    name: "update",
    description: "Update a data app's fields or bundle, or enable or disable it",
  },
  details:
    "The JSON body carries only the fields to change: `display_name`, `description`, `version`, `bundle_path`, `allowed_hosts`, `bundle`, `enabled`. --bundle reads a built bundle into `bundle`; with --bundle alone the body may be omitted.",
  requires: ["dataApp.update"],
  args: {
    ...outputFlags,
    ...profileFlag,
    ...connectionFlags,
    ...bodyInputFlags,
    ...bundleFlag,
    ...slugArg,
  },
  inputSchema: DataAppUpdateInput,
  outputSchema: DataApp,
  examples: [
    "mb data-app update sales-overview --bundle dist/index.js --body '{}'",
    "mb data-app update sales-overview --body '{\"enabled\":false}'",
  ],
  async run({ args, ctx, getClient }) {
    const slug = parseSlug(args.slug);
    const body = await readBody({ flag: args.body, file: args.file }, DataAppUpdateInput);
    const input = DataAppUpdateInput.parse(await withBundle(body, args.bundle));
    const client = await getClient();
    const updated = await client.dataApp.update(slug, input);
    renderSummary(updated, dataAppView, `Updated data app ${updated.name}.`, ctx);
  },
});
